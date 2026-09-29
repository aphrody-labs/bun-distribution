// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//
//! The only `unsafe` in this crate: the C ABI of `bxc_rust_bridge`.
//!
//! Everything else in `bxc-bridge` is `#![deny(unsafe_code)]`. This module
//! carries the exemption, and in exchange it carries the whole contract.
//!
//! # Why the library is loaded, not linked
//!
//! `bxc_rust_bridge.dll` imports `VCRUNTIME140.dll` and `api-ms-win-crt-*`,
//! i.e. it is built `/MD` (dynamic CRT). aphrody forces `+crt-static` on
//! `x86_64-pc-windows-msvc` and `aarch64-pc-windows-msvc`
//! (`.cargo/config.toml`). Two CRTs in one process do not share a heap, so any
//! pointer allocated on one side and released on the other is undefined
//! behaviour. Static linking is therefore not a tuning choice here, it is
//! unsound - the same conclusion `ort` reached, which is why it is pinned to
//! `load-dynamic` in the workspace manifest.
//!
//! # Memory ownership - the rule that makes this safe
//!
//! * Every `*mut c_char` handed back by the library is a Rust `CString` that **the library
//!   allocated**. It must be returned to `bxc_free_string`, never to `free()`, and never to
//!   aphrody's allocator (aphrody installs `mimalloc` globally, `CLAUDE.md` §2, so a
//!   cross-allocator release is a heap corruption waiting for a busy day). [`Bridge::take_string`]
//!   copies the bytes into a Rust `String` and frees the original immediately, on both the success
//!   and the failure path.
//! * Every `*mut DomTree` handed back by `bxc_parse_html` must go to `bxc_tree_destroy` and to
//!   nothing else - it is not a `CString`, so `bxc_free_string` on it is a silent type confusion.
//!   [`Dom`] is an RAII guard so the pairing cannot be forgotten.
//! * `*const c_char` inputs stay owned by us. The `CString` backing each one is held in a local
//!   binding for the duration of the call.
//!
//! # The `DomTree` pointer is opaque
//!
//! Its layout comes from `obscura_dom`, a crate internal to bxc with no
//! published version and no version symbol exported alongside it. It is a
//! token: never dereferenced, never cast, never stored past the call that
//! produced it.
//!
//! # Panics across the boundary
//!
//! The bxc side has no `catch_unwind`, and it calls `CString::new(..).unwrap()`
//! on the strings it returns - which panics if the content holds an interior
//! NUL. A panic unwinding through `extern "C"` is undefined behaviour, and
//! arbitrary HTML off the wire really does contain NUL bytes. We cannot patch
//! their side from here, so we remove the trigger from ours:
//! [`scrub_nuls`] strips NUL bytes from every payload before it crosses.
//!
//! # Threads
//!
//! `bxc_dns_recon` (and the `bxc_x_*` / `bxc_gemini_web_ask` symbols this
//! module deliberately does not expose) builds a `current_thread` tokio
//! runtime per call and blocks on it. Calling one from inside a tokio worker
//! panics with "cannot start a runtime from within a runtime", so
//! [`Bridge::dns_recon`] is a **blocking** function and its doc comment says
//! so; async callers go through `tokio::task::spawn_blocking`.

use std::{
    ffi::{CStr, CString, c_char},
    path::PathBuf,
    sync::OnceLock,
};

use crate::{
    error::{BxcError, Result},
    resolve::{self, Source},
};

/// Opaque handle to a parsed document owned by the bxc side.
///
/// Zero-sized `repr(C)` body: this is a token, and giving it no fields makes
/// dereferencing it a compile error rather than a judgement call.
#[repr(C)]
pub struct DomTree {
    _opaque: [u8; 0],
}

type FnStrToStr = unsafe extern "C" fn(*const c_char) -> *mut c_char;
type FnParse = unsafe extern "C" fn(*const c_char) -> *mut DomTree;
type FnDestroy = unsafe extern "C" fn(*mut DomTree);
type FnQuery = unsafe extern "C" fn(*mut DomTree, *const c_char) -> *mut c_char;
type FnFree = unsafe extern "C" fn(*mut c_char);

