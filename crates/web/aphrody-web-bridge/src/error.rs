// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//
//! Typed failures for the bxc bridge.
//!
//! Every variant that means "bxc is not on this machine" carries **the paths
//! that were tried** and **the command that fixes it**. That is deliberate:
//! the surfaces this crate replaces used to answer a missing dependency by
//! quietly routing the request through `https://r.jina.ai/`, so the operator
//! learned nothing and every page they read was seen by a third party. A
//! bridge that fails loudly is the whole point of the exercise.

use std::path::PathBuf;

/// Result alias for this crate.
pub type Result<T> = core::result::Result<T, BxcError>;

/// Render a candidate list for an error message, one per line.
fn bullets(paths: &[PathBuf]) -> String {
    paths.iter().map(|p| format!("\n  - {}", p.display())).collect()
}

/// Everything that can go wrong reaching bxc.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum BxcError {
    /// The compatibility facade has no in-process implementation for this operation.
    #[error("native Web operation {operation} is unavailable: {detail}")]
    NativeUnsupported {
        /// Requested operation.
        operation: String,
        /// Reason the operation cannot be served.
        detail: &'static str,
    },
    /// A CSS selector could not be parsed by the native DOM engine.
    #[error("invalid CSS selector {selector:?}: {detail}")]
    Selector {
        /// Selector supplied by the caller.
        selector: String,
        /// Parser's diagnostic.
        detail: String,
    },
    /// The in-process Obscura browser failed while loading a page.
    #[error("browser navigation failed for {url}: {detail}")]
    Browser {
        /// Requested URL.
        url: String,
        /// Browser error without page contents or credentials.
        detail: String,
    },

    /// The browser did not finish before the caller's deadline.
    #[error("browser navigation for {url} exceeded {secs}s")]
    BrowserTimeout {
        /// Requested URL.
        url: String,
        /// Caller-supplied deadline in seconds.
        secs: u64,
    },

    /// A requested browser capability was not compiled into this build.
    #[error("browser profile {profile} requires the aphrody-web-bridge stealth feature")]
    BrowserFeatureMissing {
        /// Requested profile.
        profile: &'static str,
    },
    /// The `bxc_rust_bridge` shared library was not found anywhere.
    #[error(
        "bxc bridge library `{name}` not found.\nTried, in order:{tried}\nFix: install bxc (its \
         `aphrody-web-ffi` cdylib lands in ~/.local/bin), or point aphrody at an existing copy \
         with `APHRODY_BXC_LIB=/abs/path/to/{name}`."
    )]
    LibraryMissing {
        /// Platform file name that was searched for.
        name: &'static str,
        /// Every candidate that was probed, in resolution order.
        tried: String,
    },

    /// The library exists but the loader refused it.
    #[error(
        "bxc bridge library `{path}` could not be loaded: {source}\nFix: check the file is a \
         {arch} shared library for this platform, or override with `APHRODY_BXC_LIB=...`."
    )]
    LibraryLoad {
        /// The file that failed to load.
        path: PathBuf,
        /// Target architecture aphrody was built for.
        arch: &'static str,
        /// Loader error.
        #[source]
        source: Box<dyn core::error::Error + Send + Sync>,
    },

    /// A symbol this bridge relies on is absent from the loaded library.
    #[error(
        "bxc bridge library `{path}` does not export `{symbol}`.\nThe installed cdylib is older \
         than the contract aphrody was built against.\nFix: rebuild the canonical \
         `aphrody-web-ffi` crate and reinstall the cdylib."
    )]
    SymbolMissing {
        /// The library that was loaded.
        path: PathBuf,
        /// The missing symbol.
        symbol: &'static str,
        /// Loader error.
        #[source]
        source: Box<dyn core::error::Error + Send + Sync>,
    },

    /// An explicit environment override was set and does not name a file.
    ///
    /// Distinct from the "missing" variants on purpose, and **fatal rather
    /// than skippable**. Falling through to the next candidate would hand the
    /// operator a different artefact from the one they named, without saying
    /// so - they would be debugging behaviour that came from a file they
    /// thought they had overridden. An override is a statement of intent, so
    /// an override that does not resolve is an error, not a hint.
    #[error(
        "`{var}` is set to `{path}`, which is not a file.\nAn explicit override is never silently \
         replaced by another candidate.\nFix: correct the path, or unset `{var}` to let aphrody \
         search the usual locations."
    )]
    OverrideMissing {
        /// The environment variable that was set.
        var: &'static str,
        /// The path it named.
        path: PathBuf,
    },

    /// A previous load attempt failed; the message was cached.
    ///
    /// [`crate::ffi::shared`] memoises the load, and the original typed error
    /// cannot be handed out twice, so it is re-materialised here verbatim.
    #[error("{detail}")]
    LibraryUnavailable {
        /// The rendered text of the first failure.
        detail: String,
    },

    /// The `bxc` executable was not found anywhere.
    #[error(
        "bxc engine (`{name}`) not found.\nTried, in order:{tried}\nFix: install bxc, or point \
         aphrody at it with `BXC_BIN=/abs/path/to/{name}`."
    )]
    BinaryMissing {
        /// Platform file name that was searched for.
        name: &'static str,
        /// Every candidate that was probed, in resolution order.
        tried: String,
    },

    /// The `bxc` executable could not be spawned.
    #[error("failed to spawn `{bin}`: {source}")]
    Spawn {
        /// The executable that was tried.
        bin: PathBuf,
        /// OS error.
        #[source]
        source: std::io::Error,
    },

    /// `bxc` ran to completion but reported failure.
    ///
    /// bxc uses exit 65 for "ran fine, produced nothing usable" (a dead
    /// domain, a blocked SERP), which is a different fact from exit 1, so the
    /// code is carried rather than flattened.
    #[error("`{bin} {args}` exited with {code}.{detail}")]
    CliFailed {
        /// The executable.
        bin: PathBuf,
        /// The arguments, space-joined, for reproduction.
        args: String,
        /// Exit code, or `signal`/`unknown` when there is none.
        code: String,
        /// Trailing diagnostic, already prefixed with a newline when non-empty.
        detail: String,
    },

    /// `bxc` produced its output and then failed to exit.
    ///
    /// Measured, not hypothetical: `bxc scrape ... --markdown` writes the page
    /// to stdout and then hangs indefinitely. The bridge therefore always
    /// bounds the child and reports the fact instead of blocking a worker.
    #[error(
        "`{bin}` did not exit within {secs}s (it had already written {bytes} bytes to \
         stdout).\nThis is a known bxc behaviour on `scrape`; the child was killed."
    )]
    CliTimeout {
        /// The executable.
        bin: PathBuf,
        /// The budget that elapsed.
        secs: u64,
        /// How much output had arrived before the kill.
        bytes: usize,
    },

    /// `bxc` emitted something this bridge could not parse.
    #[error("could not parse `{bin}` output as {expected}: {detail}")]
    CliOutput {
        /// The executable.
        bin: PathBuf,
        /// What was expected, e.g. `JSON`.
        expected: &'static str,
        /// Parser message plus a bounded excerpt.
        detail: String,
    },

    /// An Actor run could not create its private output directory.
    #[error("could not create Actor storage directory `{path}`: {source}")]
    ActorStorage {
        /// The directory that could not be created.
        path: PathBuf,
        /// Filesystem error.
        #[source]
        source: std::io::Error,
    },

    /// An Actor input file could not be written securely.
    #[error("could not prepare private Actor input file `{path}`: {source}")]
    ActorInput {
        /// The private file path.
        path: PathBuf,
        /// Filesystem error.
        #[source]
        source: std::io::Error,
    },

    /// A string headed for the C ABI contained an interior NUL.
    #[error("`{argument}` contains an interior NUL byte and cannot cross the C ABI")]
    NulInInput {
        /// Which argument.
        argument: &'static str,
    },

    /// A cdylib entry point returned NULL.
    #[error("`{symbol}` returned NULL ({reason})")]
    NullReturn {
        /// The symbol that answered NULL.
        symbol: &'static str,
        /// What NULL means for that symbol, per the bxc `rust-bridge/src/lib.rs`.
        reason: &'static str,
    },

    /// A cdylib entry point returned bytes that are not UTF-8.
    #[error("`{symbol}` returned non-UTF-8 bytes")]
    NotUtf8 {
        /// The symbol.
        symbol: &'static str,
    },

    /// Direct HTTP failed.
    #[error("GET {url} failed: {source}")]
    Http {
        /// The URL that was requested.
        url: String,
        /// Transport error.
        #[source]
        source: Box<dyn core::error::Error + Send + Sync>,
    },

    /// The origin answered, but with an error status.
    #[error("GET {url} answered HTTP {status}")]
    HttpStatus {
        /// The URL that was requested.
        url: String,
        /// The status line.
        status: u16,
    },

    /// The caller handed over something that is not a fetchable URL.
    #[error("`{url}` is not an http(s) URL")]
    BadUrl {
        /// What was passed.
        url: String,
    },

    /// No home directory, so `~/.aphrody` cannot be located.
    #[error("no home directory: cannot locate ~/.aphrody/runtimes")]
    NoStateDir,
}

