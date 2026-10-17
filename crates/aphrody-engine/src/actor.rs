// SPDX-License-Identifier: Apache-2.0
//! A long-lived session actor that drives [`run_turn`](crate::run_turn) from a
//! stream of [`Submission`]s.
//!
//! [`spawn_session`] wires the SQ/EQ pattern end to end: the caller submits
//! [`Op`]s over a channel and receives [`Event`]s on another. A
//! [`Op::UserInput`] starts a turn; [`Op::ExecApproval`] / [`Op::PatchApproval`]
//! answer a pending approval; [`Op::Interrupt`] trips the running turn's
//! interrupt flag; [`Op::Steer`] queues mid-turn guidance the loop folds in
//! before its next model call; [`Op::Shutdown`] drains and stops the actor.

use std::sync::Arc;

use aphrody_agent_proto::{Event, EventMsg, Op, Submission};
use aphrody_model_client::ModelClient;
use aphrody_rollout::RolloutRecorder;
use aphrody_toolcall::ToolRegistry;
use tokio::{sync::mpsc, task::JoinHandle};

use crate::{
    approval::ApprovalGate,
    config::AutonomyMode,
    session::Session,
    sink::EventSink,
    turn::{InterruptFlag, SteerQueue, emit, record_compaction_checkpoint, run_turn_with_controls},
};

/// Handle to a spawned session actor.
///
/// Submit work with [`SessionHandle::submit`] and drain results from
/// [`SessionHandle::events`]. Dropping all clones of the submission sender (or
/// sending [`Op::Shutdown`]) lets the actor finish and exit; [`join`](Self::join)
/// awaits its task.
#[derive(Debug)]
pub struct SessionHandle {
    submissions: mpsc::UnboundedSender<Submission>,
    events: Option<mpsc::UnboundedReceiver<Event>>,
    task: JoinHandle<Session>,
    tool_updates: tokio::sync::watch::Sender<Arc<ToolRegistry>>,
}

impl SessionHandle {
    /// Replace the tool surface before the next submitted turn. Hosts must
    /// enforce their idle-session policy before invoking this method.
    ///
    /// # Errors
    /// Returns the registry if the session actor stopped.
    pub fn replace_tools(&self, tools: Arc<ToolRegistry>) -> Result<(), Arc<ToolRegistry>> {
        self.tool_updates.send(tools).map_err(|error| error.0)
    }
    /// Submit an op to the actor.
    ///
    /// # Errors
    /// Returns the submission back if the actor has already stopped.
    pub fn submit(&self, op: Op) -> Result<(), Submission> {
        let submission = Submission::new(op);
        self.submissions.send(submission).map_err(|e| e.0)
    }

    /// Take ownership of the event receiver (callable once).
    pub fn events(&mut self) -> Option<mpsc::UnboundedReceiver<Event>> {
        self.events.take()
    }

    /// Await the actor's task, recovering the final [`Session`] state.
    ///
    /// # Errors
    /// Returns a [`tokio::task::JoinError`] if the actor task panicked.
    pub async fn join(self) -> Result<Session, tokio::task::JoinError> {
        self.task.await
    }
}

/// Spawn a session actor driven by `client` + `tools`, optionally recording to
/// `rollout`.
///
/// Returns a [`SessionHandle`] owning the submission sender, the event
/// receiver, and the actor task handle.
#[must_use]
pub fn spawn_session(
    mut session: Session,
    client: Arc<dyn ModelClient>,
    tools: Arc<ToolRegistry>,
    rollout: Option<RolloutRecorder>,
) -> SessionHandle {
    let (sub_tx, mut sub_rx) = mpsc::unbounded_channel::<Submission>();
    let (event_sink, event_rx) = EventSink::unbounded();
    let (tool_updates, mut tool_rx) = tokio::sync::watch::channel(tools.clone());

    let task = tokio::spawn(async move {
        let gated = session.config().autonomy == AutonomyMode::Gated;
        let context_window = client.capabilities().context_window;
        // The approval sender is only used when gated; we keep it alive so the
        // gate's channel does not close between turns.
        let (approval_tx, mut gate) = ApprovalGate::channel();

        while let Some(submission) = sub_rx.recv().await {
            let tools = tool_rx.borrow_and_update().clone();
            match submission.op {
                Op::UserInput { items } => {
                    let interrupt = InterruptFlag::new();
                    let steer = SteerQueue::new();
                    // Forward any interrupt/steer/approval ops that arrive
                    // *during* the turn into the running loop.
                    let approvals = if gated { Some(&mut gate) } else { None };
                    let control = drive_turn(
                        &mut session,
                        client.as_ref(),
                        tools.as_ref(),
                        rollout.as_ref(),
                        items,
                        &event_sink,
                        approvals,
                        &mut sub_rx,
                        &approval_tx,
                        &interrupt,
                        &steer,
                    )
                    .await;
                    if let Err(err) = control.result {
                        event_sink.emit(aphrody_agent_proto::EventMsg::Error {
                            message: err.to_string(),
                        });
                    }
                    if control.compact {
                        compact_session(
                            &mut session,
                            context_window,
                            rollout.as_ref(),
                            &event_sink,
                        )
                        .await;
                    }
                    if control.shutdown {
                        // A Shutdown / closed channel was observed mid-turn.
                        break;
                    }
                }
                Op::ExecApproval { .. } | Op::PatchApproval { .. } => {
                    // An approval that arrives outside a turn has nothing to
                    // answer; forward it to the gate so an in-flight wait (if
                    // any) can observe it, ignoring send failures.
                    let _ = approval_tx.send(submission.op);
                }
                Op::Interrupt => {
                    // No turn is currently running (we are between turns); a
                    // standalone interrupt is a no-op other than acknowledging.
                }
                Op::Steer { .. } => {
                    // No turn is running, so there is nothing to steer; the
                    // guidance is dropped. A client should start a turn with
                    // Op::UserInput instead.
                }
                Op::Compact => {
                    compact_session(&mut session, context_window, rollout.as_ref(), &event_sink)
                        .await;
                }
                Op::Shutdown => break,
            }
        }

        if let Some(rollout) = rollout
            && let Err(error) = rollout.shutdown().await
        {
            event_sink.emit(aphrody_agent_proto::EventMsg::Error {
                message: error.to_string(),
            });
        }
        session
    });

    SessionHandle {
        submissions: sub_tx,
        events: Some(event_rx),
        task,
        tool_updates,
    }
}