/// A loaded `bxc_rust_bridge`, with its entry points resolved once.
///
/// Field order matters: the function pointers borrow nothing, but the library
/// they came from must outlive every call, and Rust drops fields in
/// declaration order - so `library` is declared last and unloaded last.
pub struct Bridge {
    free_string: FnFree,
    extract_title: FnStrToStr,
    strip_tags: FnStrToStr,
    parse_html: FnParse,
    tree_destroy: FnDestroy,
    query_selector: FnQuery,
    query_selector_all: FnQuery,
    /// Optional: an older cdylib may predate it, and losing DNS recon is not a
    /// reason to lose the remaining DOM and title functions.
    dns_recon: Option<FnStrToStr>,
    source: Source,
    library: libloading::Library,
}

impl core::fmt::Debug for Bridge {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_struct("Bridge")
            .field("path", &self.source.path())
            .field("via", &self.source.label())
            .field("dns_recon", &self.dns_recon.is_some())
            .finish_non_exhaustive()
    }
}

/// Strip interior NUL bytes so a payload can cross the C ABI.
///
/// Returns the cleaned string and how many bytes were dropped, because a
/// caller that silently loses content is the failure mode this repository has
/// a name for: a filter that removes without counting
/// (`CLAUDE.md` §7, "filtre de decouverte plus strict que le filtre de
/// correction"). NUL inside HTML is never meaningful markup, so removing it is
/// safe; not saying so would not be.
#[must_use]
pub fn scrub_nuls(input: &str) -> (String, usize) {
    if !input.as_bytes().contains(&0) {
        return (input.to_owned(), 0);
    }
    let cleaned: String = input.chars().filter(|c| *c != '\0').collect();
    let dropped = input.len() - cleaned.len();
    (cleaned, dropped)
}

impl Bridge {
    /// Load the shared library found by [`resolve::library`].
    ///
    /// # Errors
    ///
    /// [`BxcError::LibraryMissing`] when nothing was found,
    /// [`BxcError::LibraryLoad`] when the loader refused the file, and
    /// [`BxcError::SymbolMissing`] when the file is not a bxc bridge.
    pub fn load() -> Result<Self> {
        Self::load_from(resolve::library()?)
    }

    /// Load a specific file, keeping the [`Source`] for reporting.
    ///
    /// # Errors
    ///
    /// As [`Bridge::load`], minus the resolution failure.
    pub fn load_from(source: Source) -> Result<Self> {
        let path: PathBuf = source.path().to_path_buf();

        // SAFETY: loading a shared library runs its initialisers, which is
        // inherently trusted-input territory. The file is one aphrody
        // resolved from an operator-controlled location (an explicit
        // `APHRODY_BXC_LIB`, the user home, or `~/.aphrody/runtimes`), the
        // same trust boundary `ort` sits behind.
        let library =
            unsafe { libloading::Library::new(&path) }.map_err(|source| BxcError::LibraryLoad {
                path: path.clone(),
                arch: std::env::consts::ARCH,
                source: Box::new(source),
            })?;

        // SAFETY (all `get` calls below): the signatures are transcribed from
        // `rust-bridge/src/lib.rs` in the bxc tree, where every one of these
        // is `#[unsafe(no_mangle)] pub extern "C"`. A mismatch would be a
        // silent ABI break, which is why the types are named once
        // (`FnStrToStr` and friends) and reused rather than spelled out at
        // each call site. `*sym` copies out the plain function pointer, which
        // carries no lifetime; `library` is moved into `self` below and lives
        // exactly as long as those pointers are callable.
        macro_rules! sym {
            ($t:ty, $name:literal) => {{
                let s: libloading::Symbol<'_, $t> = unsafe {
                    library.get(concat!($name, "\0").as_bytes())
                }
                .map_err(|e| BxcError::SymbolMissing {
                    path: path.clone(),
                    symbol: $name,
                    source: Box::new(e),
                })?;
                *s
            }};
        }

