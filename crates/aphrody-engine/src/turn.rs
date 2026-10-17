// SPDX-License-Identifier: Apache-2.0
//! The turn loop: the heart of the engine.

use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};

use aphrody_agent_proto::{Event, EventMsg, InputItem, ReviewDecision};
use aphrody_model_client::{
    ChatMessage, ChatTurn, ImageSource, ModelClient, ModelStreamEvent, Part, ToolDecl, TurnOptions,
};
use aphrody_rollout::{RolloutError, RolloutLine, RolloutRecorder};
use aphrody_toolcall::{ToolOutput, ToolRegistry, ToolSafety};
use base64::Engine as _;
use futures::StreamExt;
use serde_json::{Value, json};

use crate::{
    approval::ApprovalGate,
    compaction::{estimate_prompt_overhead, is_compaction_checkpoint},
    config::AutonomyMode,
    error::EngineError,
    session::Session,
    sink::EventSink,
};

#[derive(Debug, Clone, Copy)]
struct HistoryCursor {
    len: usize,
    revision: u64,
}

impl HistoryCursor {
    fn new(session: &Session) -> Self {
        Self {
            len: session.len(),
            revision: session.history_revision(),
        }
    }
}

/// A cooperative cancellation flag shared with the engine.
///
/// The engine checks the flag between steps (before each model call and before
/// each tool call). Setting it requests a clean interruption: the engine emits
/// a [`TurnComplete`](EventMsg::TurnComplete) with `interrupted = true` and
/// returns. Cloning shares the same underlying flag.
#[derive(Debug, Clone, Default)]
pub struct InterruptFlag {
    tripped: Arc<AtomicBool>,
    notification: Arc<tokio::sync::Notify>,
}

impl InterruptFlag {
    /// Create a fresh, un-tripped flag.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Request interruption.
    pub fn trip(&self) {
        self.tripped.store(true, Ordering::SeqCst);
        self.notification.notify_one();
    }

    /// Whether interruption has been requested.
    #[must_use]
    pub fn is_tripped(&self) -> bool {
        self.tripped.load(Ordering::SeqCst)
    }

    /// Wake an in-flight provider wait as soon as cancellation is requested.
    pub(crate) async fn cancelled(&self) {
        loop {
            let notified = self.notification.notified();
            if self.is_tripped() {
                return;
            }
            notified.await;
        }
    }
}

/// A cooperative queue of *steering* input shared with the engine.
///
/// A client or supervisor pushes [`InputItem`]s with [`SteerQueue::push`] while
/// a turn is running. The engine drains the queue at the start of every loop
/// iteration — before the next model call — and folds the items into the
/// conversation as an extra user message, emitting
/// [`SteerApplied`](EventMsg::SteerApplied). This lets a caller course-correct
/// an in-flight turn without interrupting and restarting it. Cloning shares the
/// same underlying queue.
///
/// The queue is pure (no syscalls) and compiles to wasm; a poisoned lock is
/// recovered rather than propagated, because a panic in another holder must not
/// drop already-queued steering.
#[derive(Debug, Clone, Default)]
pub struct SteerQueue(Arc<Mutex<Vec<InputItem>>>);

impl SteerQueue {
    /// Create a fresh, empty steer queue.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Append steering `items` for the running turn to pick up. Empty pushes are
    /// dropped.
    pub fn push(&self, items: Vec<InputItem>) {
        if items.is_empty() {
            return;
        }
        let mut guard = self.0.lock().unwrap_or_else(|e| e.into_inner());
        guard.extend(items);
    }

    /// Take all currently queued steering items, leaving the queue empty.
    #[must_use]
    pub fn drain(&self) -> Vec<InputItem> {
        let mut guard = self.0.lock().unwrap_or_else(|e| e.into_inner());
        std::mem::take(&mut *guard)
    }

    /// Whether the queue currently holds no items.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        let guard = self.0.lock().unwrap_or_else(|e| e.into_inner());
        guard.is_empty()
    }
}

/// The result of a completed (or interrupted) turn.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TurnOutcome {
    /// The last visible agent message produced this turn, if any.
    pub last_agent_message: Option<String>,
    /// How many model<->tool round trips ran (the number of model calls).
    pub tool_iterations: usize,
    /// Whether the turn ended because of an [`InterruptFlag`] trip or an
    /// approval interrupt rather than natural completion.
    pub interrupted: bool,
    /// Whether the turn stopped because it hit
    /// [`max_tool_iterations`](crate::EngineConfig::max_tool_iterations).
    pub hit_iteration_cap: bool,
}

