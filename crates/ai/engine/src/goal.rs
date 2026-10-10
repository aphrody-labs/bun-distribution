// SPDX-License-Identifier: Apache-2.0
//! Multi-turn goals using the canonical turn loop and rollout. Behavioral
//! reference: Jan 14a7206 core/agent/goal.rs; independent implementation.

use aphrody_agent_proto::{GoalState, GoalStatus, InputItem};
use aphrody_model_client::{
    ChatMessage, ChatTurn, ModelClient, ModelStreamEvent, Part, Role, TurnOptions,
};
use aphrody_rollout::{RolloutError, RolloutLine, RolloutRecorder};
use aphrody_toolcall::ToolRegistry;
use futures::StreamExt;
use serde::Deserialize;
use serde_json::json;

use crate::{
    ApprovalGate, EngineError, EventSink, InterruptFlag, Session, SteerQueue,
    run_turn_with_controls,
};

/// Rollout item type for durable goal transitions.
pub const ROLLOUT_GOAL_STATE: &str = "goal_state";

/// Why control returned to the host. A budget stop does not achieve a goal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GoalRunOutcome {
    /// Valid affirmative evaluator verdict persisted.
    Achieved,
    /// Cancellation or a work-turn iteration cap; goal remains active.
    Interrupted,
    /// Host's work-turn budget exhausted; goal remains active.
    TurnBudgetReached,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Verdict {
    met: bool,
    reason: String,
}

async fn checkpoint(
    goal: &GoalState,
    rollout: Option<&RolloutRecorder>,
) -> Result<(), EngineError> {
    if let Some(recorder) = rollout {
        recorder.record_async(json!({"type": ROLLOUT_GOAL_STATE, "goal": goal})).await?;
        recorder.flush().await?;
    }
    Ok(())
}

/// Restore the last goal checkpoint; corruption must not silently reset progress.
pub fn restore_goal(lines: &[RolloutLine]) -> Result<Option<GoalState>, EngineError> {
    let Some(line) = lines.iter().rev().find(|line| line.item["type"] == ROLLOUT_GOAL_STATE) else {
        return Ok(None);
    };
    let goal: GoalState = serde_json::from_value(line.item["goal"].clone())
        .map_err(|error| EngineError::Goal(format!("invalid goal checkpoint: {error}")))?;
    GoalState::new(&goal.condition, goal.started_at)
        .map_err(|error| EngineError::Goal(error.into()))?;
    Ok(Some(goal))
}

async fn evaluate(
    session: &Session,
    evaluator: &dyn ModelClient,
    condition: &str,
) -> Result<Verdict, EngineError> {
    // Keep the newest transcript, omit media and opaque reasoning/credentials.
    // Serialize ordinary text and tool results rather than duplicating a model store.
    let mut transcript = String::new();
    for message in session.history() {
        let parts: Vec<_> = message
            .parts
            .iter()
            .filter_map(|part| match part {
                Part::Text(text) => Some(json!({"text": text})),
                Part::FunctionCall { id, name, .. } => Some(json!({"toolCall": name, "id": id})),
                Part::FunctionResponse { id, name, response, .. } => {
                    Some(json!({"toolResult": name, "id": id, "response": response}))
                },
                Part::Image(_) | Part::Reasoning { .. } => None,
            })
            .collect();
        let serialized = serde_json::to_string(&json!({"role": message.role, "parts": parts}))
            .map_err(RolloutError::from)?;
        transcript.push_str(&serialized);
        transcript.push('\n');
    }
    let start = transcript.len().saturating_sub(60_000);
    let start = (start..=transcript.len())
        .find(|i| transcript.is_char_boundary(*i))
        .unwrap_or(transcript.len());
    let request = ChatTurn {
        system: Some("Evaluate completion only from transcript evidence. No tools. Missing or ambiguous evidence means met=false. Return only JSON {\"met\":true|false,\"reason\":\"concise evidence or remaining work\"}.".into()),
        messages: vec![ChatMessage { role: Role::User, parts: vec![Part::Text(json!({"goal": condition, "transcript": &transcript[start..]}).to_string())] }],
        tools: Vec::new(),
        options: TurnOptions { temperature: Some(0.0), response_schema: Some(json!({"type":"object","properties":{"met":{"type":"boolean"},"reason":{"type":"string"}},"required":["met","reason"],"additionalProperties":false})), ..TurnOptions::default() },
    };
    let mut stream = evaluator.stream(request).await?;
    let mut text = String::new();
    let mut completed = false;
    while let Some(event) = stream.next().await {
        match event? {
            ModelStreamEvent::TextDelta(delta) => {
                if text.len().saturating_add(delta.len()) > 16_384 {
                    return Err(EngineError::Goal("evaluator reply exceeds 16 KiB".into()));
                }
                text.push_str(&delta);
            },
            ModelStreamEvent::Completed { .. } => {
                completed = true;
                break;
            },
            ModelStreamEvent::ToolCall { .. } | ModelStreamEvent::ToolCallDelta { .. } => {
                return Err(EngineError::Goal("evaluator attempted a tool call".into()));
            },
            _ => {},
        }
    }
    if !completed {
        return Err(EngineError::Goal("evaluator stream ended without completion".into()));
    }
    let verdict: Verdict = serde_json::from_str(text.trim())
        .map_err(|_| EngineError::Goal("evaluator did not return a strict JSON verdict".into()))?;
    if verdict.reason.trim().is_empty() {
        return Err(EngineError::Goal("evaluator reason is empty".into()));
    }
    Ok(verdict)
}