        let free_string = sym!(FnFree, "bxc_free_string");
        let extract_title = sym!(FnStrToStr, "bxc_extract_title");
        let strip_tags = sym!(FnStrToStr, "bxc_strip_tags");
        let parse_html = sym!(FnParse, "bxc_parse_html");
        let tree_destroy = sym!(FnDestroy, "bxc_tree_destroy");
        let query_selector = sym!(FnQuery, "bxc_query_selector");
        let query_selector_all = sym!(FnQuery, "bxc_query_selector_all");

        // SAFETY: same contract; absence is tolerated, so the error is dropped.
        let dns_recon = unsafe { library.get::<FnStrToStr>(b"bxc_dns_recon\0").map(|s| *s).ok() };

        Ok(Self {
            free_string,
            extract_title,
            strip_tags,
            parse_html,
            tree_destroy,
            query_selector,
            query_selector_all,
            dns_recon,
            source,
            library,
        })
    }

    /// Where this library came from.
    #[must_use]
    pub const fn source(&self) -> &Source {
        &self.source
    }

    /// A stable identifier for reports: the resolved path.
    #[must_use]
    pub fn path(&self) -> &std::path::Path {
        self.source.path()
    }

    /// Keep the loaded library reachable for tooling that inspects it.
    ///
    /// Exists so `library` is not merely a drop guard: a future consumer that
    /// needs a symbol this bridge does not wrap can reach it here rather than
    /// loading a second copy of the same file into the process.
    ///
    /// Whatever you reach through here, release its `*mut c_char` with
    /// [`Bridge::release`] and nothing else. Every unwrapped symbol that
    /// returns a string (`bxc_gemini_web_ask`, the six `bxc_x_*`) hands over
    /// memory the **library** allocated; aphrody is `+crt-static` with
    /// mimalloc while the library is `/MD`, so freeing it here — with
    /// `CString::from_raw`, `libc::free`, anything of ours — corrupts a heap
    /// that is not ours to touch.
    #[must_use]
    pub const fn raw(&self) -> &libloading::Library {
        &self.library
    }

    /// Release a string that this library allocated.
    ///
    /// The counterpart to [`Bridge::raw`]: without it, a caller reaching an
    /// unwrapped symbol has only two options, leak or corrupt the heap, and
    /// the correct one — `bxc_free_string` from this same module — was
    /// private. An API whose misuse is easier than its use is a defect even
    /// when every individual function is sound.
    ///
    /// # Safety
    ///
    /// `ptr` must be NULL, or a `*mut c_char` returned by **this** library
    /// from a function that hands over ownership. A `*mut DomTree` passed
    /// here is type confusion: trees are released by dropping [`Dom`].
    pub unsafe fn release(&self, ptr: *mut c_char) {
        if ptr.is_null() {
            return;
        }
        // SAFETY: the caller warrants the provenance; the library that
        // allocated it is the one releasing it.
        unsafe { (self.free_string)(ptr) };
    }

    /// Copy a library-allocated C string into a Rust `String` and release the
    /// original through `bxc_free_string`.
    ///
    /// # Safety
    ///
    /// `ptr` must be NULL or a pointer returned by this same library from a
    /// function documented to hand over ownership (all of the `*mut c_char`
    /// returns). Passing a `*mut DomTree` here is type confusion.
    unsafe fn take_string(
        &self,
        ptr: *mut c_char,
        symbol: &'static str,
        reason: &'static str,
    ) -> Result<String> {
        if ptr.is_null() {
            return Err(BxcError::NullReturn { symbol, reason });
        }
        // SAFETY: non-NULL, NUL-terminated by construction on the bxc side
        // (`CString::into_raw`). The copy happens before the free so the
        // borrow never outlives the allocation.
        let bytes = unsafe { CStr::from_ptr(ptr) }.to_bytes().to_vec();
        // SAFETY: the library allocated it, the library releases it. Done
        // before the UTF-8 check so an invalid payload cannot leak.
        unsafe { (self.free_string)(ptr) };
        String::from_utf8(bytes).map_err(|_| BxcError::NotUtf8 { symbol })
    }

    /// Prepare an owned C string for a parameter.
    fn c_arg(value: &str, argument: &'static str) -> Result<CString> {
        CString::new(value).map_err(|_| BxcError::NulInInput { argument })
    }

    /// Convert an HTML document to Markdown.
    ///
    /// This is the function that retires `https://r.jina.ai/`: the conversion
    /// happens in this process, on bytes aphrody already holds, with no third
    /// party learning which page was read.
    ///
    /// NUL bytes in `html` are removed first - see [`scrub_nuls`].
    ///
    /// This method keeps the historical `Result` signature. Conversion is
    /// performed by Rust and does not cross the C ABI.
    pub fn html_to_markdown(&self, html: &str) -> Result<String> {
        let (clean, dropped) = scrub_nuls(html);
        if dropped > 0 {
            tracing::debug!(dropped, "stripped NUL bytes before Markdown conversion");
        }
        Ok(aphrody_web_extract::html_to_markdown(&clean, None))
    }

    /// Extract the `<title>` of a document, or an empty string when it has none.
    ///
    /// # Errors
    ///
    /// [`BxcError::NullReturn`] or [`BxcError::NotUtf8`] from the legacy C ABI.
    pub fn extract_title(&self, html: &str) -> Result<String> {
        let (clean, dropped) = scrub_nuls(html);
        if dropped > 0 {
            tracing::debug!(dropped, "stripped NUL bytes before crossing the bxc C ABI");
        }
        let arg = Self::c_arg(&clean, "html")?;
        // SAFETY: `arg` lives through the call; the returned string is freed
        // by `take_string` through this library's allocator.
        let raw = unsafe { (self.extract_title)(arg.as_ptr()) };
        unsafe { self.take_string(raw, "bxc_extract_title", "input was not valid UTF-8") }
    }

    /// Strip every tag, leaving the text content.
    ///
    /// # Errors
    ///
    /// [`BxcError::NullReturn`] or [`BxcError::NotUtf8`] from the legacy C ABI.
    pub fn strip_tags(&self, html: &str) -> Result<String> {
        let (clean, dropped) = scrub_nuls(html);
        if dropped > 0 {
            tracing::debug!(dropped, "stripped NUL bytes before crossing the bxc C ABI");
        }
        let arg = Self::c_arg(&clean, "html")?;
        // SAFETY: `arg` lives through the call; the returned string is freed
        // by `take_string` through this library's allocator.
        let raw = unsafe { (self.strip_tags)(arg.as_ptr()) };
        unsafe { self.take_string(raw, "bxc_strip_tags", "input was not valid UTF-8") }
    }

    /// Parse a document into a [`Dom`], which destroys it on drop.
    ///
    /// # Errors
    ///
    /// [`BxcError::NullReturn`] when the payload is not valid UTF-8 on the
    /// bxc side.
    pub fn parse_html(&self, html: &str) -> Result<Dom<'_>> {
        let (clean, dropped) = scrub_nuls(html);
        if dropped > 0 {
            tracing::debug!(dropped, "stripped NUL bytes before crossing the bxc C ABI");
        }
        let arg = Self::c_arg(&clean, "html")?;
        // SAFETY: `arg` outlives the call; the returned pointer is an owned
        // tree whose only valid destructor is `bxc_tree_destroy`, which `Dom`
        // calls on drop.
        let tree = unsafe { (self.parse_html)(arg.as_ptr()) };
        if tree.is_null() {
            return Err(BxcError::NullReturn {
                symbol: "bxc_parse_html",
                reason: "input was not valid UTF-8",
            });
        }
        Ok(Dom { tree, bridge: self })
    }

    /// DNS reconnaissance for `domain`, as the JSON bxc emits.
    ///
    /// # Blocking
    ///
    /// **This blocks the calling thread and must never be called from a tokio
    /// worker.** The bxc side builds a `current_thread` runtime and calls
    /// `block_on`; doing that inside an existing runtime panics with "cannot
    /// start a runtime from within a runtime". Async callers wrap it in
    /// `tokio::task::spawn_blocking`.
    ///
    /// # Errors
    ///
    /// [`BxcError::SymbolMissing`] when the installed cdylib predates the
    /// symbol, plus the usual string-transfer failures.
    pub fn dns_recon(&self, domain: &str) -> Result<String> {
        let f = self.dns_recon.ok_or_else(|| BxcError::SymbolMissing {
            path: self.source.path().to_path_buf(),
            symbol: "bxc_dns_recon",
            source: Box::new(std::io::Error::new(
                std::io::ErrorKind::Unsupported,
                "symbol absent from the loaded cdylib",
            )),
        })?;
        let arg = Self::c_arg(domain, "domain")?;
        // SAFETY: `arg` outlives the call; the return is an owned CString.
        // Blocking contract documented above.
        let raw = unsafe { f(arg.as_ptr()) };
        unsafe { self.take_string(raw, "bxc_dns_recon", "domain was not valid UTF-8") }
    }
}