/// A single tool call the model requested, awaiting dispatch.
struct PendingCall {
    id: String,
    name: String,
    arguments: Value,
}

/// Emit `msg` to the sink and, when a recorder is present, mirror it to the
/// rollout as a serialized [`Event`].
pub(crate) async fn emit(
    events: &EventSink,
    rollout: Option<&RolloutRecorder>,
    msg: EventMsg,
) -> Result<(), EngineError> {
    let complete = matches!(
        &msg,
        EventMsg::TurnComplete { .. }
            | EventMsg::ContextCompactionCompleted { .. }
            | EventMsg::Error { .. }
    );
    let event = Event::new(msg);
    if let Some(rec) = rollout {
        rec.record_async(serde_json::to_value(&event).map_err(RolloutError::from)?)
            .await?;
        if complete {
            // Completion is a persistence barrier, not merely a UI notification.
            rec.flush().await?;
        }
    }
    events.send_event(event);
    Ok(())
}

/// `item.type` of a rollout line holding one conversation message.
pub const ROLLOUT_HISTORY_ITEM: &str = "history_item";
/// `item.type` of a rollout line holding the system prompt and tool set the
/// following model calls were made with.
pub const ROLLOUT_TURN_CONTEXT: &str = "turn_context";

/// Write every message appended to `session` since `recorded` to the rollout.
///
/// Events describe what a turn *did*; these lines hold what the model was
/// *given and answered*, verbatim. Together with the turn context they
/// reconstruct any request of the session exactly — which is what resuming,
/// forking and building training sets need.
async fn record_history(
    session: &Session,
    rollout: Option<&RolloutRecorder>,
    recorded: &mut HistoryCursor,
) -> Result<(), EngineError> {
    let history = session.history();
    if recorded.revision != session.history_revision() {
        // A compaction checkpoint replaces the active history. Append the full
        // replacement to the rollout; restore_history recognizes its marker
        // and discards the superseded prefix.
        recorded.len = 0;
        recorded.revision = session.history_revision();
    }
    if let Some(rec) = rollout {
        for message in history.iter().skip(recorded.len) {
            let checkpoint = is_compaction_checkpoint(message);
            let message = serde_json::to_value(message).map_err(RolloutError::from)?;
            rec.record_async(json!({
                "type": ROLLOUT_HISTORY_ITEM,
                "message": message,
                "compaction_checkpoint": checkpoint,
            }))
            .await?;
        }
    }
    recorded.len = history.len();
    Ok(())
}

/// The conversation a rollout recorded, rebuilt from its [`ROLLOUT_HISTORY_ITEM`]
/// lines in order.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RestoredHistory {
    /// The recorded messages, oldest first.
    pub messages: Vec<ChatMessage>,
    /// History lines that could not be decoded. Reported rather than dropped
    /// silently: a resumed session missing messages must be visible as such.
    pub undecodable: usize,
}

/// Rebuild a session's history from the lines of its rollout (see
/// [`aphrody_rollout::resume`]). Lines of any other type are ignored.
#[must_use]
pub fn restore_history(lines: &[RolloutLine]) -> RestoredHistory {
    let mut restored = RestoredHistory::default();
    for line in lines {
        if line.item.get("type").and_then(Value::as_str) != Some(ROLLOUT_HISTORY_ITEM) {
            continue;
        }
        let message = line.item.get("message").cloned().unwrap_or(Value::Null);
        match serde_json::from_value::<ChatMessage>(message) {
            Ok(message) => {
                if line
                    .item
                    .get("compaction_checkpoint")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
                    && is_compaction_checkpoint(&message)
                {
                    restored.messages.clear();
                }
                restored.messages.push(message);
            }
            Err(err) => {
                tracing::warn!("undecodable history line at {}: {err}", line.ts);
                restored.undecodable += 1;
            }
        }
    }
    restored
}

