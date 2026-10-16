/* SPDX-License-Identifier: Apache-2.0 */
/**
 * @file aphrody.h
 * @brief C ABI for the aphrody native library (crate `aphrody-ffi`): aphrody_*, yolo_* and bun_rs_*.
 *
 * Declares the command-dispatch ABI and the aphrody_*, yolo_* and bun_rs_*
 * core interfaces. Command availability depends on the library's compiled
 * features and runtime configuration; this header does not qualify complete
 * CLI/FFI parity on every target. Optional feature interfaces are declared in
 * aphrody-tooling.h, aphrody-inference.h and aphrody-web-pipeline.h.
 * Link against the
 * cdylib (`libaphrody_ffi.so` / `aphrody_ffi.dll` / `libaphrody_ffi.dylib`) or
 * load it dynamically (`dlopen` / `LoadLibrary` / Bun `bun:ffi`).
 *
 * @section conv Conventions
 *  - Command arguments are passed WITHOUT the program name; a synthetic
 *    `argv[0]` (`"aphrody"`) is prepended internally, e.g. `{"doctor",
 *    "--json"}`.
 *  - All strings are UTF-8 and NUL-terminated. Invalid UTF-8 in inputs is
 *    rejected (#APHRODY_STATUS_USAGE); invalid UTF-8 in captured output is
 *    replaced lossily (U+FFFD).
 *  - A `char *` returned by ::aphrody_run_captured is owned by the CALLER and
 *    MUST be released with ::aphrody_string_free exactly once.
 *  - `const char *` results (::aphrody_version, ::aphrody_last_error) are owned
 *    by the LIBRARY; do NOT free them.
 *  - Every entry point catches Rust panics and the wrapped commands never call
 *    `exit(3)`, so a failing command cannot tear down the host process.
 *
 * @section abi ABI stability
 *  ::aphrody_abi_version returns the runtime ABI revision; #APHRODY_ABI_VERSION
 *  is the compile-time constant this header describes. A host should reject a
 *  library whose runtime version differs from the header it compiled against.
 *  The integer is bumped on ANY source-incompatible change to the symbol set.
 *
 * @copyright aphrody-code, Apache-2.0.
 */
#ifndef APHRODY_H
#define APHRODY_H

#include <stddef.h> /* size_t */
#include <stdint.h> /* uint32_t, int32_t */
#include <stdbool.h> /* bool (bun_rs_* exports) */

/**
 * @def APHRODY_ABI_VERSION
 * @brief Compile-time ABI revision described by this header.
 *
 * Kept in lock-step with the value returned by ::aphrody_abi_version at
 * runtime; a mismatch indicates the header and the loaded library disagree.
 */
#define APHRODY_ABI_VERSION 1u

/**
 * @def APHRODY_HEADER_VERSION
 * @brief Revision of this header file as a single contract.
 *
 * 2: the yolo_* runtime ABI (formerly yolo_runtime.h) is declared here, so
 * aphrody.h is the canonical main header of the aphrody_ffi library
 * (aphrody_*, yolo_*, bun_rs_*). aphrody-tooling.h, aphrody-inference.h and
 * aphrody-web-pipeline.h declare the optional feature sets. Runtime
 * negotiation is unchanged: ::aphrody_abi_version for aphrody_*,
 * ::yolo_abi_version against YOLO_ABI_MAJOR/YOLO_ABI_MINOR for yolo_*.
 */
#define APHRODY_HEADER_VERSION 2u

/*
 * APHRODY_API — symbol visibility / linkage decoration.
 *
 * On Windows the consuming side may define APHRODY_STATIC (linking the static
 * archive) to suppress dllimport. The cdylib itself is built by Rust with
 * `#[unsafe(no_mangle)] pub extern "C"`, which already exports the symbols, so
 * dllexport here is only meaningful to non-Rust producers re-exporting them.
 */
#if defined(_WIN32) && !defined(APHRODY_STATIC)
#  if defined(APHRODY_BUILD)
#    define APHRODY_API __declspec(dllexport)
#  else
#    define APHRODY_API __declspec(dllimport)
#  endif
#elif defined(__GNUC__) || defined(__clang__)
#  define APHRODY_API __attribute__((visibility("default")))
#else
#  define APHRODY_API
#endif

