// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! `bxc-bridge` - aphrody's single door to the bxc engine.
//!
//! # Two seams, and why the choice is not free
//!
//! * **HTML to Markdown** uses the canonical Rust `aphrody-web-extract` crate in process.
//!   CSS selectors, title extraction and DNS still use the `bxc_rust_bridge` cdylib ([`ffi`]).
//!   The library is `/MD` while aphrody forces `+crt-static` on MSVC, so a static link would put
//!   two C runtimes in one process and make every cross-heap release undefined. Runtime loading is
//!   not a convenience here, it is the only sound option - the same conclusion, and the same
//!   mechanism, as `ort`'s `load-dynamic`.
//! * **Browser, stealth, cache, orchestration** goes through the **`bxc` executable, spawned as a
//!   child** ([`cli`]), exactly as `aphrody-infer` drives llama.cpp and `aphrody-voice` drives
//!   whisper.cpp.
//!
//! # What is deliberately not here
//!
//! No `path` dependency on the bxc workspace. It would splice two workspaces
//! with separate lockfiles, drag `deno_core`/V8 in the moment any path touches
//! `obscura-js`, and pin a fast-moving build inside ours - the three reasons
//! `CLAUDE.md` §7 already gives for not linking llama.cpp.
//!
//! Nor is anything routed through `crates/obscura-runtime`: there is no
//! `obscura` binary. bxc-engine builds `bxc-engine` and `obscura-worker`; the
//! `obscura-*` crates are internal libraries of bxc.
//!
//! # The contract callers can rely on
//!
//! Nothing degrades in silence. Either the call returns a typed
//! [`BxcError`] that **names the command that fixes it**, or it returns a
//! value that **carries the road it actually took** ([`fetch::Fetched::path_taken`],
//! [`resolve::Source::label`]) - the shape `aphrody-infer` uses for its
//! execution providers. The surface this crate replaces did the opposite: a
//! missing capability quietly became a request to `https://r.jina.ai/`, and
//! nobody could tell.
//!
//! # Example
//!
//! ```no_run
//! # async fn demo() -> Result<(), aphrody_web_bridge::BxcError> {
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
pub use error::{BxcError, Result};

/// Programmatic access to the shared Aphrody Web Actor runtime.
#[cfg(not(target_arch = "wasm32"))]
pub mod actors;
#[cfg(not(target_arch = "wasm32"))]
pub mod cli;
// The one exemption in the crate. Every `unsafe` block in `bxc-bridge` lives
// in this module, and the module header states who allocates and who frees for
// each pointer that crosses.
#[cfg(not(target_arch = "wasm32"))]
pub mod fetch;
#[cfg(not(target_arch = "wasm32"))]
#[allow(unsafe_code)]
pub mod ffi;

/// Canonical Rust client name for the Aphrody Web Browser executable.
#[cfg(not(target_arch = "wasm32"))]
pub use cli::BxcCli as WebBrowserClient;
#[cfg(not(target_arch = "wasm32"))]
pub use cli::{BxcCli, Profile};
/// Canonical Rust error name for the Aphrody Web Browser bridge.
#[cfg(not(target_arch = "wasm32"))]
pub use error::BxcError as WebBrowserError;
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
    /// Whether both halves of bxc are reachable, and by which road.
    ///
    /// Built for `aphrody doctor`-style reporting: it answers with what is
    /// present, never with a bare boolean, so an operator reads the itinerary
    /// rather than guessing at it.
    #[derive(Debug, Clone, serde::Serialize)]
    pub struct Availability {
        /// The `bxc` executable, when found.
        pub binary: Option<resolve::Source>,
        /// The `bxc_rust_bridge` shared library, when found.
        pub library: Option<resolve::Source>,
        /// Rendered reason for each half that is missing.
        pub missing: Vec<String>,
    }

    impl Availability {
        /// Probe the machine.
        #[must_use]
        pub fn probe() -> Self {
            let mut missing = Vec::new();

            let bin_attempt = resolve::binary_attempt();
            if bin_attempt.found.is_none() {
                // Goes through `resolve::binary` so a broken `$BXC_BIN` reports as
                // a rejected override, not as "bxc is not installed" — the two
                // call for different fixes.
                missing.push(resolve::binary().err().map_or_else(String::new, |e| e.to_string()));
            }

            let lib_attempt = resolve::library_attempt();
            if lib_attempt.found.is_none() {
                missing.push(resolve::library().err().map_or_else(String::new, |e| e.to_string()));
            }

            Self { binary: bin_attempt.found, library: lib_attempt.found, missing }
        }

        /// Whether the legacy DOM, title and DNS native library is available.
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
                message.contains("BXC_BIN") || message.contains("APHRODY_BXC_LIB"),
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