/// Persist a complete replacement history after an explicit actor compaction.
pub(crate) async fn record_compaction_checkpoint(
    session: &Session,
    rollout: Option<&RolloutRecorder>,
) -> Result<(), EngineError> {
    let Some(recorder) = rollout else {
        return Ok(());
    };
    for message in session.history() {
        let checkpoint = is_compaction_checkpoint(message);
        let message = serde_json::to_value(message).map_err(RolloutError::from)?;
        recorder
            .record_async(json!({
                "type": ROLLOUT_HISTORY_ITEM,
                "message": message,
                "compaction_checkpoint": checkpoint,
            }))
            .await?;
    }
    recorder.flush().await?;
    Ok(())
}

/// Write the turn context (model, system prompt, tool declarations) to the
/// rollout when it differs from the one already on record.
async fn record_turn_context(
    session: &mut Session,
    rollout: Option<&RolloutRecorder>,
    model: &str,
    system: Option<&str>,
    tools: &[ToolDecl],
) -> Result<(), EngineError> {
    use std::hash::{Hash, Hasher};

    let Some(rec) = rollout else { return Ok(()) };
    let tools_value = serde_json::to_value(tools).map_err(RolloutError::from)?;
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    model.hash(&mut hasher);
    system.hash(&mut hasher);
    tools_value.to_string().hash(&mut hasher);
    if session.note_recorded_context(hasher.finish()) {
        rec.record_async(json!({
            "type": ROLLOUT_TURN_CONTEXT,
            "model": model,
            "system": system,
            "tools": tools_value,
        }))
        .await?;
    }
    Ok(())
}

/// Media type of an image file, from its extension.
fn image_mime(path: &std::path::Path) -> Option<&'static str> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    Some(match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ => return None,
    })
}

/// Load a local image as an inline [`ImageSource`], or explain why it cannot be.
fn load_image(path: &std::path::Path) -> Result<ImageSource, String> {
    let mime =
        image_mime(path).ok_or_else(|| format!("unsupported image type: {}", path.display()))?;
    let bytes =
        std::fs::read(path).map_err(|err| format!("cannot read {}: {err}", path.display()))?;
    Ok(ImageSource::base64(
        mime,
        base64::engine::general_purpose::STANDARD.encode(bytes),
    ))
}

/// Convert user [`InputItem`]s into the [`Part`]s of a single user message.
///
/// Text items map directly. An image item becomes a real [`Part::Image`] when
/// the model has vision (`vision`), loaded from disk for a path or passed by
/// URL; a text-only model, or an image that cannot be loaded, gets a textual
/// reference instead so the turn still proceeds. An item with neither a path
/// nor a URL is dropped.
fn input_to_parts(input: Vec<InputItem>, vision: bool) -> Vec<Part> {
    let mut parts = Vec::with_capacity(input.len());
    for item in input {
        match item {
            InputItem::Text { text } => parts.push(Part::Text(text)),
            InputItem::Image {
                path: Some(path), ..
            } => {
                if vision {
                    match load_image(&path) {
                        Ok(image) => parts.push(Part::Image(image)),
                        Err(reason) => parts.push(Part::Text(format!("[image: {reason}]"))),
                    }
                } else {
                    parts.push(Part::Text(format!("[image: {}]", path.display())));
                }
            }
            InputItem::Image {
                path: None,
                url: Some(url),
            } => {
                if vision {
                    parts.push(Part::Image(ImageSource::Url(url)));
                } else {
                    parts.push(Part::Text(format!("[image: {url}]")));
                }
            }
            InputItem::Image {
                path: None,
                url: None,
            } => {}
        }
    }
    parts
}

/// Derive the model-visible [`ToolDecl`] list from the registry.
fn tool_decls(tools: &ToolRegistry) -> Vec<ToolDecl> {
    tools
        .model_visible_definitions()
        .into_iter()
        .map(|definition| {
            let decl = definition.to_gemini_declaration();
            ToolDecl {
                name: definition.name.clone(),
                description: definition.description.clone(),
                parameters: decl
                    .get("parameters")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null),
            }
        })
        .collect()
}

