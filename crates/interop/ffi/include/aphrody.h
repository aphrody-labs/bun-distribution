/* SPDX-License-Identifier: Apache-2.0 */
/**
 * @file aphrody.h
 * @brief C ABI for the aphrody native library (crate `aphrody-ffi`).
 *
 * Exposes the ENTIRE aphrody command surface in-process. Link against the
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

/* yolo_* runtime ABI (versioned, owned by crates/engine/yolo-runtime). */
#include "../../../engine/yolo-runtime/include/yolo_runtime.h"

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