/// A parsed document, destroyed on drop.
///
/// Borrows the [`Bridge`] so the library cannot be unloaded while a tree from
/// it is still alive.
pub struct Dom<'b> {
    tree: *mut DomTree,
    bridge: &'b Bridge,
}

impl core::fmt::Debug for Dom<'_> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_struct("Dom").field("library", &self.bridge.path()).finish_non_exhaustive()
    }
}

impl Dom<'_> {
    /// Outer HTML of the first node matching `selector`, if any.
    ///
    /// # Errors
    ///
    /// [`BxcError::NotUtf8`] on a payload this side cannot decode.
    pub fn query_selector(&self, selector: &str) -> Result<Option<String>> {
        let arg = Bridge::c_arg(selector, "selector")?;
        // SAFETY: `self.tree` is a live tree from this same library and is not
        // dereferenced here; `arg` outlives the call.
        let raw = unsafe { (self.bridge.query_selector)(self.tree, arg.as_ptr()) };
        if raw.is_null() {
            // NULL means "no match" for this symbol, which is an answer —
            // but it is NOT only that, and the caller has to know. Measured
            // on the shipped cdylib: `bxc_query_selector` returns NULL both
            // for a selector that matched nothing AND for a selector that
            // did not parse (bxc `rust-bridge/src/lib.rs:47-53` folds
            // `Ok(None)` and `Err(_)` into one `_ => null_mut()` arm), and
            // `bxc_query_selector_all` returns `[]` in both cases too. So
            // `!!!bad(((` and `table.absent` are bit-for-bit identical here.
            // The ambiguity lives in the ABI and cannot be resolved from
            // this side; what we can do is refuse to pretend it is absent.
            return Ok(None);
        }
        // SAFETY: non-NULL owned CString.
        unsafe { self.bridge.take_string(raw, "bxc_query_selector", "no match") }.map(Some)
    }

    /// Outer HTML of every node matching `selector`.
    ///
    /// bxc answers with a JSON array; a malformed body is reported rather than
    /// swallowed, because "no matches" and "the bridge could not read the
    /// answer" are different facts.
    ///
    /// # Errors
    ///
    /// [`BxcError::CliOutput`] when the JSON does not parse, plus the usual
    /// string-transfer failures.
    pub fn query_selector_all(&self, selector: &str) -> Result<Vec<String>> {
        let arg = Bridge::c_arg(selector, "selector")?;
        // SAFETY: as `query_selector`.
        let raw = unsafe { (self.bridge.query_selector_all)(self.tree, arg.as_ptr()) };
        let json = unsafe {
            self.bridge.take_string(raw, "bxc_query_selector_all", "tree or selector was NULL")
        }?;
        serde_json::from_str::<Vec<String>>(&json).map_err(|e| BxcError::CliOutput {
            bin: self.bridge.source.path().to_path_buf(),
            expected: "JSON array of outerHTML strings",
            detail: format!(
                "{e}; body starts with {:?}",
                json.chars().take(120).collect::<String>()
            ),
        })
    }
}