/// Drive one full agent turn to completion.
///
/// Appends `input` to `session`'s history, then loops up to
/// [`max_tool_iterations`](crate::EngineConfig::max_tool_iterations) times:
/// stream the model, surface text / reasoning / token events, execute any
/// requested tool calls (honoring [`AutonomyMode`]), re-inject their results,
/// and repeat until the model stops calling tools. Every emitted event is sent
/// to `events` and, when `rollout` is set, mirrored to the recorder.
///
/// `approvals` is only consulted in [`AutonomyMode::Gated`]; pass `None` in
/// [`AutonomyMode::FullAuto`].
///
/// # Errors
///
/// Returns [`EngineError::Model`] if the model stream errors, [`EngineError::Tool`]
/// for a hard registry error, [`EngineError::Aborted`] if an approval decision
/// aborts the turn, or [`EngineError::ApprovalChannelClosed`] if a gated turn's
/// approval channel closes before a decision arrives. [`EngineError::Rollout`]
/// propagates persistence failures; completion is emitted only after a
/// successful rollout flush when a recorder is configured.
#[allow(clippy::too_many_arguments)]
pub async fn run_turn(
    session: &mut Session,
    client: &dyn ModelClient,
    tools: &ToolRegistry,
    rollout: Option<&RolloutRecorder>,
    input: Vec<InputItem>,
    events: &EventSink,
    mut approvals: Option<&mut ApprovalGate>,
) -> Result<TurnOutcome, EngineError> {
    let interrupt = InterruptFlag::new();
    run_turn_with_interrupt(
        session,
        client,
        tools,
        rollout,
        input,
        events,
        approvals.take(),
        &interrupt,
    )
    .await
}

/// Like [`run_turn`] but with an explicit [`InterruptFlag`] the caller can trip
/// from another task to cancel the turn cooperatively.
///
/// This is the no-steering shorthand for [`run_turn_with_controls`]: it runs the
/// turn with a fresh, never-fed [`SteerQueue`], so no mid-turn guidance can be
/// injected.
#[allow(clippy::too_many_arguments)]
pub async fn run_turn_with_interrupt(
    session: &mut Session,
    client: &dyn ModelClient,
    tools: &ToolRegistry,
    rollout: Option<&RolloutRecorder>,
    input: Vec<InputItem>,
    events: &EventSink,
    mut approvals: Option<&mut ApprovalGate>,
    interrupt: &InterruptFlag,
) -> Result<TurnOutcome, EngineError> {
    let steer = SteerQueue::new();
    run_turn_with_controls(
        session,
        client,
        tools,
        rollout,
        input,
        events,
        approvals.take(),
        interrupt,
        &steer,
    )
    .await
}