/*
 * APHRODY_NODISCARD — warn when the return value (a status code or an owned
 * pointer) is dropped. Prefers the C23 / C++17 standard attribute, then the
 * GCC/Clang and MSVC vendor spellings.
 */
#if defined(__cplusplus) && __cplusplus >= 201703L
#  define APHRODY_NODISCARD [[nodiscard]]
#elif !defined(__cplusplus) && defined(__STDC_VERSION__) && __STDC_VERSION__ > 201710L
#  define APHRODY_NODISCARD [[nodiscard]] /* C23 */
#elif defined(__GNUC__) || defined(__clang__)
#  define APHRODY_NODISCARD __attribute__((warn_unused_result))
#elif defined(_MSC_VER)
#  define APHRODY_NODISCARD _Check_return_
#else
#  define APHRODY_NODISCARD
#endif

/*
 * APHRODY_NONNULL(...) — flag the listed (1-based) pointer parameters as
 * required-non-null for diagnostics. APHRODY_RETURNS_NONNULL marks a return
 * value that is never NULL. APHRODY_MALLOC marks a function returning fresh,
 * uniquely-owned, heap memory the caller must release. All degrade to nothing
 * on compilers without the attribute.
 */
#if defined(__GNUC__) || defined(__clang__)
#  define APHRODY_NONNULL(...) __attribute__((nonnull(__VA_ARGS__)))
#  define APHRODY_RETURNS_NONNULL __attribute__((returns_nonnull))
#  define APHRODY_MALLOC __attribute__((malloc))
#else
#  define APHRODY_NONNULL(...)
#  define APHRODY_RETURNS_NONNULL
#  define APHRODY_MALLOC
#endif

/* ======================================================================
 * yolo_* runtime ABI (major 1), implemented by crates/engine/yolo-runtime and
 * exported by this same library. Contract and ownership rules:
 * docs/architecture/runtime-native/RUNTIME-ABI.md. This section replaces the
 * former standalone yolo_runtime.h; YOLO_RUNTIME_H stays defined so a stale
 * copy of that header included next to this one is skipped.
 * ==================================================================== */
#ifndef YOLO_RUNTIME_H
#define YOLO_RUNTIME_H

