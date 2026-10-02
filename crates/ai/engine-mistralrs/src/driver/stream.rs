// SPDX-License-Identifier: Apache-2.0
//! One upstream response channel as one [`ModelStream`].
//!
//! mistral.rs answers a streaming request through a channel of `Response`s, and the handle that
//! reads it borrows the `Model`. [`open`] gives the borrow to a task, [`pump`], that owns the
//! model handle, drains the channel as fast as the engine fills it, sorts each response with
//! [`classify`], runs the chunks through `StreamState`, and queues the neutral events on an
//! unbounded channel. [`event_stream`] is the reading side.
//!
//! Three properties are worth the plumbing:
//!
//! - **The engine is never held up by a slow reader.** mistral.rs awaits every send, so one
//!   consumer that stops polling would otherwise stall the scheduler for every other sequence.
//!   The queue is unbounded because a turn is bounded by its token limit.
//! - **Dropping the stream cancels the generation.** The pump watches the queue; when the reader
//!   is gone it returns, which drops the upstream handle, and mistral.rs' scheduler cancels a
//!   sequence whose response channel closed.
//! - **A stream never ends silently.** Anything that cuts a turn short (the engine thread dying,
//!   a panic in the pump) ends in a `ModelError`, not in a plain end of stream that the turn loop
//!   would take for a finished answer.

use std::sync::Arc;

use aphrody_model_client::{ModelError, ModelStream, ModelStreamEvent};
use futures::{Stream, StreamExt};
use mistralrs::{Model, RequestBuilder, Response};
use tokio::sync::mpsc;

use super::response::{Step, classify, sdk_error};
use crate::events::StreamState;

/// What the pump queues and the reader yields.
type Item = Result<ModelStreamEvent, ModelError>;

/// Start `request` and wait for the engine's first answer.
///
/// An error before any event, such as a prompt longer than the context or a malformed template,
/// is an error of this call, the way an HTTP status is for the network clients. From the first
/// event on, errors are items of the stream.
pub(crate) async fn open(
    model: Arc<Model>,
    request: RequestBuilder,
) -> Result<ModelStream, ModelError> {
    let (queue, events) = mpsc::unbounded_channel();
    tokio::spawn(pump(model, request, queue));
    answer(events).await
}

/// The first queued item decides: an error is the error of the call, anything else starts the
/// stream, with that item first.
async fn answer(mut events: mpsc::UnboundedReceiver<Item>) -> Result<ModelStream, ModelError> {
    match events.recv().await {
        Some(Ok(first)) => Ok(event_stream(Ok(first), events)),
        Some(Err(error)) => Err(error),
        None => Err(ModelError::Stream("the stream task stopped before answering".into())),
    }
}

/// Start the request on the engine and hand its response channel to [`drive`].
///
/// The handle that reads the channel borrows `model`, so both live in this one task.
async fn pump(model: Arc<Model>, request: RequestBuilder, queue: mpsc::UnboundedSender<Item>) {
    match model.stream_chat_request(request).await {
        Ok(upstream) => drive(upstream, queue).await,
        Err(error) => {
            let _ = queue.send(Err(sdk_error(&error)));
        },
    }
}