/// The full turn loop with both cooperative controls: an [`InterruptFlag`] to
/// cancel and a [`SteerQueue`] to inject mid-turn guidance.
///
/// At the top of each iteration (after the interrupt and iteration-cap checks,
/// before the next model call) the loop drains `steer`; any queued items are
/// appended to the conversation as an extra user message and surfaced as an
/// [`EventMsg::SteerApplied`]. Everything else matches
/// [`run_turn`]'s contract.
///
/// # Errors
///
/// Same as [`run_turn`]: [`EngineError::Model`] on a model-stream error,
/// [`EngineError::Aborted`] if an approval aborts the turn, or
/// [`EngineError::ApprovalChannelClosed`] if a gated turn's approval channel
/// closes before a decision arrives.
#[allow(clippy::too_many_arguments)]
pub async fn run_turn_with_controls(
    session: &mut Session,
    client: &dyn ModelClient,
    tools: &ToolRegistry,
    rollout: Option<&RolloutRecorder>,
    input: Vec<InputItem>,
    events: &EventSink,
    mut approvals: Option<&mut ApprovalGate>,
    interrupt: &InterruptFlag,
    steer: &SteerQueue,
) -> Result<TurnOutcome, EngineError> {
    let autonomy = session.config().autonomy;
    let mut system = session.config().system_prompt.clone();
    if let Some(home) = session.refresh_live_home_prompt() {
        system = Some(match system {
            Some(base) if !base.is_empty() => format!("{base}\n\n{home}"),
            _ => home.to_owned(),
        });
    }
    let response_schema = session.config().response_schema.clone();
    let max_iterations = session.config().max_tool_iterations;
    let capabilities = client.capabilities();
    let vision = capabilities.images;
    let context_window = capabilities.context_window;
    let declared_tools = tool_decls(tools);
    let reserved_tokens = estimate_prompt_overhead(system.as_deref(), &declared_tools);

    // 1. Append the user input.
    let mut recorded = HistoryCursor::new(session);
    record_turn_context(
        session,
        rollout,
        client.model_id(),
        system.as_deref(),
        &declared_tools,
    )
    .await?;
    let parts = input_to_parts(input, vision);
    session.push_user(parts);
    record_history(session, rollout, &mut recorded).await?;

    // 2. Announce the turn.
    emit(events, rollout, EventMsg::TurnStarted).await?;

    let mut outcome = TurnOutcome::default();

    loop {
        if interrupt.is_tripped() {
            outcome.interrupted = true;
            emit(
                events,
                rollout,
                EventMsg::TurnComplete {
                    last_agent_message: outcome.last_agent_message.clone(),
                },
            )
            .await?;
            return Ok(outcome);
        }

        if max_iterations != 0 && outcome.tool_iterations >= max_iterations {
            outcome.hit_iteration_cap = true;
            emit(
                events,
                rollout,
                EventMsg::Error {
                    message: format!("max tool iterations reached ({max_iterations})"),
                },
            )
            .await?;
            emit(
                events,
                rollout,
                EventMsg::TurnComplete {
                    last_agent_message: outcome.last_agent_message.clone(),
                },
            )
            .await?;
            return Ok(outcome);
        }

        // 3·. Fold in any steering guidance queued since the previous model
        // call, as an extra user message, so the upcoming call course-corrects.
        let steered = steer.drain();
        if !steered.is_empty() {
            let parts = input_to_parts(steered, vision);
            if !parts.is_empty() {
                let text = parts
                    .iter()
                    .filter_map(|part| match part {
                        Part::Text(t) => Some(t.as_str()),
                        _ => None,
                    })
                    .collect::<Vec<_>>()
                    .join("\n");
                session.push_user(parts);
                record_history(session, rollout, &mut recorded).await?;
                emit(events, rollout, EventMsg::SteerApplied { text }).await?;
            }
        }

        if let Some(report) = session.compact_if_needed(context_window, reserved_tokens) {
            tracing::info!(
                compacted_messages = report.compacted_messages,
                retained_messages = report.retained_messages,
                tokens_before = report.tokens_before,
                tokens_after = report.tokens_after,
                within_target = report.within_target,
                source_fingerprint = %report.source_fingerprint,
                "compacted agent history"
            );
            record_history(session, rollout, &mut recorded).await?;
        }

        // 3a. Build the turn snapshot.
        let chat_turn = ChatTurn {
            system: system.clone(),
            messages: session.history().to_vec(),
            tools: declared_tools.clone(),
            options: TurnOptions {
                response_schema: response_schema.clone(),
                ..TurnOptions::default()
            },
        };

        // 3b. Stream the model.
        let mut stream = tokio::select! {
            biased;
            () = interrupt.cancelled() => {
                outcome.interrupted = true;
                emit(events, rollout, EventMsg::TurnComplete {
                    last_agent_message: outcome.last_agent_message.clone(),
                }).await?;
                return Ok(outcome);
            }
            stream = client.stream(chat_turn) => stream.map_err(EngineError::Model)?,
        };
        outcome.tool_iterations = outcome.tool_iterations.saturating_add(1);

        // Everything this response produced, in generation order; `segment`
        // holds the visible text not yet closed into a part.
        let mut model_parts: Vec<Part> = Vec::new();
        let mut segment = String::new();
        let mut text_buf = String::new();
        let mut pending_calls: Vec<PendingCall> = Vec::new();

        loop {
            let event = tokio::select! {
                biased;
                () = interrupt.cancelled() => {
                    outcome.interrupted = true;
                    emit(events, rollout, EventMsg::TurnComplete {
                        last_agent_message: outcome.last_agent_message.clone(),
                    }).await?;
                    return Ok(outcome);
                }
                event = stream.next() => event,
            };
            let Some(event) = event else {
                break;
            };
            match event {
                Ok(ModelStreamEvent::Created) => {}
                Ok(ModelStreamEvent::TextDelta(delta)) => {
                    text_buf.push_str(&delta);
                    segment.push_str(&delta);
                    emit(events, rollout, EventMsg::AgentMessageDelta { delta }).await?;
                }
                Ok(ModelStreamEvent::ReasoningDelta(delta)) => {
                    emit(events, rollout, EventMsg::AgentReasoningDelta { delta }).await?;
                }
                Ok(ModelStreamEvent::ReasoningItem { text, opaque }) => {
                    close_text_segment(&mut model_parts, &mut segment);
                    model_parts.push(Part::Reasoning { text, opaque });
                }
                // Live fragments of a call still being generated; the assembled
                // call follows as `ToolCall`, which is what the loop acts on.
                Ok(ModelStreamEvent::ToolCallDelta { .. }) => {}
                Ok(ModelStreamEvent::ToolCall {
                    id,
                    name,
                    arguments,
                }) => {
                    close_text_segment(&mut model_parts, &mut segment);
                    model_parts.push(Part::function_call(&id, &name, arguments.clone()));
                    pending_calls.push(PendingCall {
                        id,
                        name,
                        arguments,
                    });
                }
                Ok(ModelStreamEvent::Completed {
                    usage,
                    finish_reason: _,
                }) => {
                    if let Some(usage) = usage {
                        emit(
                            events,
                            rollout,
                            EventMsg::TokenCount {
                                input: usage.input_tokens,
                                output: usage.output_tokens,
                                total: usage.total_tokens,
                            },
                        )
                        .await?;
                    }
                    break;
                }
                Err(err) => {
                    emit(
                        events,
                        rollout,
                        EventMsg::Error {
                            message: err.to_string(),
                        },
                    )
                    .await?;
                    return Err(EngineError::Model(err));
                }
            }
        }

        // 3c. Record the whole response — reasoning, text, calls — as one
        // model message, and surface the visible text.
        close_text_segment(&mut model_parts, &mut segment);
        session.push_model_parts(model_parts);
        record_history(session, rollout, &mut recorded).await?;
        if !text_buf.is_empty() {
            emit(
                events,
                rollout,
                EventMsg::AgentMessage {
                    text: text_buf.clone(),
                },
            )
            .await?;
            outcome.last_agent_message = Some(text_buf);
        }

        // 3d. No tool calls => the turn is complete.
        if pending_calls.is_empty() {
            emit(
                events,
                rollout,
                EventMsg::TurnComplete {
                    last_agent_message: outcome.last_agent_message.clone(),
                },
            )
            .await?;
            return Ok(outcome);
        }

        // 3e. Dispatch each requested tool call. The results are re-injected
        // together, as one tool message answering the model message above.
        let mut responses: Vec<Part> = Vec::with_capacity(pending_calls.len());
        let mut calls = pending_calls.into_iter();
        while let Some(call) = calls.next() {
            if interrupt.is_tripped() {
                outcome.interrupted = true;
                abandon_calls(
                    &mut responses,
                    call,
                    calls,
                    "turn interrupted before this call ran",
                );
                session.push_tool_responses(responses);
                record_history(session, rollout, &mut recorded).await?;
                emit(
                    events,
                    rollout,
                    EventMsg::TurnComplete {
                        last_agent_message: outcome.last_agent_message.clone(),
                    },
                )
                .await?;
                return Ok(outcome);
            }

            emit(
                events,
                rollout,
                EventMsg::ToolCallBegin {
                    call_id: call.id.clone(),
                    name: call.name.clone(),
                },
            )
            .await?;

            let executor = tools.get(&call.name);

            // Command-safety: refuse a known-destructive call before approval or
            // execution, in any autonomy mode (defense-in-depth over the tool's
            // own checks). The default ToolSafety::Safe leaves every existing
            // tool's behaviour unchanged.
            if executor
                .as_ref()
                .is_some_and(|exec| exec.safety(&call.arguments) == ToolSafety::Refuse)
            {
                let output = ToolOutput::error(format!(
                    "tool call `{}` refused: command-safety classified it as known-destructive",
                    call.name
                ));
                responses.push(finish_tool(events, rollout, &call, output, vision).await?);
                continue;
            }

            // Gated approval, if configured.
            if autonomy == AutonomyMode::Gated {
                match approve(&call, events, rollout, approvals.as_deref_mut()).await? {
                    Gate::Approved => {}
                    Gate::Denied => {
                        let output = ToolOutput::error(format!(
                            "tool call `{}` denied by approval policy",
                            call.name
                        ));
                        responses.push(finish_tool(events, rollout, &call, output, vision).await?);
                        continue;
                    }
                    Gate::Abort => {
                        outcome.interrupted = true;
                        abandon_calls(&mut responses, call, calls, "turn aborted by approval");
                        session.push_tool_responses(responses);
                        record_history(session, rollout, &mut recorded).await?;
                        emit(
                            events,
                            rollout,
                            EventMsg::TurnComplete {
                                last_agent_message: outcome.last_agent_message.clone(),
                            },
                        )
                        .await?;
                        return Ok(outcome);
                    }
                }
            }

            // Execute the tool.
            let output = match executor {
                None => ToolOutput::error(format!("unknown tool `{}`", call.name)),
                Some(executor) => match executor.handle(call.arguments.clone()).await {
                    Ok(output) => output,
                    Err(err) => ToolOutput::error(format!("tool `{}` failed: {err}", call.name)),
                },
            };

            responses.push(finish_tool(events, rollout, &call, output, vision).await?);
        }
        session.push_tool_responses(responses);
        record_history(session, rollout, &mut recorded).await?;

        // 3f. Re-loop: the next model call sees the appended tool results.
    }
}