#ifdef __cplusplus
extern "C" {
#endif

#define YOLO_ABI_MAJOR 1u
#define YOLO_ABI_MINOR 5u
#define YOLO_MAX_OPERATIONS_LIMIT 64u

/* Opaque handle owned by the library; 0 is never valid. */
typedef uint64_t YoloHandle;

typedef int32_t YoloStatus;
enum {
  YOLO_OK = 0,
  YOLO_INVALID_ARGUMENT = 1,
  YOLO_ABI_MISMATCH = 2,
  YOLO_INVALID_HANDLE = 3,
  YOLO_CANCELLED = 4,
  YOLO_TIMEOUT = 5,
  YOLO_BUSY = 6,
  YOLO_INTERNAL = 7,
  YOLO_PANIC = 8,
  YOLO_OUTPUT_LIMIT = 9
};

/* Buffer owned by the library: release it with yolo_buffer_free. */
typedef struct YoloBuffer {
  uint8_t *data;
  size_t len;
  size_t cap;
} YoloBuffer;

typedef struct YoloCreateInfo {
  uint32_t struct_size; /* sizeof(YoloCreateInfo) of the caller */
  uint32_t abi_major;   /* YOLO_ABI_MAJOR the caller was built for */
  uint32_t abi_minor;
  uint32_t max_operations; /* 0 = default */
} YoloCreateInfo;

/* (major << 16) | minor. Call first, refuse a different major. */
uint32_t yolo_abi_version(void);

YoloStatus yolo_runtime_create(const YoloCreateInfo *info, YoloHandle *out);
/* Cancels and joins every operation owned by the runtime, then invalidates it. */
YoloStatus yolo_runtime_destroy(YoloHandle runtime);

YoloStatus yolo_runtime_build_info(YoloBuffer *out);                      /* JSON object */
YoloStatus yolo_runtime_capabilities(YoloHandle runtime, YoloBuffer *out); /* JSON array */

/* capability "system.stats" */
YoloStatus yolo_system_stats(YoloHandle runtime, YoloBuffer *out); /* JSON object */

/* capability "bench.compute" */
YoloStatus yolo_bench_start(YoloHandle runtime, uint32_t iterations, YoloHandle *out_operation);
/* OK: JSON result in out. TIMEOUT: still running, handle stays valid. */
YoloStatus yolo_operation_wait(YoloHandle operation, uint32_t timeout_ms, YoloBuffer *out);
YoloStatus yolo_operation_cancel(YoloHandle operation);
/* Cancels if running, joins the worker, invalidates the handle. Required for every operation. */
YoloStatus yolo_operation_release(YoloHandle operation);

/* capability "process.supervise" (ABI 1.1): the child runs in its own process group */
#define YOLO_SPAWN_NULL_STDIO 1u /* YoloSpawnInfo.flags: stdin/stdout/stderr -> null device */
#define YOLO_SPAWN_CAPTURE 2u    /* flags (ABI 1.2): stdin null, stdout/stderr captured (last 64 KiB each) */
#define YOLO_SPAWN_CAPTURE_LOSSLESS 4u /* ABI 1.4: complete bytes, error on budget overflow */
#define YOLO_CAPTURE_MAX_BYTES 67108864u /* default/maximum per stream */
#define YOLO_STREAM_STDOUT 1u
#define YOLO_STREAM_STDERR 2u
#define YOLO_READ_DRAIN 0u
#define YOLO_READ_PEEK 1u

typedef struct YoloSpawnInfo {
  uint32_t struct_size; /* sizeof(YoloSpawnInfo) of the caller */
  uint32_t flags;
  const char *program;       /* UTF-8, NUL-terminated */
  const char *const *args;   /* NULL-terminated, without the program; may be NULL */
  const char *const *env;    /* NULL-terminated "KEY=VALUE" added to the environment; may be NULL */
  const char *cwd;           /* may be NULL */
} YoloSpawnInfo;

/* ABI 1.4 optional extension. Set base.struct_size = sizeof(YoloSpawnInfoV14), flag
 * YOLO_SPAWN_CAPTURE_LOSSLESS, then pass &info.base. Older 40-byte callers remain supported.
 * A zero capture_limit uses the default; otherwise 1..YOLO_CAPTURE_MAX_BYTES per stream. */
typedef struct YoloSpawnInfoV14 {
  YoloSpawnInfo base;
  uint64_t capture_limit;
} YoloSpawnInfoV14;

typedef struct YoloProcessStatus {
  uint32_t struct_size; /* sizeof(YoloProcessStatus) of the caller */
  uint32_t state;       /* 0 running, 1 exited */
  int32_t exit_code;    /* -1 if terminated by a signal */
  int32_t signal;       /* terminating signal (Unix), else 0 */
  uint32_t pid;
} YoloProcessStatus;

/* Counts against max_operations (BUSY beyond). */
YoloStatus yolo_process_spawn(YoloHandle runtime, const YoloSpawnInfo *info, YoloHandle *out);
YoloStatus yolo_process_status(YoloHandle process, YoloProcessStatus *out); /* non-blocking */
/* ABI 1.2: captured output of a YOLO_SPAWN_CAPTURE process, in a library-owned buffer (maybe empty). */
YoloStatus yolo_process_read(YoloHandle process, uint32_t stream, uint32_t mode, YoloBuffer *out);
/* ABI 1.4: 1 when both readers finished; read can still report OUTPUT_LIMIT or I/O failure. */
YoloStatus yolo_process_output_complete(YoloHandle process, uint32_t *out);
/* SIGTERM to the group, SIGKILL after grace_ms; waits. The handle stays valid (read the status). */
YoloStatus yolo_process_stop(YoloHandle process, uint32_t grace_ms);
/* ABI 1.3: asynchronous stop on a worker (not counted against max_operations). The operation yields
 * JSON {"exit_code": n, "signal": n}; release the operation as usual. */
YoloStatus yolo_process_stop_start(YoloHandle process, uint32_t grace_ms, YoloHandle *out_operation);
/* Stops if running (2 s grace) and invalidates the handle. Required for every process. */
YoloStatus yolo_process_release(YoloHandle process);

/* capability "http.probe": one HTTP/1.0 GET on a worker thread, never blocking the caller.
 * Counts against max_operations. yolo_operation_wait returns JSON {"status": <code>} when the
 * server answered, {"status": null, "error": "<why>"} when it is not reachable (yet). */
YoloStatus yolo_http_probe_start(YoloHandle runtime, const char *host, uint16_t port,
                                 const char *path, uint32_t timeout_ms, YoloHandle *out_operation);

/* Optional browser feature, ABI 1.4 extension. Probe browser.* capabilities before resolving
 * these symbols; default core artifacts do not export them. JSON requests are UTF-8 with explicit
 * byte lengths. Contexts own their browser thread; close/destroy interrupts and joins workers.
 * call_start yields an operation managed by the existing wait/cancel/release functions. */
YoloStatus yolo_browser_create(YoloHandle runtime, const uint8_t *input, size_t input_len, YoloHandle *out);
YoloStatus yolo_browser_call_start(YoloHandle browser, const uint8_t *input, size_t input_len, YoloHandle *out_operation);
YoloStatus yolo_browser_close(YoloHandle browser);

/* Optional GPU feature, ABI 1.5. Probe gpu.info / gpu.wgsl / gpu.cuda before resolving this symbol.
 * One process-wide device (NVIDIA discrete first) is shared with every other host of the process.
 * input: UTF-8 JSON {"op":"info"} | {"op":"wgsl","shader":"...","entryPoint":"main","workgroups":[x,y,z]}
 *        | {"op":"cuda","source":"...","kernel":"name","blockSize":0}, 1 byte..1 MiB.
 * data: job buffer (WGSL storage binding 0, or little-endian f32 for CUDA), 0..16 MiB, may be NULL
 * when data_len is 0. Both are copied before the call returns. The operation yields the JSON report
 * for info, or {"bytes":n,"data":"<base64>","elapsedMs":t} for jobs; GPU errors fail the operation. */
YoloStatus yolo_gpu_call_start(YoloHandle runtime, const uint8_t *input, size_t input_len,
                               const uint8_t *data, size_t data_len, YoloHandle *out_operation);

/* Buffers and errors */
void yolo_buffer_free(YoloBuffer *buffer); /* zeroes the buffer; no-op if already empty */
YoloStatus yolo_last_error(YoloBuffer *out); /* JSON {"message": "..."} of the calling thread */

/* High-throughput zero-copy vector math FFI */
double ffi_sum_squares(const double *ptr, size_t len);

#ifdef __cplusplus
}
#endif

