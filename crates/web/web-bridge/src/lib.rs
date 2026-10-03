// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Aphrody Web compatibility client with shared Rust extraction and browser engines.
//!
//! # DEPRECATED
//!
//! This transitional bridge is deprecated in favor of direct, sovereign native Rust crates:
//! - [`aphrody_web_extract`] for DOM parsing, markdown conversion, metadata, and media extraction.
//! - [`obscura_net`] for direct and stealth TLS HTTP fetching, DNS, and HAR 1.2 recordings.
//! - [`aphrody_web_crawl`] for bounded and continuous 24/7 autonomous web crawling (`crawl_daemon`).
//! - [`aphrody_web_service`] for native in-process browser automation.
//!
//! DOM parsing, title extraction, Markdown conversion and DNS run in process.
//! Fetch profiles use HTTP or the local Obscura browser. The legacy executable
//! client remains available for callers whose commands are still being migrated.
//!
//! # Example
//!
//! ```no_run
//! # async fn demo() -> Result<(), aphrody_web_bridge::WebBrowserError> {
//! let page = aphrody_web_bridge::fetch::fetch(&aphrody_web_bridge::fetch::Request::new(
//!     "https://google.github.io/styleguide/cppguide.html",
//! ))
//! .await?;
//! println!("{}", page.to_report()); // banner names the exact path taken
//! //
//! # Ok(())
//! # }
//! ```

#![deny(unsafe_code)]
#![deny(missing_docs)]
// Source workspace style policy for the imported bridge. Preserve source
// algorithms while retaining strict safety and documentation lints.
#![allow(clippy::collapsible_if, clippy::type_complexity, clippy::unnecessary_lazy_evaluations)]

#[cfg(not(target_arch = "wasm32"))]
pub mod error;
/// Where bxc lives on this machine.
///
/// Host-only, like everything below it: resolving a path means asking for a
/// home directory and reading a filesystem. A browser has no `~/.local/bin`
/// to search on wasm32, so the resolver is host-only.
///
/// wasm32 is target #3 (CLAUDE.md §0): the crate must *degrade* there, not
/// break the build. Consumers already declare it host-only
/// (`crates/cli/Cargo.toml:113`, `crates/aphrody-tools/Cargo.toml:38`), so on
/// wasm32 `bxc-bridge` simply exposes nothing but its error type.
#[cfg(not(target_arch = "wasm32"))]
pub mod resolve;

#[cfg(not(target_arch = "wasm32"))]
pub use error::{BxcError, Result, WebBrowserError};

/// Programmatic access to the shared Aphrody Web Actor runtime.
#[cfg(not(target_arch = "wasm32"))]
pub mod actors;
#[cfg(not(target_arch = "wasm32"))]
pub mod cli;
#[cfg(not(target_arch = "wasm32"))]
pub mod fetch;
#[cfg(not(target_arch = "wasm32"))]
pub mod ffi;
#[cfg(not(target_arch = "wasm32"))]
mod native_session;

#[cfg(not(target_arch = "wasm32"))]
pub use cli::{BxcCli, Profile, WebBrowserClient};
#[cfg(not(target_arch = "wasm32"))]
pub use ffi::Bridge;

// Everything below needs a filesystem and a child process, so it is host-only
// like the modules above. On wasm32 `bxc-bridge` therefore compiles to an empty
// crate rather than to a half-surface that cannot work: target #3 must build
// (CLAUDE.md §0), and a crate that exposes `Availability::probe()` in a browser
// would be promising an answer it has no way to obtain.
#[cfg(not(target_arch = "wasm32"))]
mod host {
    use super::resolve;
    /// Availability of the linked Rust bridge and optional legacy executable.
    ///
    /// Built for `aphrody doctor`-style reporting: it answers with what is
    /// present, never with a bare boolean, so an operator reads the itinerary
    /// rather than guessing at it.
    #[derive(Debug, Clone, serde::Serialize)]
    pub struct Availability {
        /// The `bxc` executable, when found.
        pub binary: Option<resolve::Source>,
        /// Path of the process containing the linked Rust Web implementation.
        pub library: Option<resolve::Source>,
        /// Rendered reason for each half that is missing.
        pub missing: Vec<String>,
    }

    impl Availability {
        /// Probe the machine.
        #[must_use]
        pub fn probe() -> Self {
            let mut missing = Vec::new();

            let binary = match super::WebBrowserClient::discover() {
                Ok(client) => Some(client.source().clone()),
                Err(error) => {
                    missing.push(error.to_string());
                    None
                },
            };

            let library = match super::ffi::shared() {
                Ok(bridge) => Some(bridge.source().clone()),
                Err(error) => {
                    missing.push(error.to_string());
                    None
                },
            };

            Self { binary, library, missing }
        }

        /// Whether the in-process Rust DOM, title and DNS implementation is available.
        #[must_use]
        pub const fn has_library(&self) -> bool {
            self.library.is_some()
        }

        /// Whether the browser/stealth path is available.
        #[must_use]
        pub const fn has_binary(&self) -> bool {
            self.binary.is_some()
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
pub use host::Availability;

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;

    /// Probing must always answer, and the answer must be self-consistent:
    /// every half that is absent has to come with a message that says how to
    /// install it. A capability report that says "no" without saying "here is
    /// how" is the thing that sends people reading source code.
    #[test]
    fn probing_always_answers_and_explains_every_absence() {
        let a = Availability::probe();
        let absent = usize::from(!a.has_binary()) + usize::from(!a.has_library());
        assert_eq!(a.missing.len(), absent, "every absence needs its own explanation: {a:?}");
        for message in &a.missing {
            assert!(
                message.contains("current executable"),
                "an absence must name its override: {message}"
            );
            // Either the chain was walked (and lists what it probed), or an
            // explicit override was rejected (and says so). Never neither.
            assert!(
                message.contains("Tried, in order:") || message.contains("never silently replaced"),
                "{message}"
            );
        }
        if let Some(src) = &a.binary {
            assert!(src.path().is_file(), "a reported binary must exist: {src:?}");
        }
        if let Some(src) = &a.library {
            assert!(src.path().is_file(), "a reported library must exist: {src:?}");
        }
    }
}
