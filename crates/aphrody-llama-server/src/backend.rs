// SPDX-License-Identifier: Apache-2.0
//! Which engine hosts a managed local model: in this process, or an external `llama-server`.
//!
//! The selection is a pure function of two facts, so it is testable without a model: whether the
//! `in-process` feature is compiled in, and the optional `APHRODY_LLAMA_BACKEND` override.
//!
//! | override               | `in-process` compiled | result                    |
//! |------------------------|-----------------------|---------------------------|
//! | unset / `auto`         | yes                   | [`InferenceBackend::InProcess`] |
//! | unset / `auto`         | no                    | [`InferenceBackend::Spawn`] |
//! | `spawn`                | any                   | [`InferenceBackend::Spawn`] |
//! | `in-process`           | yes                   | [`InferenceBackend::InProcess`] |
//! | `in-process`           | no                    | error (never a silent fallback) |
//!
//! The detached daemon ([`crate::daemon`]) stays the engine of the standalone `aphrody` CLI and
//! of `aphrody-llama-daemon`; a host that links the in-process engine (the desktop app) never
//! re-executes its own executable.

/// Name of the environment override.
pub const BACKEND_ENV: &str = "APHRODY_LLAMA_BACKEND";

/// The engine that serves a managed local model.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InferenceBackend {
    /// `libllama` loaded into this process, behind a loopback OpenAI-compatible endpoint.
    InProcess,
    /// An external `llama-server` owned by the detached daemon.
    Spawn,
}

/// The override asked for something this build cannot do, or is not a known value.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum BackendError {
    /// `in-process` was requested but the feature is not compiled in.
    #[error("{BACKEND_ENV}=in-process needs a build with the `in-process` feature")]
    NotCompiled,
    /// Not `auto`, `spawn` or `in-process`.
    #[error("{BACKEND_ENV} must be `auto`, `spawn` or `in-process`, got `{0}`")]
    Unknown(String),
}

impl InferenceBackend {
    /// Whether this build contains the in-process engine.
    pub const COMPILED: bool = cfg!(feature = "in-process");

    /// Pure selection, see the module table.
    ///
    /// # Errors
    ///
    /// See [`BackendError`].
    pub fn select(requested: Option<&str>, compiled: bool) -> Result<Self, BackendError> {
        let requested = requested.map(str::trim).filter(|value| !value.is_empty());
        match requested.map(str::to_ascii_lowercase).as_deref() {
            None | Some("auto") => Ok(if compiled { Self::InProcess } else { Self::Spawn }),
            Some("spawn") => Ok(Self::Spawn),
            Some("in-process" | "in_process" | "inprocess") => {
                if compiled {
                    Ok(Self::InProcess)
                } else {
                    Err(BackendError::NotCompiled)
                }
            },
            Some(other) => Err(BackendError::Unknown(other.to_owned())),
        }
    }

    /// [`InferenceBackend::select`] over the process environment and this build.
    ///
    /// # Errors
    ///
    /// See [`BackendError`].
    pub fn from_env() -> Result<Self, BackendError> {
        Self::select(std::env::var(BACKEND_ENV).ok().as_deref(), Self::COMPILED)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auto_follows_the_build() {
        assert_eq!(InferenceBackend::select(None, true), Ok(InferenceBackend::InProcess));
        assert_eq!(InferenceBackend::select(Some("auto"), true), Ok(InferenceBackend::InProcess));
        assert_eq!(InferenceBackend::select(None, false), Ok(InferenceBackend::Spawn));
        assert_eq!(InferenceBackend::select(Some("  "), false), Ok(InferenceBackend::Spawn));
    }

    #[test]
    fn spawn_is_always_available_as_an_explicit_choice() {
        for compiled in [true, false] {
            assert_eq!(
                InferenceBackend::select(Some("SPAWN"), compiled),
                Ok(InferenceBackend::Spawn)
            );
        }
    }

    #[test]
    fn in_process_is_never_a_silent_fallback() {
        assert_eq!(
            InferenceBackend::select(Some("in-process"), true),
            Ok(InferenceBackend::InProcess)
        );
        assert_eq!(
            InferenceBackend::select(Some("in-process"), false),
            Err(BackendError::NotCompiled)
        );
    }

    #[test]
    fn unknown_values_are_rejected() {
        assert_eq!(
            InferenceBackend::select(Some("cuda"), true),
            Err(BackendError::Unknown("cuda".into()))
        );
    }
}