#endif /* YOLO_RUNTIME_H */

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief FFI-layer status codes (sysexits.h-compatible subset).
 *
 * ::aphrody_run, ::aphrody_run_json and the `"code"` field of
 * ::aphrody_run_captured return the wrapped command's process exit code, which
 * is an ARBITRARY 8-bit value — NOT restricted to this enum. These named
 * constants document the codes the FFI layer itself injects when a call fails
 * before (or instead of) reaching the command:
 *  - #APHRODY_STATUS_OK on success,
 *  - #APHRODY_STATUS_USAGE for a malformed request (bad argv / bad JSON / bad
 *    UTF-8),
 *  - #APHRODY_STATUS_SOFTWARE if a Rust panic was caught at the boundary.
 *
 * The underlying type is `int32_t` so the enum is layout-compatible with the
 * `int` return values of the run functions.
 */
typedef enum AphrodyStatus {
    /** Success. */
    APHRODY_STATUS_OK = 0,
    /** Malformed request: invalid argv, JSON, or UTF-8 (sysexits EX_USAGE). */
    APHRODY_STATUS_USAGE = 64,
    /** Internal error: a Rust panic was caught (sysexits EX_SOFTWARE). */
    APHRODY_STATUS_SOFTWARE = 70
} AphrodyStatus;

/**
 * @brief Runtime ABI revision of the symbol set exported by this library.
 *
 * Compare against #APHRODY_ABI_VERSION to detect a header/library mismatch.
 *
 * @return The ABI revision (currently #APHRODY_ABI_VERSION).
 * @since ABI 1
 */
