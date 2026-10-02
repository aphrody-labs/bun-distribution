// SPDX-License-Identifier: Apache-2.0
//! The model a client loads on first use and all its clones share.
//!
//! Loading reads and uploads gigabytes, and mistral.rs does it synchronously inside an `async`
//! builder: `build().await` holds its thread for the whole load, may block on a channel while the
//! engine thread starts, and panics instead of returning an error when the engine cannot be
//! created. So the load runs on a blocking thread, where a panic becomes an error, and three
//! rules keep it safe to call from many tasks:
//!
//! - **One load at a time.** Callers queue on a gate. The gate guard moves into the blocking job,
//!   so it is released when the load ends, not when the caller that started it stops waiting.
//! - **A caller that gives up does not waste the load.** The job stores the finished model itself.
//!   A request cancelled mid-load (the turn loop races `stream` against an interrupt) leaves the
//!   load running, and the next caller finds the model there instead of starting a second load
//!   that would hold the weights in memory twice.
//! - **Callers share a failure.** Those that queued behind a load that failed report its error
//!   instead of each retrying it in turn. A caller that arrives afterwards retries: a failed
//!   load is not remembered.

use std::any::Any;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::{Arc, MutexGuard, OnceLock, PoisonError};
use std::time::Instant;

use mistralrs::{Model, ModelCategory};
use tokio::sync::Mutex;

use super::load::LoadSpec;
use crate::error::EngineError;

/// A loaded model with the facts callers read without awaiting anything.
#[derive(Clone)]
pub(crate) struct Loaded {
    /// The engine. One per client, shared by every request.
    pub(crate) model: Arc<Model>,
    /// Whether it was loaded through a vision pipeline, so images are meaningful.
    pub(crate) images: bool,
    /// Its context window in tokens, when mistral.rs reports one.
    pub(crate) context_window: Option<u64>,
}

impl Loaded {
    fn new(model: Model) -> Self {
        let images = model
            .config()
            .is_ok_and(|config| matches!(config.category, ModelCategory::Multimodal { .. }));
        let context_window = model
            .max_sequence_length()
            .ok()
            .flatten()
            .and_then(|tokens| u64::try_from(tokens).ok());
        Self { model: Arc::new(model), images, context_window }
    }
}

/// How many load attempts have finished and how the last one failed, if it did.
#[derive(Default)]
struct Attempts {
    finished: u64,
    last_failure: Option<String>,
}

/// What to load and, once loaded, the result.
pub(crate) struct SharedModel {
    spec: LoadSpec,
    loaded: OnceLock<Loaded>,
    gate: Arc<Mutex<()>>,
    attempts: std::sync::Mutex<Attempts>,
}

impl SharedModel {
    /// Nothing is loaded: this only stores the parsed configuration.
    pub(crate) fn new(spec: LoadSpec) -> Self {
        Self {
            spec,
            loaded: OnceLock::new(),
            gate: Arc::new(Mutex::new(())),
            attempts: std::sync::Mutex::new(Attempts::default()),
        }
    }

    /// The model, when a load has finished.
    pub(crate) fn loaded(&self) -> Option<&Loaded> {
        self.loaded.get()
    }

    /// The model, loading it first if no call has yet.
    ///
    /// # Errors
    /// [`EngineError::Load`] with mistral.rs' own message, or a description of the panic or
    /// cancellation that ended the loader.
    pub(crate) async fn get(self: &Arc<Self>) -> Result<Loaded, EngineError> {
        if let Some(loaded) = self.loaded.get() {
            return Ok(loaded.clone());
        }
        let seen = self.attempts().finished;
        let gate = Arc::clone(&self.gate).lock_owned().await;
        // The load that held the gate before this call may have finished.
        if let Some(loaded) = self.loaded.get() {
            return Ok(loaded.clone());
        }
        if let Some(message) = self.failure_since(seen) {
            return Err(self.load_error(message));
        }
        let runtime = tokio::runtime::Handle::try_current()
            .map_err(|error| self.load_error(format!("loading needs a tokio runtime: {error}")))?;
        let this = Arc::clone(self);
        let job = tokio::task::spawn_blocking(move || {
            let _gate = gate;
            let started = Instant::now();
            let built = catch_unwind(AssertUnwindSafe(|| runtime.block_on(this.spec.build())));
            let result = match built {
                Ok(Ok(model)) => Ok(this.loaded.get_or_init(|| Loaded::new(model)).clone()),
                Ok(Err(message)) => Err(message),
                Err(payload) => Err(format!("the loader panicked: {}", panic_message(&*payload))),
            };
            this.record(result.as_ref().err().cloned());
            if let Ok(loaded) = &result {
                tracing::info!(
                    model = %this.spec.model_id(),
                    elapsed = ?started.elapsed(),
                    images = loaded.images,
                    "mistral.rs model loaded"
                );
            }
            result.map_err(|message| this.load_error(message))
        });
        job.await.unwrap_or_else(|error| Err(self.load_error(describe_join_error(error))))
    }