/// Drain `upstream` into `queue` until the turn ends, the engine fails, or the reader leaves.
///
/// `upstream` is the response channel of mistral.rs' streaming request. It is a generic stream
/// here so the tests can drive the loop without a model.
async fn drive<S>(mut upstream: S, queue: mpsc::UnboundedSender<Item>)
where
    S: Stream<Item = Response> + Unpin,
{
    let mut state = StreamState::default();
    let mut started = false;
    loop {
        let next = tokio::select! {
            biased;
            () = queue.closed() => {
                tracing::debug!("stream dropped by its reader: cancelling the generation");
                return;
            },
            next = upstream.next() => next,
        };
        let Some(response) = next else {
            // The engine closed its channel: the normal end of a turn, if it said how it ended.
            let tail: Vec<Item> = if state.is_terminal() {
                state.finish().into_iter().map(Ok).collect()
            } else {
                vec![Err(cut_short(started))]
            };
            for item in tail {
                if queue.send(item).is_err() {
                    break;
                }
            }
            return;
        };
        match classify(response) {
            Step::Skip => {},
            Step::Failed(error) => {
                let _ = queue.send(Err(error));
                return;
            },
            Step::Chunk(chunk) => {
                if !started {
                    started = true;
                    if queue.send(Ok(ModelStreamEvent::Created)).is_err() {
                        return;
                    }
                }
                for event in state.push(chunk) {
                    if queue.send(Ok(event)).is_err() {
                        return;
                    }
                }
            },
        }
    }
}

fn cut_short(started: bool) -> ModelError {
    ModelError::Stream(
        if started {
            "mistral.rs closed the response channel before reporting how the turn ended; the \
             generation was cut short (the engine thread may have stopped)"
        } else {
            "mistral.rs closed the response channel without answering (the engine thread may \
             have stopped)"
        }
        .to_owned(),
    )
}