APHRODY_NODISCARD APHRODY_API uint32_t aphrody_abi_version(void);

/**
 * @brief The aphrody version string (e.g. `"0.1.0"`).
 *
 * @return A static, NUL-terminated UTF-8 string valid for the entire program
 *         lifetime. Owned by the library; never NULL.
 * @note Do NOT free the returned pointer.
 * @since ABI 1
 */
APHRODY_NODISCARD APHRODY_RETURNS_NONNULL APHRODY_API const char *aphrody_version(void);

/**
 * @brief Run a command with stdout/stderr inherited by the host process.
 *
 * @param argc Number of entries in @p argv. Negative values are rejected
 *             (#APHRODY_STATUS_USAGE).
 * @param argv Array of @p argc NUL-terminated UTF-8 strings, excluding the
 *             program name. May be NULL if and only if @p argc is 0. The
 *             pointers are only read for the duration of the call.
 * @return The command's process exit code, or #APHRODY_STATUS_USAGE /
 *         #APHRODY_STATUS_SOFTWARE on a boundary failure
 *         (see ::aphrody_last_error).
 * @since ABI 1
 */
APHRODY_NODISCARD APHRODY_API int aphrody_run(int argc, const char *const *argv);

/**
 * @brief Run a command whose arguments are a JSON array of strings.
 *
 * Ergonomic alternative to ::aphrody_run for hosts that marshal a JSON string
 * more easily than a `char **` (e.g. Bun). Output is inherited.
 *
 * @param args_json A NUL-terminated UTF-8 JSON array of strings, e.g.
 *                  `"[\"doctor\",\"--json\"]"`. NULL or empty is treated as
 *                  `[]`.
 * @return The command's process exit code, or #APHRODY_STATUS_USAGE /
 *         #APHRODY_STATUS_SOFTWARE on a boundary failure
 *         (see ::aphrody_last_error).
 * @since ABI 1
 */
APHRODY_NODISCARD APHRODY_API int aphrody_run_json(const char *args_json);

/**
 * @brief Run a command with stdout AND stderr captured in-process.
 *
 * @param args_json A NUL-terminated UTF-8 JSON array of strings (NULL or empty
 *                  is treated as `[]`), as for ::aphrody_run_json.
 * @return A newly-allocated, NUL-terminated JSON document of the shape
 *         `{"code":<int>,"stdout":"<text>","stderr":"<text>"}`, or NULL only on
 *         allocation/serialisation failure (cause in ::aphrody_last_error).
 * @warning The CALLER owns a non-NULL result and MUST release it with
 *          ::aphrody_string_free exactly once.
 * @since ABI 1
 */
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *aphrody_run_captured(const char *args_json);

/**
 * @brief Release a string previously returned by this library.
 *
 * Currently the only such string is the result of ::aphrody_run_captured.
 *
 * @param ptr A pointer this library returned and that has not already been
 *            freed, or NULL (a no-op).
 * @since ABI 1
 */
APHRODY_API void aphrody_string_free(char *ptr);

/**
 * @brief The last error recorded on the CURRENT thread.
 *
 * Errors are thread-local: this returns the most recent failure observed by a
 * library call on the calling thread.
 *
 * @return A static, NUL-terminated UTF-8 string, or NULL if no error has been
 *         recorded on this thread. Owned by the library.
 * @note The pointer is valid only until the next library call on this thread —
 *       copy it if you need to keep it. Do NOT free it.
 * @since ABI 1
 */
APHRODY_NODISCARD APHRODY_API const char *aphrody_last_error(void);

/* Web extraction and vector indexing share this native library.
 * Every returned char* below is owned by this library and must be freed with
 * aphrody_string_free or aphrody_web_free_string. */
APHRODY_API void aphrody_web_free_string(char *ptr);
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *aphrody_web_media_extract(const char *source, const char *base_url);
APHRODY_NODISCARD APHRODY_API uint64_t aphrody_web_media_resolve_submit(const char *embed_url, const char *options_json, uint32_t timeout_ms);

APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *aphrody_web_extract_main(const char *html, const char *url, const char *options_json);
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *aphrody_web_html_to_markdown(const char *html, const char *base_url);
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *aphrody_web_simhash64(const char *text);
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *aphrody_web_extract_title(const char *html);
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *aphrody_web_strip_tags(const char *html);
APHRODY_NODISCARD APHRODY_API void *aphrody_web_parse_html(const char *html);
APHRODY_API void aphrody_web_tree_destroy(void *tree);
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *aphrody_web_query_selector(void *tree, const char *selector);
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *aphrody_web_query_selector_all(void *tree, const char *selector);

/* Index handles are opaque u64 IDs. Return codes: 0 success, -1 error,
 * -2 unknown handle. String results are freed as above. */
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *aphrody_web_index_last_error(void);
APHRODY_NODISCARD APHRODY_API uint64_t aphrody_web_index_open(const char *path, uint32_t dim, const char *params_json, int32_t rebuild_if_corrupt);
APHRODY_NODISCARD APHRODY_API int64_t aphrody_web_index_len(uint64_t handle);
APHRODY_NODISCARD APHRODY_API uint32_t aphrody_web_index_dim(uint64_t handle);
APHRODY_NODISCARD APHRODY_API int32_t aphrody_web_index_add(uint64_t handle, uint64_t key, const float *vector, uint32_t dim);
APHRODY_NODISCARD APHRODY_API int32_t aphrody_web_index_add_batch(uint64_t handle, const uint64_t *keys, const float *flat, uint32_t count, uint32_t dim);
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *aphrody_web_index_search(uint64_t handle, const float *query, uint32_t dim, uint32_t k, uint32_t ef);
APHRODY_NODISCARD APHRODY_API int32_t aphrody_web_index_remove(uint64_t handle, uint64_t key);
APHRODY_NODISCARD APHRODY_API int32_t aphrody_web_index_save(uint64_t handle);
APHRODY_NODISCARD APHRODY_API int32_t aphrody_web_index_compact(uint64_t handle);
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *aphrody_web_index_stats(uint64_t handle);
APHRODY_NODISCARD APHRODY_API int32_t aphrody_web_index_close(uint64_t handle);


/* Asynchronous jobs share the same Tokio runtime as the Aphrody command
 * surface. Take returns NULL while pending and an owned JSON string when done. */
APHRODY_NODISCARD APHRODY_API uint64_t aphrody_web_job_completed_seq(void);
APHRODY_NODISCARD APHRODY_API uint32_t aphrody_web_job_pending_count(void);
APHRODY_NODISCARD APHRODY_API int32_t aphrody_web_job_status(uint64_t id);
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *aphrody_web_job_take(uint64_t id);
APHRODY_NODISCARD APHRODY_API int32_t aphrody_web_job_cancel(uint64_t id);
APHRODY_NODISCARD APHRODY_API uint64_t aphrody_web_embed_submit(const char *texts_json, const char *kind, uint32_t timeout_ms);
APHRODY_NODISCARD APHRODY_API uint64_t aphrody_web_rerank_submit(const char *query, const char *passages_json, uint32_t timeout_ms);
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *aphrody_web_embed_info(void);
APHRODY_NODISCARD APHRODY_API uint64_t aphrody_web_embed_install_submit(const char *model_id, uint32_t timeout_ms);


APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *aphrody_web_get_chromium_cookies(const char *user_data_path, const char *profile, const char *host_key);

APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *aphrody_web_obscura_fetch(const char *url, uint8_t stealth, uint32_t timeout_ms);
APHRODY_NODISCARD APHRODY_API uint64_t aphrody_web_obscura_fetch_submit(const char *url, uint8_t stealth, uint32_t timeout_ms);

