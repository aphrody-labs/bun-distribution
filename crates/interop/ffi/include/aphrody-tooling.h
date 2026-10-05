/* SPDX-License-Identifier: Apache-2.0 */
#ifndef APHRODY_TOOLING_H
#define APHRODY_TOOLING_H

#include "aphrody.h"

#define YOLO_TOOLING_ABI_VERSION 1u
#define APHRODY_N2B_ABI_VERSION 2u
#define APHRODY_OXC_ABI_VERSION 1u

#ifdef __cplusplus
extern "C" {
#endif

/* Grouped tooling provider ABI (cargo feature `tooling`). */
APHRODY_NODISCARD APHRODY_API uint32_t yolo_tooling_abi_version(void);

/* N2B report schema 2. Inputs are NUL-terminated UTF-8 strings.
 * A null root yields an owned JSON error. Null options select check mode.
 * Options accept mode (check/fix/aggressive), ignore (string array), dry_run.
 * Fix/aggressive can write files unless dry_run is true.
 * Release each returned string exactly once with node2bun_string_free. */
APHRODY_NODISCARD APHRODY_API uint32_t node2bun_abi_version(void);
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *node2bun_scan_json(const char *root);
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *node2bun_scan_with_options_json(const char *root, const char *options_json);
APHRODY_API void node2bun_string_free(char *pointer);

/* Find newline offsets in UTF-16LE code units. Returns the total count, even
 * if out_cap is smaller; buf and out may be null for empty/count-only calls.
 * byte_len covers valid input bytes; out covers out_cap aligned uint32_t slots. */
APHRODY_NODISCARD APHRODY_API size_t find_newlines_u16(const uint8_t *buf, size_t byte_len, uint32_t *out, size_t out_cap);

/* Synchronous Oxc operations. Inputs are NUL-terminated UTF-8 strings; the
 * filename extension selects syntax. Results are owned JSON success/error
 * envelopes. Release each exactly once with aphrody_oxc_free (null accepted). */
APHRODY_NODISCARD APHRODY_API uint32_t aphrody_oxc_abi_version(void);
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *aphrody_oxc_format(const char *source, const char *filename);
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *aphrody_oxc_minify(const char *source, const char *filename);
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *aphrody_oxc_lint(const char *source, const char *filename);
/* Semantic analysis, and the official Oxc ESTree program (span positions are UTF-16 code units). */
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *aphrody_oxc_analyze(const char *source, const char *filename);
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *aphrody_oxc_parse(const char *source, const char *filename);
APHRODY_API void aphrody_oxc_free(char *pointer);

#ifdef __cplusplus
}
#endif
#endif /* APHRODY_TOOLING_H */