/// The reading side: `first` (already taken off the queue by [`open`]), then the queue.
///
/// The stream ends right after a terminal item (`Completed` or an error). A queue that closes
/// before one arrived means the pump died without finishing the turn; that is reported, once, as
/// an error.
pub(crate) fn event_stream(first: Item, queue: mpsc::UnboundedReceiver<Item>) -> ModelStream {
    Box::pin(futures::stream::unfold(
        (Some(first), queue, false),
        |(pending, mut queue, finished)| async move {
            if finished {
                return None;
            }
            let item = match pending {
                Some(item) => item,
                None => queue.recv().await.unwrap_or_else(|| {
                    Err(ModelError::Stream(
                        "the mistral.rs stream task stopped without a terminal event".into(),
                    ))
                }),
            };
            let finished = matches!(item, Ok(ModelStreamEvent::Completed { .. }) | Err(_));
            Some((item, (None, queue, finished)))
        },
    ))
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use mistralrs::core::BlockDenoisingProgress;

    use super::super::response::fixtures::{last, text, tool_call, usage};
    use super::*;

    fn completed() -> ModelStreamEvent {
        ModelStreamEvent::Completed { usage: None, finish_reason: Some("stop".into()) }
    }

    /// Run `drive` over `responses`, as if the engine sent them and then closed its channel, and
    /// return what the reader would see.
    async fn driven(responses: Vec<Response>) -> Vec<Item> {
        let (queue, mut events) = mpsc::unbounded_channel();
        drive(futures::stream::iter(responses), queue).await;
        let mut items = Vec::new();
        while let Some(item) = events.recv().await {
            items.push(item);
        }
        items
    }

    async fn drain(first: Item, queued: Vec<Item>) -> Vec<Item> {
        let (queue, events) = mpsc::unbounded_channel();
        for item in queued {
            queue.send(item).expect("the receiver is alive");
        }
        drop(queue);
        event_stream(first, events).collect().await
    }

    #[tokio::test]
    async fn a_normal_turn_is_created_then_content_then_one_completed() {
        let items =
            driven(vec![text("he"), text("llo"), last("stop", usage(10, 4, Some(6)))]).await;
        let events: Vec<ModelStreamEvent> =
            items.into_iter().map(|item| item.expect("no error item")).collect();
        assert_eq!(events.len(), 4, "{events:?}");
        assert_eq!(events[0], ModelStreamEvent::Created);
        assert_eq!(events[1], ModelStreamEvent::TextDelta("he".into()));
        assert_eq!(events[2], ModelStreamEvent::TextDelta("llo".into()));
        let ModelStreamEvent::Completed { usage: Some(usage), finish_reason } = &events[3] else {
            panic!("expected Completed with usage, got {:?}", events[3]);
        };
        assert_eq!(finish_reason.as_deref(), Some("stop"));
        let counted = (usage.input_tokens, usage.output_tokens, usage.cached_input_tokens);
        assert_eq!(counted, (10, 4, 6));
    }

    #[tokio::test]
    async fn a_tool_call_arrives_whole_and_the_turn_ends_with_tool_calls() {
        let items = driven(vec![tool_call("call-1", "ls", r#"{"path":"."}"#)]).await;
        assert!(matches!(
            items.as_slice(),
            [
                Ok(ModelStreamEvent::Created),
                Ok(ModelStreamEvent::ToolCall { id, name, arguments }),
                Ok(ModelStreamEvent::Completed { finish_reason: Some(reason), .. }),
            ] if id == "call-1"
                && name == "ls"
                && arguments["path"] == "."
                && reason == "tool_calls"
        ));
    }

    #[tokio::test]
    async fn an_engine_that_closes_mid_turn_is_an_error_not_a_completion() {
        let items = driven(vec![text("partial")]).await;
        assert!(matches!(
            items.as_slice(),
            [
                Ok(ModelStreamEvent::Created),
                Ok(ModelStreamEvent::TextDelta(_)),
                Err(ModelError::Stream(reason)),
            ] if reason.contains("before reporting how the turn ended")
        ));
    }

    #[tokio::test]
    async fn a_channel_closed_before_any_answer_is_an_error_without_created() {
        let items = driven(Vec::new()).await;
        assert!(matches!(
            items.as_slice(),
            [Err(ModelError::Stream(reason))] if reason.contains("without answering")
        ));
    }

    #[tokio::test]
    async fn an_engine_error_is_the_first_item_when_it_comes_first() {
        let items = driven(vec![Response::ValidationError("too long".into()), text("late")]).await;
        assert!(matches!(
            items.as_slice(),
            [Err(ModelError::Api { status: 400, message })] if message == "too long"
        ));
    }

    #[tokio::test]
    async fn an_engine_error_mid_turn_follows_created_and_ends_the_stream() {
        let failure = Response::InternalError("boom".into());
        let items = driven(vec![text("a"), failure, text("b")]).await;
        assert!(matches!(
            items.as_slice(),
            [
                Ok(ModelStreamEvent::Created),
                Ok(ModelStreamEvent::TextDelta(_)),
                Err(ModelError::Api { status: 500, .. }),
            ]
        ));
    }

    #[tokio::test]
    async fn progress_responses_are_invisible() {
        let progress = BlockDenoisingProgress {
            index: 0,
            step: 1,
            total_steps: 2,
            tokens: Vec::new(),
            text: String::new(),
            finished: false,
            final_block: false,
        };
        let items = driven(vec![
            Response::BlockDenoisingProgress(progress),
            text("a"),
            last("stop", usage(1, 1, None)),
        ])
        .await;
        assert!(matches!(
            items.as_slice(),
            [
                Ok(ModelStreamEvent::Created),
                Ok(ModelStreamEvent::TextDelta(_)),
                Ok(ModelStreamEvent::Completed { .. }),
            ]
        ));
    }

    #[tokio::test]
    async fn a_reader_that_leaves_stops_the_pump_even_when_the_engine_is_silent() {
        let (queue, events) = mpsc::unbounded_channel();
        drop(events);
        let silent = futures::stream::pending::<Response>();
        let stopped = tokio::time::timeout(Duration::from_secs(10), drive(silent, queue)).await;
        assert!(stopped.is_ok(), "the pump must notice the dropped reader");
    }

    #[tokio::test]
    async fn the_first_item_decides_whether_the_call_fails() {
        let (queue, events) = mpsc::unbounded_channel();
        queue.send(Err(ModelError::Api { status: 400, message: "bad".into() })).unwrap();
        let refused = answer(events).await;
        assert!(matches!(refused, Err(ModelError::Api { status: 400, .. })));

        let (queue, events) = mpsc::unbounded_channel();
        queue.send(Ok(ModelStreamEvent::Created)).unwrap();
        queue.send(Ok(ModelStreamEvent::TextDelta("hi".into()))).unwrap();
        queue.send(Ok(completed())).unwrap();
        drop(queue);
        let Ok(stream) = answer(events).await else { panic!("the call must succeed") };
        let items: Vec<Item> = stream.collect().await;
        assert!(matches!(
            items.as_slice(),
            [
                Ok(ModelStreamEvent::Created),
                Ok(ModelStreamEvent::TextDelta(_)),
                Ok(ModelStreamEvent::Completed { .. }),
            ]
        ));

        let (queue, events) = mpsc::unbounded_channel::<Item>();
        drop(queue);
        assert!(matches!(answer(events).await, Err(ModelError::Stream(_))));
    }

    #[tokio::test]
    async fn the_first_item_leads_and_the_stream_ends_after_completed() {
        let items = drain(
            Ok(ModelStreamEvent::Created),
            vec![
                Ok(ModelStreamEvent::TextDelta("hi".into())),
                Ok(completed()),
                // Anything after the terminal item is never yielded.
                Ok(ModelStreamEvent::TextDelta("late".into())),
            ],
        )
        .await;
        assert!(matches!(
            items.as_slice(),
            [
                Ok(ModelStreamEvent::Created),
                Ok(ModelStreamEvent::TextDelta(text)),
                Ok(ModelStreamEvent::Completed { .. }),
            ] if text == "hi"
        ));
    }

    #[tokio::test]
    async fn a_queue_that_closes_without_a_terminal_item_ends_in_one_error() {
        let items = drain(
            Ok(ModelStreamEvent::Created),
            vec![Ok(ModelStreamEvent::TextDelta("partial".into()))],
        )
        .await;
        assert!(matches!(
            items.as_slice(),
            [
                Ok(ModelStreamEvent::Created),
                Ok(ModelStreamEvent::TextDelta(_)),
                Err(ModelError::Stream(reason)),
            ] if reason.contains("without a terminal event")
        ));
    }

    #[tokio::test]
    async fn an_error_item_is_terminal() {
        let items = drain(
            Ok(ModelStreamEvent::Created),
            vec![
                Err(ModelError::Api { status: 500, message: "boom".into() }),
                Ok(ModelStreamEvent::TextDelta("late".into())),
            ],
        )
        .await;
        assert!(matches!(
            items.as_slice(),
            [Ok(ModelStreamEvent::Created), Err(ModelError::Api { status: 500, .. })]
        ));
    }

    #[tokio::test]
    async fn the_stream_reads_the_queue_only_as_it_is_polled() {
        let (queue, events) = mpsc::unbounded_channel();
        let mut stream = event_stream(Ok(ModelStreamEvent::Created), events);
        assert!(matches!(stream.next().await, Some(Ok(ModelStreamEvent::Created))));
        queue.send(Ok(ModelStreamEvent::TextDelta("a".into()))).unwrap();
        assert!(matches!(stream.next().await, Some(Ok(ModelStreamEvent::TextDelta(_)))));
        queue.send(Ok(completed())).unwrap();
        assert!(matches!(stream.next().await, Some(Ok(ModelStreamEvent::Completed { .. }))));
        assert!(stream.next().await.is_none());
        assert!(queue.is_closed(), "dropping the finished stream's queue lets the pump stop");
    }

    #[test]
    fn a_cut_turn_is_reported_differently_before_and_after_the_first_chunk() {
        let reason = |started| match cut_short(started) {
            ModelError::Stream(reason) => reason,
            other => panic!("expected a Stream error, got {other:?}"),
        };
        assert!(reason(false).contains("without answering"));
        assert!(reason(true).contains("before reporting how the turn ended"));
    }
}