/* Web ABI v5 and native network operations. */
APHRODY_NODISCARD APHRODY_API uint32_t aphrody_web_bridge_abi_version(void);
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *aphrody_web_dns_recon(const char *domain_ptr);
APHRODY_NODISCARD APHRODY_API uint64_t aphrody_web_dns_recon_submit(const char *domain_ptr, uint32_t timeout_ms);
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *aphrody_web_gemini_web_ask(const char *cookie_path_ptr, const char *prompt_ptr, const char *model_ptr);
APHRODY_NODISCARD APHRODY_API uint64_t aphrody_web_gemini_web_ask_submit(const char *cookie_path_ptr, const char *prompt_ptr, const char *model_ptr, uint32_t timeout_ms);
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *aphrody_web_x_user_by_screen_name(const char *auth_token_ptr, const char *ct0_ptr, const char *handle_ptr);
APHRODY_NODISCARD APHRODY_API uint64_t aphrody_web_x_user_by_screen_name_submit(const char *auth_token_ptr, const char *ct0_ptr, const char *handle_ptr, uint32_t timeout_ms);
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *aphrody_web_x_user_tweets(const char *auth_token_ptr, const char *ct0_ptr, const char *handle_ptr, uint32_t count);
APHRODY_NODISCARD APHRODY_API uint64_t aphrody_web_x_user_tweets_submit(const char *auth_token_ptr, const char *ct0_ptr, const char *handle_ptr, uint32_t count, uint32_t timeout_ms);
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *aphrody_web_x_community_by_rest_id(const char *auth_token_ptr, const char *ct0_ptr, const char *community_id_ptr);
APHRODY_NODISCARD APHRODY_API uint64_t aphrody_web_x_community_by_rest_id_submit(const char *auth_token_ptr, const char *ct0_ptr, const char *community_id_ptr, uint32_t timeout_ms);
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *aphrody_web_x_community_tweets(const char *auth_token_ptr, const char *ct0_ptr, const char *community_id_ptr, uint32_t count);
APHRODY_NODISCARD APHRODY_API uint64_t aphrody_web_x_community_tweets_submit(const char *auth_token_ptr, const char *ct0_ptr, const char *community_id_ptr, uint32_t count, uint32_t timeout_ms);
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *aphrody_web_x_community_info_and_tweets(const char *auth_token_ptr, const char *ct0_ptr, const char *community_id_ptr, uint32_t count);
APHRODY_NODISCARD APHRODY_API uint64_t aphrody_web_x_community_info_and_tweets_submit(const char *auth_token_ptr, const char *ct0_ptr, const char *community_id_ptr, uint32_t count, uint32_t timeout_ms);
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *aphrody_web_x_algorithm_rank(const char *candidates_json_ptr, const char *context_json_ptr, uint32_t top_k);

/* X native job API (Web ABI 5, src/web/x.rs). One generic JSON surface over the aphrody-x
 * operation table: the operation names, their arguments and the result envelope
 * {"ok","op","id","data"|"error","rate_limit","attempts","elapsed_ms"} are served by the "meta"
 * operation. A client handle keeps the session inside the library (the cookies cross once, or are
 * discovered as the CLI does). Job results are collected with aphrody_web_job_take; batch results
 * with aphrody_web_x_batch_poll. Returned strings are released with aphrody_string_free. */
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *aphrody_web_x_client_open(const char *session_json, const char *options_json);
APHRODY_NODISCARD APHRODY_API int32_t aphrody_web_x_client_close(uint64_t client);
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *aphrody_web_x_call(uint64_t client, const char *op, const char *args_json);
APHRODY_NODISCARD APHRODY_API uint64_t aphrody_web_x_submit(uint64_t client, const char *op, const char *args_json, const char *options_json);
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *aphrody_web_x_batch_submit(uint64_t client, const char *ops_json, const char *options_json);
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *aphrody_web_x_batch_poll(uint64_t batch, uint32_t max_items);
APHRODY_NODISCARD APHRODY_API int32_t aphrody_web_x_batch_cancel(uint64_t batch);

/* Web extraction and request helpers. Strings are NUL-terminated UTF-8; the
 * returned string is owned and released with aphrody_web_free_string. */
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *aphrody_web_extract_links(const char *html, const char *base_url);
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *aphrody_web_extract_text(const char *html);
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *aphrody_web_normalize_url(const char *url);
APHRODY_NODISCARD APHRODY_API uint64_t aphrody_web_http_request_submit(const char *request_ptr);

/* Zero-copy ABI (see src/zerocopy.rs). All memory is owned by the caller: the
 * library never allocates or frees. Document writers copy into `out` only when
 * it fits and always return the full document length (negative on error:
 * -1 invalid arguments, -3 caught panic), so a too-small `out`/`out_cap` (or
 * out == NULL) is a size query. Input and output ranges must not overlap. */