    fn load_error(&self, message: String) -> EngineError {
        EngineError::Load { model: self.spec.model_id().to_owned(), message }
    }

    fn attempts(&self) -> MutexGuard<'_, Attempts> {
        // The counters stay meaningful after a panic elsewhere, so a poisoned lock is still used.
        self.attempts.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The error of a load that finished after `seen` attempts had, if the latest one failed.
    fn failure_since(&self, seen: u64) -> Option<String> {
        let attempts = self.attempts();
        if attempts.finished > seen { attempts.last_failure.clone() } else { None }
    }

    /// Note that a load attempt ended, and how.
    fn record(&self, failure: Option<String>) {
        let mut attempts = self.attempts();
        attempts.finished += 1;
        attempts.last_failure = failure;
    }
}

/// The text of a panic payload: `panic!` with a literal carries a `&str`, with arguments a
/// `String`.
fn panic_message(payload: &(dyn Any + Send)) -> String {
    payload
        .downcast_ref::<&str>()
        .map(|text| (*text).to_owned())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "no panic message".to_owned())
}

/// Why the loader task did not return: a panic that escaped the loader's own guard, or a
/// cancellation (the runtime shutting down).
fn describe_join_error(error: tokio::task::JoinError) -> String {
    if error.is_panic() {
        format!("the loader panicked: {}", panic_message(&*error.into_panic()))
    } else {
        "the loader task was cancelled".to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::EmbedderConfig;

    fn state() -> SharedModel {
        let spec = LoadSpec::embedding(&EmbedderConfig::new("org/embedder")).expect("valid");
        SharedModel::new(spec)
    }

    #[test]
    fn panic_payloads_are_read_as_text() {
        let literal = catch_unwind(|| panic!("no engine thread")).expect_err("it panics");
        assert_eq!(panic_message(&*literal), "no engine thread");
        let formatted = catch_unwind(|| panic!("exit {}", 7)).expect_err("it panics");
        assert_eq!(panic_message(&*formatted), "exit 7");
        let other: Box<dyn Any + Send> = Box::new(42_u8);
        assert_eq!(panic_message(&*other), "no panic message");
    }

    #[tokio::test]
    async fn a_task_that_panicked_or_was_cancelled_is_described() {
        let panicked = tokio::task::spawn_blocking(|| panic!("no engine thread")).await;
        let message = describe_join_error(panicked.expect_err("the closure panics"));
        assert_eq!(message, "the loader panicked: no engine thread");

        let task = tokio::spawn(std::future::pending::<()>());
        task.abort();
        let message = describe_join_error(task.await.expect_err("the task was aborted"));
        assert_eq!(message, "the loader task was cancelled");
    }

    #[test]
    fn a_load_error_names_the_model_it_was_loading() {
        let shared = state();
        assert!(shared.loaded().is_none());
        let error = shared.load_error("disk full".to_owned());
        let EngineError::Load { model, message } = &error else {
            panic!("expected a Load error, got {error:?}");
        };
        assert_eq!((model.as_str(), message.as_str()), ("org/embedder", "disk full"));
    }

    #[test]
    fn callers_that_queued_behind_a_failed_load_share_its_error_and_later_ones_retry() {
        let shared = state();
        let queued = shared.attempts().finished;
        assert_eq!(shared.failure_since(queued), None, "nothing has run yet");

        shared.record(Some("disk full".to_owned()));
        assert_eq!(shared.failure_since(queued).as_deref(), Some("disk full"));

        let later = shared.attempts().finished;
        assert_eq!(shared.failure_since(later), None, "a caller arriving afterwards retries");

        shared.record(None);
        assert_eq!(shared.failure_since(later), None, "a success leaves no failure to share");
    }
}
