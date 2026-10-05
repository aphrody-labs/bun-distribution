// SPDX-License-Identifier: Apache-2.0
//! # aphrody-ffi — aphrody as a native library.
//!
//! A thin, stable **C ABI** over the `aphrody-command` library crate so the *entire*
//! command surface is reachable in-process from Bun (`bun:ffi`) and any other
//! C-ABI host (C / C++ / Zig / Python `ctypes` / .NET P/Invoke), not only by
//! spawning the `aphrody` binary.
//!
//! ## Exported symbols
//!
//! | Symbol | Purpose |
//! |---|---|
//! | `aphrody_abi_version() -> u32` | ABI version for the host to check. |
//! | `aphrody_version() -> *const c_char` | aphrody version (static, no free). |
//! | `aphrody_run(argc, argv) -> c_int` | run any command, inherited stdio. |
//! | `aphrody_run_json(args_json) -> c_int` | same, args as a JSON array. |
//! | `aphrody_run_captured(args_json) -> *mut c_char` | run + capture; returns `{"code","stdout","stderr"}` JSON (free with `aphrody_string_free`). |
//! | `aphrody_string_free(*mut c_char)` | free a string this library returned. |
//! | `aphrody_last_error() -> *const c_char` | last error on this thread (static, no free). |
//!
//! Arguments are the command arguments WITHOUT the program name — a synthetic
//! `argv[0]` is prepended internally — e.g. `["doctor", "--json"]`.
//!
//! The hand-written C header lives in `include/aphrody.h` and is kept in
//! lock-step with this module: a unit test parses `APHRODY_ABI_VERSION` from it
//! and asserts it equals the Rust `ABI_VERSION`, and the FFI-injected status
//! codes are mirrored by the `AphrodyStatus` enum (sysexits-compatible). The
//! run functions still return a plain `c_int` because a wrapped command may
//! exit with any process code, not only the closed set in `AphrodyStatus`.
//!
//! ## Robustness
//!
//! * Every entry point catches Rust panics (`std::panic::catch_unwind`) and maps them to an error
//!   code, so a panic never unwinds across the C boundary and tears the host process down.
//! * The wrapped command surface is exit-free (commands return an error rather than calling
//!   `process::exit`), so a command never kills the host.
//! * `mimalloc` is the global allocator (the `aphrody-command` library is allocator-agnostic, so the cdylib
//!   matches the binary's choice here).
//!
//! On wasm32 this crate compiles to an empty module — the native command
//! surface (tokio + reqwest + rustls) does not link on wasm.

#[cfg(not(target_arch = "wasm32"))]
#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

#[cfg(not(target_arch = "wasm32"))]
pub use native::*;

// All web C symbols are linked into this same cdylib. The Web implementation
// remains in reusable Rust libraries; this module owns only the ABI adapters.
#[cfg(not(target_arch = "wasm32"))]
mod web;
#[cfg(not(target_arch = "wasm32"))]
pub use web::*;

// yolo_* runtime ABI retained in this cdylib (Phase 2 unification).
#[cfg(not(target_arch = "wasm32"))]
mod yolo;

// Zero-copy exports (caller-owned buffers): CPU rasterizer and tool-call repair.
#[cfg(not(target_arch = "wasm32"))]
mod zerocopy;
#[cfg(not(target_arch = "wasm32"))]
pub use zerocopy::*;

// The historical bun_rs ABI remains available in the same native library.
// Its implementation is an internal rlib; it no longer ships a second cdylib.
#[cfg(not(target_arch = "wasm32"))]
pub use bun_rs::*;

// Preserve the native N2B and Oxc contracts inside this sole dynamic artifact.
// Their original library owners provide implementations and destructors.
#[cfg(not(target_arch = "wasm32"))]
pub use aphrody_n2b_native::*;
#[cfg(not(target_arch = "wasm32"))]
pub use aphrody_oxc_bridge::*;

#[cfg(not(target_arch = "wasm32"))]
mod native {
    use std::{
        cell::RefCell,
        ffi::{CStr, CString, OsString, c_char, c_int},
        panic::catch_unwind,
        ptr,
        sync::{Mutex, OnceLock},
    };

    use aphrody_stdio_capture::with_captured_stdio;

    /// ABI version of the exported symbol set. Bump on any incompatible change.
    ///
    /// Kept in lock-step with `APHRODY_ABI_VERSION` in `include/aphrody.h`; the
    /// `header_abi_version_matches` test parses the header and asserts they
    /// agree, so the two cannot silently drift.
    pub(crate) const ABI_VERSION: u32 = 1;

    /// FFI-layer status codes, mirroring `enum AphrodyStatus` in
    /// `include/aphrody.h`. `#[repr(i32)]` makes the enum layout-compatible
    /// with the `c_int` the run functions return, so a value can be produced as
    /// `AphrodyStatus::Usage as c_int`.
    ///
    /// These are only the codes the FFI boundary itself injects; a wrapped
    /// command may still return any other process exit code unchanged.
    #[repr(i32)]
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub(crate) enum AphrodyStatus {
        /// Malformed request: invalid argv, JSON, or UTF-8 (sysexits EX_USAGE).
        Usage = 64,
        /// Internal error: a caught Rust panic (sysexits EX_SOFTWARE).
        Software = 70,
    }