/// Continue an explicitly supplied goal with the existing engine. Evaluator
/// tokens stay off the event stream and out of conversation history. `max_turns`
/// bounds this invocation (zero means unbounded); interruption preserves state.
/// Gated sessions retain their caller-owned approval channel across work turns.
#[allow(clippy::too_many_arguments)]
pub async fn run_goal(
    session: &mut Session,
    goal: &mut GoalState,
    client: &dyn ModelClient,
    evaluator: &dyn ModelClient,
    tools: &ToolRegistry,
    rollout: Option<&RolloutRecorder>,
    events: &EventSink,
    mut approvals: Option<&mut ApprovalGate>,
    interrupt: &InterruptFlag,
    steer: &SteerQueue,
    max_turns: u32,
) -> Result<GoalRunOutcome, EngineError> {
    GoalState::new(&goal.condition, goal.started_at)
        .map_err(|error| EngineError::Goal(error.into()))?;
    checkpoint(goal, rollout).await?;
    if goal.status == GoalStatus::Achieved {
        return Ok(GoalRunOutcome::Achieved);
    }
    let mut ran = 0_u32;
    loop {
        if interrupt.is_tripped() {
            return Ok(GoalRunOutcome::Interrupted);
        }
        if max_turns != 0 && ran >= max_turns {
            return Ok(GoalRunOutcome::TurnBudgetReached);
        }
        let input = vec![InputItem::Text {
            text: format!(
                "Continue toward this completion condition: {}\nRemaining work: {}",
                goal.condition, goal.last_reason
            ),
        }];
        let outcome = run_turn_with_controls(
            session,
            client,
            tools,
            rollout,
            input,
            events,
            approvals.as_deref_mut(),
            interrupt,
            steer,
        )
        .await?;
        if outcome.interrupted || outcome.hit_iteration_cap {
            return Ok(GoalRunOutcome::Interrupted);
        }
        goal.turns = goal
            .turns
            .checked_add(1)
            .ok_or_else(|| EngineError::Goal("goal turn counter overflow".into()))?;
        ran = ran.saturating_add(1);
        // Record work progress before an evaluator failure or cancellation.
        checkpoint(goal, rollout).await?;
        let verdict = tokio::select! {
            biased;
            () = interrupt.cancelled() => return Ok(GoalRunOutcome::Interrupted),
            verdict = evaluate(session, evaluator, &goal.condition) => verdict?,
        };
        let mut next = goal.clone();
        next.last_reason = verdict.reason;
        if verdict.met {
            next.status = GoalStatus::Achieved;
        }
        // Persist before acknowledging completion in memory.
        checkpoint(&next, rollout).await?;
        *goal = next;
        if goal.status == GoalStatus::Achieved {
            return Ok(GoalRunOutcome::Achieved);
        }
    }
}