/// Close the visible text accumulated since the last non-text part into a
/// [`Part::Text`], keeping the response's parts in generation order.
fn close_text_segment(parts: &mut Vec<Part>, segment: &mut String) {
    if !segment.is_empty() {
        parts.push(Part::Text(std::mem::take(segment)));
    }
}

/// Answer `current` and every call still in `rest` with an error response.
///
/// The model message already lists these calls; providers reject a history in
/// which a call has no matching response, so a turn that stops early still
/// leaves the conversation resumable.
fn abandon_calls(
    responses: &mut Vec<Part>,
    current: PendingCall,
    rest: impl Iterator<Item = PendingCall>,
    reason: &str,
) {
    for call in std::iter::once(current).chain(rest) {
        responses.push(Part::function_response(
            call.id,
            call.name,
            json!({ "output": reason, "is_error": true }),
        ));
    }
}

/// Outcome of an approval check.
enum Gate {
    Approved,
    Denied,
    Abort,
}

/// Resolve the approval for `call` per the gate, emitting the request event.
async fn approve(
    call: &PendingCall,
    events: &EventSink,
    rollout: Option<&RolloutRecorder>,
    approvals: Option<&mut ApprovalGate>,
) -> Result<Gate, EngineError> {
    emit(
        events,
        rollout,
        EventMsg::ExecApprovalRequest {
            id: call.id.clone(),
            command: vec![call.name.clone()],
            reason: Some(format!("tool call `{}`", call.name)),
        },
    )
    .await?;

    let Some(gate) = approvals else {
        // Gated mode without a wired channel cannot obtain a decision; deny the
        // call so the turn can proceed safely rather than block forever.
        return Ok(Gate::Denied);
    };

    match gate.wait_for(&call.id).await {
        Some(ReviewDecision::Approved | ReviewDecision::ApprovedForSession) => Ok(Gate::Approved),
        Some(ReviewDecision::Denied) => Ok(Gate::Denied),
        Some(ReviewDecision::Abort) => Ok(Gate::Abort),
        None => Err(EngineError::ApprovalChannelClosed),
    }
}

/// Emit the tool-call end event and build the function response answering
/// `call`.
///
/// Images the tool produced reach the model only when it has vision; a
/// text-only model is told how many were withheld, so it knows the call did
/// produce them instead of reasoning on a silently truncated result.
async fn finish_tool(
    events: &EventSink,
    rollout: Option<&RolloutRecorder>,
    call: &PendingCall,
    output: ToolOutput,
    vision: bool,
) -> Result<Part, EngineError> {
    emit(
        events,
        rollout,
        EventMsg::ToolCallEnd {
            call_id: call.id.clone(),
            ok: !output.is_error,
        },
    )
    .await?;

    let mut response = json!({ "output": output.content, "is_error": output.is_error });
    let images = if vision {
        output
            .images
            .into_iter()
            .map(|image| ImageSource::base64(image.mime, image.data_base64))
            .collect()
    } else {
        if !output.images.is_empty() {
            response["images_withheld"] = json!(output.images.len());
        }
        Vec::new()
    };

    Ok(Part::FunctionResponse {
        id: call.id.clone(),
        name: call.name.clone(),
        response,
        images,
    })
}