impl BxcError {
    /// Build [`BxcError::LibraryMissing`] from the candidate list.
    #[must_use]
    pub fn library_missing(name: &'static str, tried: &[PathBuf]) -> Self {
        Self::LibraryMissing { name, tried: bullets(tried) }
    }

    /// Build [`BxcError::BinaryMissing`] from the candidate list.
    #[must_use]
    pub fn binary_missing(name: &'static str, tried: &[PathBuf]) -> Self {
        Self::BinaryMissing { name, tried: bullets(tried) }
    }

    /// Whether this failure means "bxc is not installed here", as opposed to
    /// "bxc is installed and said no".
    ///
    /// Callers that must degrade (rather than abort) use this to decide, and
    /// are expected to *say* that they degraded - see
    /// [`crate::fetch::Rendering::RawHtml`].
    #[must_use]
    pub const fn is_missing(&self) -> bool {
        matches!(
            self,
            Self::LibraryMissing { .. }
                | Self::BinaryMissing { .. }
                | Self::OverrideMissing { .. }
                | Self::LibraryLoad { .. }
                | Self::SymbolMissing { .. }
                | Self::LibraryUnavailable { .. }
                | Self::NoStateDir
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_library_names_the_override_and_every_candidate() {
        let err = BxcError::library_missing(
            "bxc_rust_bridge.dll",
            &[PathBuf::from("/a/bxc_rust_bridge.dll"), PathBuf::from("/b/bxc_rust_bridge.dll")],
        );
        let text = err.to_string();
        assert!(text.contains("APHRODY_BXC_LIB"), "the fix must name the override: {text}");
        assert!(text.contains("/a/bxc_rust_bridge.dll"), "{text}");
        assert!(text.contains("/b/bxc_rust_bridge.dll"), "{text}");
        assert!(err.is_missing());
    }

    #[test]
    fn a_missing_binary_names_bxc_bin() {
        let err = BxcError::binary_missing("bxc.exe", &[PathBuf::from("/x/bxc.exe")]);
        let text = err.to_string();
        assert!(text.contains("BXC_BIN"), "{text}");
        assert!(text.contains("/x/bxc.exe"), "{text}");
    }

    /// An installed bxc that answers "nothing found" is not a missing bxc:
    /// conflating the two is how a broken install hides behind an empty result.
    #[test]
    fn a_refusal_from_an_installed_bxc_is_not_a_missing_install() {
        let err = BxcError::CliFailed {
            bin: PathBuf::from("/x/bxc"),
            args: "search foo --json".into(),
            code: "65".into(),
            detail: String::new(),
        };
        assert!(!err.is_missing());
        assert!(err.to_string().contains("65"));
    }

    /// An override that points nowhere must be fatal, and must say so - not
    /// quietly resolve to whatever the next candidate happens to be.
    #[test]
    fn a_broken_override_is_its_own_error_and_names_the_variable() {
        let err = BxcError::OverrideMissing {
            var: "APHRODY_BXC_LIB",
            path: PathBuf::from("/c/nonexistent/bxc_rust_bridge.dll"),
        };
        let text = err.to_string();
        assert!(text.contains("APHRODY_BXC_LIB"), "{text}");
        assert!(text.contains("/c/nonexistent/"), "{text}");
        assert!(text.contains("never silently replaced"), "{text}");
        assert!(err.is_missing());
    }

    #[test]
    fn the_timeout_says_how_much_output_survived_the_kill() {
        let err = BxcError::CliTimeout { bin: PathBuf::from("/x/bxc"), secs: 45, bytes: 177 };
        let text = err.to_string();
        assert!(text.contains("45"), "{text}");
        assert!(text.contains("177"), "{text}");
    }
}