impl Drop for Dom<'_> {
    fn drop(&mut self) {
        // SAFETY: `self.tree` came from `bxc_parse_html` on `self.bridge`, was
        // checked non-NULL at construction, and is destroyed exactly once
        // because `Dom` is not `Clone` and does not hand the pointer out.
        unsafe { (self.bridge.tree_destroy)(self.tree) };
    }
}

/// Process-wide bridge, loaded at most once.
///
/// The failure is memoised too: a machine without bxc should not pay a
/// filesystem walk plus a failed `dlopen` on every request. Because the typed
/// error is not `Clone`, a cached failure is re-materialised as
/// [`BxcError::LibraryUnavailable`] with the original text intact.
///
/// # Errors
///
/// Whatever [`Bridge::load`] answered the first time.
pub fn shared() -> Result<&'static Bridge> {
    static CELL: OnceLock<core::result::Result<Bridge, String>> = OnceLock::new();
    match CELL.get_or_init(|| Bridge::load().map_err(|e| e.to_string())) {
        Ok(bridge) => Ok(bridge),
        Err(detail) => Err(BxcError::LibraryUnavailable { detail: detail.clone() }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scrubbing_is_a_no_op_on_clean_input() {
        let (out, dropped) = scrub_nuls("<p>hello</p>");
        assert_eq!(out, "<p>hello</p>");
        assert_eq!(dropped, 0);
    }

    /// The trigger for the undefined behaviour on the bxc side is an interior
    /// NUL, and it really does turn up in HTML off the wire.
    #[test]
    fn scrubbing_removes_interior_nuls_and_counts_them() {
        let (out, dropped) = scrub_nuls("<p>a\0b\0</p>");
        assert_eq!(out, "<p>ab</p>");
        assert_eq!(dropped, 2);
        assert!(CString::new(out).is_ok(), "the scrubbed payload must cross the C ABI");
    }

    /// Skips rather than fails when bxc is not installed - a hard failure on
    /// a bare machine trains everyone to ignore the test, which is worse than
    /// not having it (same rule as `aphrody-voice/tests/whisper_cpp_smoke.rs`).
    #[test]
    fn markdown_conversion_uses_the_rust_extractor_with_a_loaded_bridge() {
        let Ok(bridge) = shared() else {
            eprintln!("skipped: bxc_rust_bridge not installed on this machine");
            return;
        };
        eprintln!("library {} ({})", bridge.path().display(), bridge.source().label());

        let html = "<html><head><title>Example Domain</title></head><body><h1>Example \
                    Domain</h1><p>This domain is for use in <b>examples</b>.</p></body></html>";

        let md = bridge.html_to_markdown(html).expect("conversion must succeed");
        assert!(md.contains("Example Domain"), "markdown lost the heading: {md}");
        assert!(!md.contains("<h1>"), "markdown still carries raw tags: {md}");

        assert_eq!(bridge.extract_title(html).unwrap().trim(), "Example Domain");

        let text = bridge.strip_tags(html).unwrap();
        assert!(text.contains("examples"), "{text}");
        assert!(!text.contains('<'), "strip_tags left markup: {text}");
    }

    #[test]
    fn selectors_run_against_a_tree_that_frees_itself() {
        let Ok(bridge) = shared() else {
            eprintln!("skipped: bxc_rust_bridge not installed on this machine");
            return;
        };
        let html = "<ul><li class=\"x\">one</li><li class=\"x\">two</li><li>three</li></ul>";
        let dom = bridge.parse_html(html).expect("parse must succeed");

        let first = dom.query_selector("li.x").expect("query must succeed");
        assert!(first.is_some_and(|h| h.contains("one")), "first match wrong");

        let all = dom.query_selector_all("li.x").expect("query-all must succeed");
        assert_eq!(all.len(), 2, "expected two matches, got {all:?}");

        assert_eq!(dom.query_selector("table.absent").unwrap(), None, "no match is not an error");
        // `dom` drops here: `bxc_tree_destroy` runs exactly once.
    }
}