    thread_local! {
        /// Last error recorded on this thread (the C ABI has no Result channel).
        #[cfg_attr(all(windows, target_env = "gnu"), allow(clippy::missing_const_for_thread_local,
            reason = "The pinned toolchain lints generated TLS storage despite the const initializer"))]
        static LAST_ERROR: RefCell<Option<CString>> = const { RefCell::new(None) };
    }

    fn set_last_error<M: Into<Vec<u8>>>(msg: M) {
        let value = CString::new(msg).unwrap_or_else(|_| {
            CString::new("error message contained an interior NUL byte")
                .expect("static message has no NUL")
        });
        LAST_ERROR.with(|cell| *cell.borrow_mut() = Some(value));
    }

    /// Returns the runtime ABI version of this library (see `APHRODY_NODISCARD`
    /// / `[[nodiscard]]` on the C declaration).
    #[unsafe(no_mangle)]
    #[must_use]
    pub extern "C" fn aphrody_abi_version() -> u32 {
        ABI_VERSION
    }

    /// Returns the aphrody version as a static, NUL-terminated UTF-8 string.
    ///
    /// The pointer is owned by the library and valid for the entire program
    /// lifetime — do NOT free it. Never NULL (`APHRODY_RETURNS_NONNULL`).
    #[unsafe(no_mangle)]
    #[must_use]
    pub extern "C" fn aphrody_version() -> *const c_char {
        static VERSION: OnceLock<CString> = OnceLock::new();
        VERSION
            .get_or_init(|| {
                CString::new(env!("CARGO_PKG_VERSION")).expect("crate version has no NUL")
            })
            .as_ptr()
    }

    /// Run an aphrody command with inherited stdout/stderr, returning the exit
    /// code.
    ///
    /// `argv` holds the command arguments WITHOUT the program name (a synthetic
    /// `argv[0]` is prepended internally), e.g. `["doctor", "--json"]`.
    ///
    /// # Safety
    /// `argv` must point to `argc` valid, NUL-terminated C strings, or be NULL
    /// iff `argc == 0`. The pointers are only read for the duration of the call.
    #[unsafe(no_mangle)]
    #[must_use]
    pub unsafe extern "C" fn aphrody_run(argc: c_int, argv: *const *const c_char) -> c_int {
        let outcome = catch_unwind(|| {
            // SAFETY: forwarded contract from this function's `# Safety` clause.
            match unsafe { collect_args(argc, argv) } {
                Some(args) => run_argv(args),
                None => {
                    set_last_error("invalid argv: null pointer or negative argc");
                    AphrodyStatus::Usage as c_int
                },
            }
        });
        outcome.unwrap_or_else(|payload| {
            set_last_error(format!("aphrody panicked: {}", panic_message(&*payload)));
            AphrodyStatus::Software as c_int
        })
    }

    /// Run an aphrody command from a JSON array of argument strings with
    /// inherited stdout/stderr, returning the exit code. Ergonomic alternative
    /// to `aphrody_run` for hosts that pass a JSON string more easily than a
    /// `char**` (e.g. Bun).
    ///
    /// # Safety
    /// `args_json` must be a valid NUL-terminated UTF-8 C string, or NULL
    /// (treated as `[]`).
    #[unsafe(no_mangle)]
    #[must_use]
    pub unsafe extern "C" fn aphrody_run_json(args_json: *const c_char) -> c_int {
        let outcome = catch_unwind(|| {
            // SAFETY: forwarded contract.
            match unsafe { parse_json_args(args_json) } {
                Ok(args) => run_argv(args),
                Err(message) => {
                    set_last_error(message);
                    AphrodyStatus::Usage as c_int
                },
            }
        });
        outcome.unwrap_or_else(|payload| {
            set_last_error(format!("aphrody panicked: {}", panic_message(&*payload)));
            AphrodyStatus::Software as c_int
        })
    }

    /// Run an aphrody command from a JSON array of arguments with stdout AND
    /// stderr captured, returning a newly-allocated NUL-terminated JSON
    /// document: `{"code":<int>,"stdout":"<text>","stderr":"<text>"}`.
    ///
    /// Returns NULL only on allocation failure (the cause is then retrievable
    /// via `aphrody_last_error`). The caller MUST free a non-NULL result with
    /// `aphrody_string_free`.
    ///
    /// # Safety
    /// `args_json` must be a valid NUL-terminated UTF-8 C string, or NULL
    /// (treated as `[]`).
    #[unsafe(no_mangle)]
    #[must_use]
    pub unsafe extern "C" fn aphrody_run_captured(args_json: *const c_char) -> *mut c_char {
        let outcome = catch_unwind(|| {
            // SAFETY: forwarded contract.
            match unsafe { parse_json_args(args_json) } {
                Ok(args) => {
                    // Serialise the process-global stdio redirect across threads.
                    let _guard = capture_lock();
                    let (code, out, err) = with_captured_stdio(|| run_argv(args));
                    json_result(code, &out, &err)
                },
                Err(message) => json_result(AphrodyStatus::Usage as i32, "", &message),
            }
        });
        let json = outcome.unwrap_or_else(|payload| {
            let message = format!("aphrody panicked: {}", panic_message(&*payload));
            set_last_error(message.clone());
            json_result(AphrodyStatus::Software as i32, "", &message)
        });
        string_to_c(json)
    }

    /// Free a string previously returned by this library (e.g.
    /// `aphrody_run_captured`). Passing NULL is a no-op.
    ///
    /// # Safety
    /// `ptr` must be a pointer this library returned and that has not already
    /// been freed, or NULL.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn aphrody_string_free(ptr: *mut c_char) {
        if ptr.is_null() {
            return;
        }
        // SAFETY: the caller guarantees `ptr` came from `CString::into_raw` in
        // this library and is freed exactly once.
        drop(unsafe { CString::from_raw(ptr) });
    }

    /// Returns the last error recorded on THIS thread as a static
    /// NUL-terminated string, or NULL if there is none.
    ///
    /// The pointer is valid until the next library call on this thread — copy it
    /// if you need to keep it. Do NOT free it.
    #[unsafe(no_mangle)]
    #[must_use]
    pub extern "C" fn aphrody_last_error() -> *const c_char {
        LAST_ERROR.with(|cell| match cell.borrow().as_ref() {
            Some(value) => value.as_ptr(),
            None => ptr::null(),
        })
    }

    // =======================================================================
    // Shenron Sovereign Monorepo C-ABI Exports
    // =======================================================================

    /// Returns the Shenron ABI revision.
    #[unsafe(no_mangle)]
    #[must_use]
    pub extern "C" fn shenron_abi_version() -> u32 {
        ABI_VERSION
    }

    /// Returns the Shenron version as a static NUL-terminated UTF-8 string.
    #[unsafe(no_mangle)]
    #[must_use]
    pub extern "C" fn shenron_version() -> *const c_char {
        aphrody_version()
    }

    /// Free a string returned by any Shenron FFI function (alias of `aphrody_string_free`).
    ///
    /// # Safety
    /// `ptr` must be null or a live string returned by a Shenron FFI function,
    /// not previously freed.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn shenron_string_free(ptr: *mut c_char) {
        unsafe { aphrody_string_free(ptr) };
    }

    /// Run any Shenron command with inherited stdio.
    ///
    /// # Safety
    /// `argv` must point to `argc` valid NUL-terminated C strings, or be null
    /// iff `argc == 0`; pointers are read only for this call.
    #[unsafe(no_mangle)]
    #[must_use]
    pub unsafe extern "C" fn shenron_run(argc: c_int, argv: *const *const c_char) -> c_int {
        let outcome = catch_unwind(|| match unsafe { collect_args(argc, argv) } {
            Some(mut args) => {
                args.insert(0, "shenron".to_string());
                run_argv(args)
            },
            None => {
                set_last_error("invalid argv: null pointer or negative argc");
                AphrodyStatus::Usage as c_int
            },
        });
        outcome.unwrap_or_else(|payload| {
            set_last_error(format!("shenron panicked: {}", panic_message(&*payload)));
            AphrodyStatus::Software as c_int
        })
    }

    /// Run any Shenron command from a JSON array of arguments with inherited stdio.
    ///
    /// # Safety
    /// `args_json` must be null or a valid NUL-terminated UTF-8 C string.
    #[unsafe(no_mangle)]
    #[must_use]
    pub unsafe extern "C" fn shenron_run_json(args_json: *const c_char) -> c_int {
        let outcome = catch_unwind(|| match unsafe { parse_json_args(args_json) } {
            Ok(mut args) => {
                args.insert(0, "shenron".to_string());
                run_argv(args)
            },
            Err(message) => {
                set_last_error(message);
                AphrodyStatus::Usage as c_int
            },
        });
        outcome.unwrap_or_else(|payload| {
            set_last_error(format!("shenron panicked: {}", panic_message(&*payload)));
            AphrodyStatus::Software as c_int
        })
    }

    /// Run any Shenron command with captured stdio, returning `{"code":0,"stdout":"...","stderr":"..."}` JSON.
    ///
    /// # Safety
    /// `args_json` must be null or a valid NUL-terminated UTF-8 C string. A
    /// non-null result must be released with `shenron_string_free`.
    #[unsafe(no_mangle)]
    #[must_use]
    pub unsafe extern "C" fn shenron_run_captured(args_json: *const c_char) -> *mut c_char {
        let outcome = catch_unwind(|| match unsafe { parse_json_args(args_json) } {
            Ok(mut args) => {
                args.insert(0, "shenron".to_string());
                let _guard = capture_lock();
                let (code, out, err) = with_captured_stdio(|| run_argv(args));
                json_result(code, &out, &err)
            },
            Err(message) => json_result(AphrodyStatus::Usage as i32, "", &message),
        });
        let json = outcome.unwrap_or_else(|payload| {
            let message = format!("shenron panicked: {}", panic_message(&*payload));
            set_last_error(message.clone());
            json_result(AphrodyStatus::Software as i32, "", &message)
        });
        string_to_c(json)
    }

    /// Perform a high-speed RAG search on the Shenron index in-process.
    /// Returns a JSON string of results. Must be freed with `shenron_string_free` / `aphrody_string_free`.
    ///
    /// # Safety
    /// `query` must be a valid NUL-terminated C string; `kind` may be null or a
    /// valid NUL-terminated C string. A non-null result must be freed once.
    #[unsafe(no_mangle)]
    #[must_use]
    pub unsafe extern "C" fn shenron_rag_search(
        query: *const c_char,
        limit: c_int,
        kind: *const c_char,
    ) -> *mut c_char {
        let outcome = catch_unwind(|| {
            if query.is_null() {
                return json_result(AphrodyStatus::Usage as i32, "", "query pointer is null");
            }
            let q_str = match unsafe { CStr::from_ptr(query) }.to_str() {
                Ok(s) => s.to_string(),
                Err(_) => {
                    return json_result(
                        AphrodyStatus::Usage as i32,
                        "",
                        "query is not valid UTF-8",
                    );
                },
            };
            let mut args = vec![
                "shenron".to_string(),
                "rag".to_string(),
                "search".to_string(),
                q_str,
                "--limit".to_string(),
                limit.max(1).to_string(),
                "--json".to_string(),
            ];
            if !kind.is_null()
                && let Ok(k_str) = unsafe { CStr::from_ptr(kind) }.to_str()
                && !k_str.is_empty()
            {
                args.push("--kind".to_string());
                args.push(k_str.to_string());
            }
            let _guard = capture_lock();
            let (code, out, err) = with_captured_stdio(|| run_argv(args));
            json_result(code, &out, &err)
        });
        let json = outcome.unwrap_or_else(|payload| {
            let message = format!("shenron_rag_search panicked: {}", panic_message(&*payload));
            set_last_error(message.clone());
            json_result(AphrodyStatus::Software as i32, "", &message)
        });
        string_to_c(json)
    }

    /// Retrieve Shenron RAG index statistics as a JSON string.
    #[unsafe(no_mangle)]
    #[must_use]
    pub extern "C" fn shenron_rag_stats() -> *mut c_char {
        let outcome = catch_unwind(|| {
            let args = vec![
                "shenron".to_string(),
                "rag".to_string(),
                "stats".to_string(),
                "--json".to_string(),
            ];
            let _guard = capture_lock();
            let (code, out, err) = with_captured_stdio(|| run_argv(args));
            json_result(code, &out, &err)
        });
        let json = outcome.unwrap_or_else(|payload| {
            let message = format!("shenron_rag_stats panicked: {}", panic_message(&*payload));
            set_last_error(message.clone());
            json_result(AphrodyStatus::Software as i32, "", &message)
        });
        string_to_c(json)
    }

    /// Chunk Shenron Markdown with Aphrody's canonical RAG implementation.
    /// Returns a JSON array of `{content, section}` objects. Free the returned
    /// string with `shenron_string_free`.
    ///
    /// # Safety
    /// `markdown` must be a valid NUL-terminated UTF-8 string; result must be
    /// freed exactly once.
    #[unsafe(no_mangle)]
    #[must_use]
    pub unsafe extern "C" fn shenron_rag_chunk(
        markdown: *const c_char,
        max_chars: c_int,
        overlap_pct: f32,
    ) -> *mut c_char {
        use aphrody_rag_core::Chunker;

        let outcome = catch_unwind(|| {
            if markdown.is_null() {
                return "{\"error\":\"markdown pointer is null\"}".to_owned();
            }
            let source = match unsafe { CStr::from_ptr(markdown) }.to_str() {
                Ok(source) => source,
                Err(_) => return "{\"error\":\"markdown is not valid UTF-8\"}".to_owned(),
            };
            let mut options = aphrody_rag_core::ChunkOptions::shenron_parity();
            options.max_chars = usize::try_from(max_chars.max(1)).unwrap_or(1);
            options.overlap_pct = overlap_pct.clamp(0.0, 1.0);
            let chunks = aphrody_rag_core::MarkdownChunker.chunk(source, source, &options);
            serde_json::to_string(
                &chunks
                    .into_iter()
                    .map(|chunk| {
                        serde_json::json!({
                            "content": chunk.text,
                            "section": chunk.symbol.unwrap_or_default(),
                        })
                    })
                    .collect::<Vec<_>>(),
            )
            .unwrap_or_else(|error| {
                format!(
                    "{{\"error\":{}}}",
                    serde_json::to_string(&error.to_string()).unwrap_or_default()
                )
            })
        });
        let json = outcome.unwrap_or_else(|payload| {
            format!(
                "{{\"error\":{}}}",
                serde_json::to_string(&format!(
                    "shenron_rag_chunk panicked: {}",
                    panic_message(&*payload)
                ))
                .unwrap_or_default()
            )
        });
        string_to_c(json)
    }

    /// Retrieve only whether local admin credentials are configured.
    ///
    /// The CLI JSON contract is deliberately sanitized and must never include
    /// credential values, cookies, tokens, scopes, or account identifiers.
    #[unsafe(no_mangle)]
    #[must_use]
    pub extern "C" fn shenron_auth_status() -> *mut c_char {
        let outcome = catch_unwind(|| {
            let args = vec![
                "shenron".to_string(),
                "auth".to_string(),
                "status".to_string(),
                "--json".to_string(),
            ];
            let _guard = capture_lock();
            let (code, out, err) = with_captured_stdio(|| run_argv(args));
            json_result(code, &out, &err)
        });
        let json = outcome.unwrap_or_else(|payload| {
            let message = format!("shenron_auth_status panicked: {}", panic_message(&*payload));
            set_last_error(message.clone());
            json_result(AphrodyStatus::Software as i32, "", &message)
        });
        string_to_c(json)
    }

    /// Retrieve the canonical Akira Toriyama (Tori-bot) x Shenron persona prompt.
    #[unsafe(no_mangle)]
    #[must_use]
    pub extern "C" fn shenron_persona_prompt() -> *const c_char {
        static SOUL: OnceLock<CString> = OnceLock::new();
        SOUL.get_or_init(|| {
            shenron_persona_from_state(aphrody_agent_home::paths::state_dir().ok().as_deref())
        })
        .as_ptr()
    }

    fn shenron_persona_from_state(state: Option<&std::path::Path>) -> CString {
        let text = state
            .map(|state| aphrody_agent_home::paths::named_profile_workspace(state, "dbfr"))
            .and_then(|root| aphrody_agent_home::SyncSnapshot::capture(root).ok())
            .and_then(|snapshot| {
                snapshot.documents.into_iter().find(|document| document.filename == "SOUL.md")
            })
            .map_or_else(
                || "Shenron x Akira Toriyama (Tori-bot) Canon Persona".to_owned(),
                |document| document.content,
            );
        CString::new(text).unwrap_or_else(|_| c"Shenron Persona".to_owned())
    }

    /// Query the sovereign Akira Toriyama / Shenron persona directly.
    ///
    /// # Safety
    /// `question` must be a valid NUL-terminated C string. A non-null result
    /// must be released with `shenron_string_free` exactly once.
    #[unsafe(no_mangle)]
    #[must_use]
    pub unsafe extern "C" fn shenron_persona_ask(question: *const c_char) -> *mut c_char {
        let outcome = catch_unwind(|| {
            if question.is_null() {
                return json_result(AphrodyStatus::Usage as i32, "", "question pointer is null");
            }
            let q_str = match unsafe { CStr::from_ptr(question) }.to_str() {
                Ok(s) => s.to_string(),
                Err(_) => {
                    return json_result(
                        AphrodyStatus::Usage as i32,
                        "",
                        "question is not valid UTF-8",
                    );
                },
            };
            let args = vec!["shenron".to_string(), "persona".to_string(), "ask".to_string(), q_str];
            let _guard = capture_lock();
            let (code, out, err) = with_captured_stdio(|| run_argv(args));
            json_result(code, &out, &err)
        });
        let json = outcome.unwrap_or_else(|payload| {
            let message = format!("shenron_persona_ask panicked: {}", panic_message(&*payload));
            set_last_error(message.clone());
            json_result(AphrodyStatus::Software as i32, "", &message)
        });
        string_to_c(json)
    }

    // =========================================================================
    // Manga analysis and reusable layout, inpainting, typesetting, PSD utilities
    // =========================================================================

    /// Returns the Manga ABI version.
    #[unsafe(no_mangle)]
    #[must_use]
    pub extern "C" fn manga_abi_version() -> u32 {
        1
    }

    /// Detect Koharu page regions on a raw PNG/JPEG/WebP image buffer.
    /// Returns a versioned JSON result with geometry and model provenance.
    ///
    /// # Safety
    /// `image_bytes` must point to `image_len` readable bytes. A non-null result
    /// must be released with `manga_string_free` exactly once.
    #[unsafe(no_mangle)]
    #[must_use]
    pub unsafe extern "C" fn manga_detect_bubbles(
        image_bytes: *const u8,
        image_len: usize,
    ) -> *mut c_char {
        let outcome = catch_unwind(|| {
            if image_bytes.is_null() || image_len == 0 {
                return json_result(
                    AphrodyStatus::Usage as i32,
                    "",
                    "image bytes pointer is null or empty",
                );
            }
            let slice = unsafe { std::slice::from_raw_parts(image_bytes, image_len) };
            let options = aphrody_manga::MangaPipelineOptions::default();
            match runtime()
                .block_on(aphrody_manga::MangaPipeline::detect_image_bytes(slice, &options))
            {
                Ok(output) => {
                    let json =
                        serde_json::to_string(&output.result).unwrap_or_else(|_| "{}".to_string());
                    json_result(0, &json, "")
                },
                Err(err) => json_result(
                    AphrodyStatus::Software as i32,
                    "",
                    &format!("manga process failed: {err}"),
                ),
            }
        });
        let json = outcome.unwrap_or_else(|payload| {
            let message = format!("manga_detect_bubbles panicked: {}", panic_message(&*payload));
            set_last_error(message.clone());
            json_result(AphrodyStatus::Software as i32, "", &message)
        });
        string_to_c(json)
    }

    /// Calculate optimal typesetting layout and font fitting for text inside a bounding box.
    ///
    /// # Safety
    /// `text` must be a valid NUL-terminated UTF-8 C string. A non-null result
    /// must be released with `manga_string_free` exactly once.
    #[unsafe(no_mangle)]
    #[must_use]
    pub unsafe extern "C" fn manga_typeset_fit(
        text: *const c_char,
        box_x: f32,
        box_y: f32,
        box_w: f32,
        box_h: f32,
        vertical: c_int,
    ) -> *mut c_char {
        let outcome = catch_unwind(|| {
            if text.is_null() {
                return json_result(AphrodyStatus::Usage as i32, "", "text pointer is null");
            }
            let text_str = match unsafe { CStr::from_ptr(text) }.to_str() {
                Ok(s) => s,
                Err(_) => {
                    return json_result(AphrodyStatus::Usage as i32, "", "text is not valid UTF-8");
                },
            };

            let bubble = aphrody_manga::SpeechBubble::new(
                1,
                aphrody_manga::BoundingBox::new(box_x, box_y, box_w, box_h),
                aphrody_manga::BubbleKind::Dialogue,
                1.0,
            );

            let mut style = aphrody_manga::TextStyle::default();
            if vertical != 0 {
                style.writing_mode = aphrody_manga::WritingMode::VerticalRl;
            }

            let layout =
                aphrody_manga::TypesetEngine::fit_text_to_bubble(text_str, &bubble, &style);
            let json = serde_json::to_string(&layout).unwrap_or_else(|_| "{}".to_string());
            json_result(0, &json, "")
        });
        let json = outcome.unwrap_or_else(|payload| {
            let message = format!("manga_typeset_fit panicked: {}", panic_message(&*payload));
            set_last_error(message.clone());
            json_result(AphrodyStatus::Software as i32, "", &message)
        });
        string_to_c(json)
    }

    /// Execute the full manga pipeline and generate a multi-layer Photoshop (.psd) file.
    /// Returns a JSON string with metadata and base64-encoded PSD file bytes.
    ///
    /// # Safety
    /// `image_bytes` must point to `image_len` readable bytes. `target_lang`
    /// must be null or a valid NUL-terminated UTF-8 C string. A non-null result
    /// must be released with `manga_string_free` exactly once.
    #[unsafe(no_mangle)]
    #[must_use]
    pub unsafe extern "C" fn manga_pipeline_run(
        image_bytes: *const u8,
        image_len: usize,
        target_lang: *const c_char,
    ) -> *mut c_char {
        use base64::Engine;
        let outcome = catch_unwind(|| {
            if image_bytes.is_null() || image_len == 0 {
                return json_result(
                    AphrodyStatus::Usage as i32,
                    "",
                    "image bytes pointer is null or empty",
                );
            }
            let lang = if target_lang.is_null() {
                "fr"
            } else {
                unsafe { CStr::from_ptr(target_lang) }.to_str().unwrap_or("fr")
            };

            let slice = unsafe { std::slice::from_raw_parts(image_bytes, image_len) };
            let options = aphrody_manga::MangaPipelineOptions {
                target_language: lang.to_string(),
                ..Default::default()
            };

            match runtime()
                .block_on(aphrody_manga::MangaPipeline::process_image_bytes(slice, &options))
            {
                Ok(output) => {
                    let page_result = output.result;
                    let Some(psd_bytes) = output.psd_bytes else {
                        return json_result(
                            AphrodyStatus::Software as i32,
                            "",
                            "Koharu did not export a PSD",
                        );
                    };
                    let b64_psd = base64::engine::general_purpose::STANDARD.encode(&psd_bytes);
                    let payload = serde_json::json!({
                        "result": page_result,
                        "psd_base64": b64_psd,
                        "psd_size_bytes": psd_bytes.len(),
                    });
                    json_result(0, &payload.to_string(), "")
                },
                Err(err) => json_result(
                    AphrodyStatus::Software as i32,
                    "",
                    &format!("pipeline failed: {err}"),
                ),
            }
        });
        let json = outcome.unwrap_or_else(|payload| {
            let message = format!("manga_pipeline_run panicked: {}", panic_message(&*payload));
            set_last_error(message.clone());
            json_result(AphrodyStatus::Software as i32, "", &message)
        });
        string_to_c(json)
    }

    /// Stream and scanlate a manga plate directly from a CDN URL or relative path.
    ///
    /// # Safety
    /// `url_or_path` must be a valid NUL-terminated UTF-8 C string. `target_lang`
    /// may be null or a valid NUL-terminated UTF-8 C string. A non-null result
    /// must be released with `manga_string_free` exactly once.
    #[unsafe(no_mangle)]
    #[must_use]
    pub unsafe extern "C" fn manga_scanlate_cdn(
        url_or_path: *const c_char,
        target_lang: *const c_char,
    ) -> *mut c_char {
        use base64::Engine;
        let outcome = catch_unwind(|| {
            if url_or_path.is_null() {
                return json_result(AphrodyStatus::Usage as i32, "", "url_or_path is null");
            }
            let url_str = match unsafe { CStr::from_ptr(url_or_path) }.to_str() {
                Ok(s) => s,
                Err(err) => {
                    return json_result(
                        AphrodyStatus::Usage as i32,
                        "",
                        &format!("invalid utf-8 in url: {err}"),
                    );
                },
            };
            let lang = if target_lang.is_null() {
                "fr"
            } else {
                unsafe { CStr::from_ptr(target_lang) }.to_str().unwrap_or("fr")
            };

            let rt = runtime();
            let options = aphrody_manga::MangaPipelineOptions {
                target_language: lang.to_string(),
                ..Default::default()
            };

            let client = aphrody_manga::MangaCdnClient::new();
            match rt.block_on(client.scanlate_cdn_plate(url_str, &options)) {
                Ok((page_result, psd_bytes)) => {
                    let b64_psd = base64::engine::general_purpose::STANDARD.encode(&psd_bytes);
                    let payload = serde_json::json!({
                        "result": page_result,
                        "psd_base64": b64_psd,
                        "psd_size_bytes": psd_bytes.len(),
                        "cdn_url": url_str,
                    });
                    json_result(0, &payload.to_string(), "")
                },
                Err(err) => json_result(
                    AphrodyStatus::Software as i32,
                    "",
                    &format!("cdn scanlation failed: {err}"),
                ),
            }
        });
        let json = outcome.unwrap_or_else(|payload| {
            let message = format!("manga_scanlate_cdn panicked: {}", panic_message(&*payload));
            set_last_error(message.clone());
            json_result(AphrodyStatus::Software as i32, "", &message)
        });
        string_to_c(json)
    }

    /// Stream and scanlate a databook plate directly from the Dragon Ball FR catalog by ID and plate number.
    ///
    /// # Safety
    /// `target_lang` must be null or a valid NUL-terminated UTF-8 C string. A
    /// non-null result must be released with `manga_string_free` exactly once.
    #[unsafe(no_mangle)]
    #[must_use]
    pub unsafe extern "C" fn manga_scanlate_databook(
        databook_id: u64,
        plate_number: u32,
        target_lang: *const c_char,
    ) -> *mut c_char {
        use base64::Engine;
        let outcome = catch_unwind(|| {
            let lang = if target_lang.is_null() {
                "fr"
            } else {
                unsafe { CStr::from_ptr(target_lang) }.to_str().unwrap_or("fr")
            };

            let rt = runtime();
            let options = aphrody_manga::MangaPipelineOptions {
                target_language: lang.to_string(),
                ..Default::default()
            };

            let client = aphrody_manga::MangaCdnClient::new();
            match rt.block_on(client.scanlate_databook_plate(databook_id, plate_number, &options)) {
                Ok((page_result, psd_bytes, record)) => {
                    let b64_psd = base64::engine::general_purpose::STANDARD.encode(&psd_bytes);
                    let payload = serde_json::json!({
                        "result": page_result,
                        "psd_base64": b64_psd,
                        "psd_size_bytes": psd_bytes.len(),
                        "cdn_url": record.cdn_url,
                        "existing_text": record.existing_text,
                        "databook_id": databook_id,
                        "plate_number": plate_number,
                    });
                    json_result(0, &payload.to_string(), "")
                },
                Err(err) => json_result(
                    AphrodyStatus::Software as i32,
                    "",
                    &format!("databook scanlation failed: {err}"),
                ),
            }
        });
        let json = outcome.unwrap_or_else(|payload| {
            let message = format!("manga_scanlate_databook panicked: {}", panic_message(&*payload));
            set_last_error(message.clone());
            json_result(AphrodyStatus::Software as i32, "", &message)
        });
        string_to_c(json)
    }

    /// Stream and scanlate a manga chapter plate directly from the Dragon Ball FR catalog.
    ///
    /// # Safety
    /// `target_lang` must be null or a valid NUL-terminated UTF-8 C string. A
    /// non-null result must be released with `manga_string_free` exactly once.
    #[unsafe(no_mangle)]
    #[must_use]
    pub unsafe extern "C" fn manga_scanlate_chapter(
        chapter_id: u64,
        plate_number: u32,
        target_lang: *const c_char,
    ) -> *mut c_char {
        use base64::Engine;
        let outcome = catch_unwind(|| {
            let lang = if target_lang.is_null() {
                "fr"
            } else {
                unsafe { CStr::from_ptr(target_lang) }.to_str().unwrap_or("fr")
            };

            let rt = runtime();
            let options = aphrody_manga::MangaPipelineOptions {
                target_language: lang.to_string(),
                ..Default::default()
            };

            let client = aphrody_manga::MangaCdnClient::new();
            match rt.block_on(client.scanlate_manga_plate(chapter_id, plate_number, &options)) {
                Ok((page_result, psd_bytes, record)) => {
                    let b64_psd = base64::engine::general_purpose::STANDARD.encode(&psd_bytes);
                    let payload = serde_json::json!({
                        "result": page_result,
                        "psd_base64": b64_psd,
                        "psd_size_bytes": psd_bytes.len(),
                        "cdn_url": record.cdn_url,
                        "existing_text": record.existing_text,
                        "chapter_id": chapter_id,
                        "plate_number": plate_number,
                    });
                    json_result(0, &payload.to_string(), "")
                },
                Err(err) => json_result(
                    AphrodyStatus::Software as i32,
                    "",
                    &format!("chapter scanlation failed: {err}"),
                ),
            }
        });
        let json = outcome.unwrap_or_else(|payload| {
            let message = format!("manga_scanlate_chapter panicked: {}", panic_message(&*payload));
            set_last_error(message.clone());
            json_result(AphrodyStatus::Software as i32, "", &message)
        });
        string_to_c(json)
    }

    /// Free a string returned by any of the `manga_*` functions.
    ///
    /// # Safety
    /// `ptr` must be null or a live string returned by a `manga_*` function,
    /// not previously freed.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn manga_string_free(ptr: *mut c_char) {
        unsafe { aphrody_string_free(ptr) };
    }

    // ---- internal helpers -------------------------------------------------

    /// Process-wide tokio runtime, created lazily on first use, so repeated FFI
    /// calls do not pay the worker-thread spawn cost on every invocation.
    pub(crate) fn runtime() -> &'static tokio::runtime::Runtime {
        static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
        RUNTIME.get_or_init(|| {
            tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .thread_stack_size(8 * 1024 * 1024)
                .build()
                .expect("aphrody-ffi: failed to build the tokio runtime")
        })
    }

    /// Serialise stdout/stderr capture: the redirect swaps process-global file
    /// descriptors, so two concurrent captures (e.g. Bun Workers) would corrupt
    /// each other's save/restore. Lock poison is recovered (the `()` payload is
    /// meaningless).
    fn capture_lock() -> std::sync::MutexGuard<'static, ()> {
        static CAPTURE_LOCK: Mutex<()> = Mutex::new(());
        CAPTURE_LOCK.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Best-effort message extracted from a `catch_unwind` panic payload.
    fn panic_message(payload: &(dyn std::any::Any + Send)) -> &str {
        payload
            .downcast_ref::<&str>()
            .copied()
            .or_else(|| payload.downcast_ref::<String>().map(String::as_str))
            .unwrap_or("unknown panic")
    }

    /// Build the argument vector (synthetic program name + caller args) and
    /// dispatch on the persistent runtime.
    fn run_argv(args: Vec<String>) -> i32 {
        let mut argv: Vec<OsString> = Vec::with_capacity(args.len() + 1);
        argv.push(OsString::from("aphrody"));
        argv.extend(args.into_iter().map(OsString::from));
        runtime().block_on(aphrody_command::run_async(argv))
    }

    /// Collect `argc` C strings into owned `String`s (lossy UTF-8).
    ///
    /// # Safety
    /// `argv` must point to `argc` valid NUL-terminated strings (or be NULL iff
    /// `argc == 0`).
    unsafe fn collect_args(argc: c_int, argv: *const *const c_char) -> Option<Vec<String>> {
        let argc = usize::try_from(argc).ok()?;
        if argc == 0 {
            return Some(Vec::new());
        }
        if argv.is_null() {
            return None;
        }
        let mut out = Vec::with_capacity(argc);
        for i in 0..argc {
            // SAFETY: caller guarantees `argv` has `argc` valid entries.
            let entry = unsafe { *argv.add(i) };
            if entry.is_null() {
                return None;
            }
            // SAFETY: caller guarantees each entry is a NUL-terminated string.
            let text = unsafe { CStr::from_ptr(entry) };
            out.push(text.to_string_lossy().into_owned());
        }
        Some(out)
    }

    /// Parse a JSON array of strings from a C string.
    ///
    /// # Safety
    /// `ptr` must be a valid NUL-terminated string, or NULL (treated as `[]`).
    unsafe fn parse_json_args(ptr: *const c_char) -> Result<Vec<String>, String> {
        if ptr.is_null() {
            return Ok(Vec::new());
        }
        // SAFETY: caller guarantees a NUL-terminated string.
        let raw = unsafe { CStr::from_ptr(ptr) };
        let text = raw.to_str().map_err(|_| "args_json is not valid UTF-8".to_string())?;
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }
        serde_json::from_str::<Vec<String>>(trimmed)
            .map_err(|err| format!("args_json must be a JSON array of strings: {err}"))
    }

    /// Render the captured run result as a compact JSON document.
    fn json_result(code: i32, stdout: &str, stderr: &str) -> String {
        serde_json::json!({
            "code": code,
            "stdout": stdout,
            "stderr": stderr,
        })
        .to_string()
    }

    /// Move a `String` into a freshly-allocated C string (caller frees via
    /// `aphrody_string_free`); NULL + recorded error on interior NUL.
    fn string_to_c(text: String) -> *mut c_char {
        match CString::new(text) {
            Ok(value) => value.into_raw(),
            Err(_) => {
                set_last_error("result contained an interior NUL byte");
                ptr::null_mut()
            },
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn abi_version_is_one() {
            assert_eq!(aphrody_abi_version(), 1);
            assert_eq!(aphrody_abi_version(), ABI_VERSION);
        }

        /// The hand-written header must declare the same ABI revision the Rust
        /// symbol reports, so the two never drift. Parses `APHRODY_ABI_VERSION`
        /// out of `include/aphrody.h` (relative to `CARGO_MANIFEST_DIR`).
        #[test]
        fn header_abi_version_matches() {
            let header =
                std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/include/aphrody.h"))
                    .expect("aphrody.h is readable");

            let line = header
                .lines()
                .find(|l| l.trim_start().starts_with("#define APHRODY_ABI_VERSION"))
                .expect("header defines APHRODY_ABI_VERSION");

            // `#define APHRODY_ABI_VERSION 1u` -> strip the `u`/`U` suffix.
            let value: u32 = line
                .rsplit_once("APHRODY_ABI_VERSION")
                .map(|(_, rest)| rest.trim())
                .and_then(|tok| tok.trim_end_matches(['u', 'U', 'l', 'L']).parse().ok())
                .expect("APHRODY_ABI_VERSION is a parseable integer literal");

            assert_eq!(value, ABI_VERSION, "header and Rust ABI versions disagree");
        }

        /// The typed status codes must keep the documented sysexits values; the
        /// `#[repr(i32)]` lets us round-trip them through `c_int`.
        #[test]
        fn status_codes_match_documented_values() {
            assert_eq!(AphrodyStatus::Usage as c_int, 64);
            assert_eq!(AphrodyStatus::Software as c_int, 70);
        }

        /// A negative `argc` is a usage error, never a panic, and records a
        /// diagnostic on this thread.
        #[test]
        fn run_rejects_negative_argc() {
            // SAFETY: NULL argv with a negative argc is an explicitly handled,
            // rejected input — no pointer is dereferenced.
            let code = unsafe { aphrody_run(-1, ptr::null()) };
            assert_eq!(code, AphrodyStatus::Usage as c_int);
            assert!(!aphrody_last_error().is_null());
        }

        /// `aphrody_run_json` with malformed JSON returns the usage code rather
        /// than panicking, and string_free tolerates the resulting NULL paths.
        #[test]
        fn run_json_rejects_malformed_json() {
            let json = CString::new("not json").unwrap();
            // SAFETY: valid NUL-terminated string; bad *content* is handled.
            let code = unsafe { aphrody_run_json(json.as_ptr()) };
            assert_eq!(code, AphrodyStatus::Usage as c_int);
        }

        #[test]
        fn string_free_tolerates_null() {
            // SAFETY: NULL is an explicitly documented no-op for string_free.
            unsafe { aphrody_string_free(ptr::null_mut()) };
        }

        #[test]
        fn version_is_non_empty_and_stable() {
            let ptr = aphrody_version();
            assert!(!ptr.is_null());
            // SAFETY: aphrody_version returns a valid static C string.
            let text = unsafe { CStr::from_ptr(ptr) }.to_str().unwrap();
            assert!(!text.is_empty());
            // Same static across calls.
            assert_eq!(aphrody_version(), ptr);
        }

        #[test]
        fn parse_json_args_round_trips() {
            let json = CString::new(r#"["doctor","--json"]"#).unwrap();
            // SAFETY: valid NUL-terminated string.
            let args = unsafe { parse_json_args(json.as_ptr()) }.unwrap();
            assert_eq!(args, vec!["doctor".to_string(), "--json".to_string()]);
        }

        #[test]
        fn parse_json_args_null_is_empty() {
            // SAFETY: NULL is an explicitly handled input.
            let args = unsafe { parse_json_args(ptr::null()) }.unwrap();
            assert!(args.is_empty());
        }

        #[test]
        fn parse_json_args_rejects_non_array() {
            let json = CString::new(r#"{"not":"an array"}"#).unwrap();
            // SAFETY: valid NUL-terminated string.
            let result = unsafe { parse_json_args(json.as_ptr()) };
            assert!(result.is_err());
        }

        #[test]
        fn collect_args_builds_vector() {
            let first = CString::new("scan").unwrap();
            let second = CString::new("tree").unwrap();
            let argv = [first.as_ptr(), second.as_ptr()];
            // SAFETY: argv has 2 valid entries.
            let args = unsafe { collect_args(2, argv.as_ptr()) }.unwrap();
            assert_eq!(args, vec!["scan".to_string(), "tree".to_string()]);
        }

        #[test]
        fn collect_args_zero_is_empty() {
            // SAFETY: argc 0 with NULL argv is explicitly allowed.
            let args = unsafe { collect_args(0, ptr::null()) }.unwrap();
            assert!(args.is_empty());
        }

        #[test]
        fn json_result_has_expected_shape() {
            let doc = json_result(3, "hello", "oops");
            let value: serde_json::Value = serde_json::from_str(&doc).unwrap();
            assert_eq!(value["code"], 3);
            assert_eq!(value["stdout"], "hello");
            assert_eq!(value["stderr"], "oops");
        }

        #[test]
        fn last_error_round_trips() {
            set_last_error("boom");
            let ptr = aphrody_last_error();
            assert!(!ptr.is_null());
            // SAFETY: non-null static-lifetime string set on this thread.
            let text = unsafe { CStr::from_ptr(ptr) }.to_str().unwrap();
            assert_eq!(text, "boom");
        }

        #[test]
        fn shenron_abi_and_version_are_valid() {
            assert_eq!(shenron_abi_version(), 1);
            let ptr = shenron_version();
            assert!(!ptr.is_null());
            let text = unsafe { CStr::from_ptr(ptr) }.to_str().unwrap();
            assert!(!text.is_empty());
        }

        #[test]
        fn shenron_persona_prompt_returns_canon() {
            let ptr = shenron_persona_prompt();
            assert!(!ptr.is_null());
            let text = unsafe { CStr::from_ptr(ptr) }.to_str().unwrap();
            assert!(text.contains("Toriyama") || text.contains("Shenron"));
            assert_eq!(shenron_persona_prompt(), ptr, "the C pointer remains process-stable");
        }

        fn persona_fixture(
            state: &std::path::Path,
            profile: &str,
            soul: &str,
        ) -> std::path::PathBuf {
            let root = state.join("workspaces").join(profile);
            std::fs::create_dir_all(&root).unwrap();
            for file in aphrody_agent_home::sync_defaults().unwrap() {
                let content =
                    if file.filename() == "SOUL.md" { soul } else { "# Synthetic fixture\n" };
                std::fs::write(root.join(file.filename()), content).unwrap();
            }
            root
        }

        #[test]
        fn shenron_persona_reads_the_dbfr_snapshot_instead_of_other_or_legacy_homes() {
            let state = tempfile::tempdir().unwrap();
            let soul = "---\ntone: précis\nbrevity: terse\n---\n\nShenron dbfr fixture.\n";
            let root = persona_fixture(state.path(), "dbfr", soul);
            persona_fixture(state.path(), "aphrody", "Aphrody unrelated persona.\n");
            let legacy = state.path().join("home/shenron");
            std::fs::create_dir_all(&legacy).unwrap();
            std::fs::write(legacy.join("SOUL.md"), "Legacy unrelated persona.\n").unwrap();
            let snapshot = aphrody_agent_home::SyncSnapshot::capture(&root).unwrap();
            let selected = snapshot.documents.iter().find(|doc| doc.filename == "SOUL.md").unwrap();
            assert_eq!(selected.content, soul);
            assert_eq!(shenron_persona_from_state(Some(state.path())).to_str().unwrap(), soul);
        }

        #[test]
        fn shenron_persona_retains_fallback_for_missing_or_incomplete_snapshots() {
            let state = tempfile::tempdir().unwrap();
            let fallback = "Shenron x Akira Toriyama (Tori-bot) Canon Persona";
            assert_eq!(shenron_persona_from_state(None).to_str().unwrap(), fallback);
            let root = persona_fixture(state.path(), "dbfr", "Shenron fixture.\n");
            std::fs::remove_file(root.join("BOOT.md")).unwrap();
            assert_eq!(shenron_persona_from_state(Some(state.path())).to_str().unwrap(), fallback);
        }

        #[test]
        fn shenron_persona_interior_nul_keeps_a_valid_c_string() {
            let state = tempfile::tempdir().unwrap();
            persona_fixture(state.path(), "dbfr", "Shenron fixture\0not a C string.\n");
            assert_eq!(
                shenron_persona_from_state(Some(state.path())).as_c_str(),
                c"Shenron Persona"
            );
        }

        #[test]
        fn shenron_run_captured_runs_in_process() {
            std::thread::Builder::new()
                .stack_size(8 * 1024 * 1024)
                .spawn(|| {
                    let json = CString::new(r#"["auth", "status", "--json"]"#).unwrap();
                    let res_ptr = unsafe { shenron_run_captured(json.as_ptr()) };
                    assert!(!res_ptr.is_null());
                    let text = unsafe { CStr::from_ptr(res_ptr) }.to_str().unwrap();
                    assert!(text.contains("code"));
                    unsafe { shenron_string_free(res_ptr) };
                })
                .expect("failed to spawn test thread")
                .join()
                .expect("test thread panicked");
        }
    }
}