/// The outcome of [`drive_turn`]: the turn's result plus whether a shutdown
/// (explicit [`Op::Shutdown`] or a closed submission channel) was observed while
/// the turn ran, so the actor loop can exit.
struct TurnControl {
    result: Result<(), crate::EngineError>,
    shutdown: bool,
    compact: bool,
}

async fn compact_session(
    session: &mut Session,
    context_window: Option<u64>,
    rollout: Option<&RolloutRecorder>,
    events: &EventSink,
) {
    let item_id = Submission::new(Op::Compact).id;
    if let Err(error) = emit(
        events,
        rollout,
        EventMsg::ContextCompactionStarted {
            item_id: item_id.clone(),
        },
    )
    .await
    {
        compaction_failed(events, rollout, error).await;
        return;
    }
    if let Some(report) = session.compact(context_window) {
        tracing::info!(
            compacted_messages = report.compacted_messages,
            retained_messages = report.retained_messages,
            tokens_before = report.tokens_before,
            tokens_after = report.tokens_after,
            within_target = report.within_target,
            source_fingerprint = %report.source_fingerprint,
            "explicitly compacted agent history"
        );
        if let Err(error) = record_compaction_checkpoint(session, rollout).await {
            compaction_failed(events, rollout, error).await;
            return;
        }
    }
    if let Err(error) = emit(
        events,
        rollout,
        EventMsg::ContextCompactionCompleted { item_id },
    )
    .await
    {
        compaction_failed(events, rollout, error).await;
    }
}

async fn compaction_failed(
    events: &EventSink,
    rollout: Option<&RolloutRecorder>,
    error: crate::EngineError,
) {
    let msg = EventMsg::Error {
        message: error.to_string(),
    };
    // Try to persist the terminal error, but a failed recorder must not
    // prevent the live client from observing failure and releasing its turn.
    if emit(events, rollout, msg.clone()).await.is_err() {
        events.emit(msg);
    }
}

/// Drive a single turn while concurrently servicing interrupt/approval ops that
/// arrive on the submission channel.
#[allow(clippy::too_many_arguments)]
async fn drive_turn(
    session: &mut Session,
    client: &dyn ModelClient,
    tools: &ToolRegistry,
    rollout: Option<&RolloutRecorder>,
    items: Vec<aphrody_agent_proto::InputItem>,
    events: &EventSink,
    approvals: Option<&mut ApprovalGate>,
    sub_rx: &mut mpsc::UnboundedReceiver<Submission>,
    approval_tx: &mpsc::UnboundedSender<Op>,
    interrupt: &InterruptFlag,
    steer: &SteerQueue,
) -> TurnControl {
    // Run the turn as a child future and, in parallel, pump incoming control
    // submissions (Interrupt -> trip the flag; Steer -> queue guidance;
    // approvals -> forward to gate).
    let turn = run_turn_with_controls(
        session, client, tools, rollout, items, events, approvals, interrupt, steer,
    );
    tokio::pin!(turn);

    let mut shutdown = false;
    let mut compact = false;
    loop {
        tokio::select! {
            biased;
            // Poll the turn first so it makes progress; control ops are only
            // serviced when the turn future is pending at an await point. This
            // lets a turn run to natural completion even if a Shutdown is
            // already queued behind the UserInput that started it.
            outcome = &mut turn => {
                return TurnControl { result: outcome.map(|_| ()), shutdown, compact };
            }
            maybe_sub = sub_rx.recv() => {
                match maybe_sub {
                    Some(sub) => match sub.op {
                        Op::Interrupt => interrupt.trip(),
                        // Live steering: queue the guidance for the turn loop to
                        // fold in before its next model call.
                        Op::Steer { items } => steer.push(items),
                        op @ (Op::ExecApproval { .. } | Op::PatchApproval { .. }) => {
                            let _ = approval_tx.send(op);
                        }
                        // Match RPC's active-turn refusal. An accepted submission
                        // must never disappear without a client-visible result.
                        Op::UserInput { .. } => {
                            events.emit(aphrody_agent_proto::EventMsg::Error {
                                message: format!("submission {} rejected: turn already active; use Steer", sub.id),
                            });
                        }
                        Op::Compact => {
                            compact = true;
                            interrupt.trip();
                        }
                        Op::Shutdown => {
                            shutdown = true;
                            interrupt.trip();
                        }
                    },
                    None => {
                        shutdown = true;
                        interrupt.trip();
                    }
                }
            }
        }
    }
}