#define APHRODY_ZEROCOPY_OK 0
#define APHRODY_ZEROCOPY_INVALID (-1)
#define APHRODY_ZEROCOPY_PANIC (-3)
APHRODY_NODISCARD APHRODY_API uint32_t aphrody_zerocopy_abi_version(void);
APHRODY_NODISCARD APHRODY_API int64_t aphrody_toolcall_repair_json(const uint8_t *input, size_t input_len, uint8_t *out, size_t out_cap);
APHRODY_NODISCARD APHRODY_API int64_t aphrody_toolcall_validate_json(const uint8_t *args, size_t args_len, const uint8_t *schema, size_t schema_len, uint8_t *out, size_t out_cap);
/* Rasterize one triangle in place. px: width*height*4 RGBA bytes; zbuf:
 * width*height floats (4-byte aligned); verts: 9 floats (3 x xyz); uv: 6 floats
 * or NULL; tex: tex_w*tex_h*4 bytes or NULL (flat shading with base_rgb, 3
 * floats in 0..255, NULL = white). Returns 0, -1 or -3. */
APHRODY_NODISCARD APHRODY_API int32_t aphrody_raster_fill_triangle(uint8_t *px, float *zbuf, uint32_t width, uint32_t height, const float *verts, const float *uv, const uint8_t *tex, uint32_t tex_w, uint32_t tex_h, float shade, const float *base_rgb);

/* bun-rs exports (crates/ui/bun), re-exported by the same cdylib. Owned
 * strings are released with bun_rs_free_string; PNG buffers with
 * bun_rs_render_free(ptr, len). */
APHRODY_NODISCARD APHRODY_API const char *bun_rs_version(void);
APHRODY_NODISCARD APHRODY_API uint32_t bun_rs_abi_version(void);
APHRODY_NODISCARD APHRODY_API int32_t bun_rs_add(int32_t a, int32_t b);
APHRODY_NODISCARD APHRODY_API size_t bun_rs_count_char(const uint8_t *data, size_t len, uint8_t needle);
APHRODY_NODISCARD APHRODY_API ptrdiff_t bun_rs_find_bytes(const uint8_t *haystack, size_t haystack_len, const uint8_t *needle, size_t needle_len);
APHRODY_NODISCARD APHRODY_API uint32_t bun_rs_hct_to_argb(float hue, float chroma, float tone);
APHRODY_API void bun_rs_argb_to_hct(uint32_t argb, float *hue, float *chroma, float *tone);
APHRODY_API void bun_rs_hct_tones(float hue, float chroma, float tone, uint32_t *out_palette);
APHRODY_API void bun_rs_derive_scheme(float hue, float chroma, bool is_dark, uint32_t *out_colors);
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *bun_rs_m3_css(const uint8_t *request, size_t len);
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *bun_rs_compile_sass(const uint8_t *source, size_t len, const uint8_t *load_paths, size_t load_paths_len, int32_t style_val, bool quiet, bool *error_occurred);
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *bun_rs_compile_sass_file(const uint8_t *path, size_t len, const uint8_t *load_paths, size_t load_paths_len, int32_t style_val, bool quiet, bool *error_occurred);
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *bun_rs_validate_spec(const uint8_t *source, size_t len);
APHRODY_API void bun_rs_free_string(char *ptr);
APHRODY_NODISCARD APHRODY_API uint8_t *bun_rs_render_png(const uint8_t *scene_json, size_t len, size_t *out_len);
APHRODY_NODISCARD APHRODY_API uint8_t *bun_rs_render3d_png(const uint8_t *scene_json, size_t len, uint32_t policy, size_t *out_len);
APHRODY_API void bun_rs_render_free(uint8_t *ptr, size_t len);
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *bun_rs_m3_reproduce(uint8_t kind, const uint8_t *input, size_t len);
APHRODY_NODISCARD APHRODY_API uint32_t bun_rs_m3_seed_from_image(const uint8_t *image, size_t len);
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *bun_rs_svg(const uint8_t *request, size_t len);
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *bun_rs_icon_svg(const uint8_t *request, size_t len);
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *bun_rs_icon_names(const uint8_t *style, size_t len);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* APHRODY_H */
