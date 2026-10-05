/* SPDX-License-Identifier: MIT */
#ifndef YOLO_TOOLING_H
#define YOLO_TOOLING_H

#include <stddef.h>
#include <stdint.h>

#if defined(_WIN32)
#define YOLO_TOOLING_API __declspec(dllimport)
#else
#define YOLO_TOOLING_API
#endif

#define YOLO_TOOLING_ABI_VERSION 1u
#define APHRODY_N2B_ABI_VERSION 2u
#define APHRODY_OXC_ABI_VERSION 1u

#ifdef __cplusplus
extern "C" {
#endif

YOLO_TOOLING_API uint32_t yolo_tooling_abi_version(void);
YOLO_TOOLING_API uint32_t node2bun_abi_version(void);
YOLO_TOOLING_API uint32_t aphrody_oxc_abi_version(void);

/* NUL-terminated UTF-8 inputs. Check scan is read-only. Options accept
 * mode(check/fix/aggressive), ignore(string array), dry_run(bool), jobs(1..6).
 * Fix/aggressive can write files unless dry_run=true. Each JSON envelope is
 * owned and must be freed exactly once by node2bun_string_free. */
YOLO_TOOLING_API char *node2bun_scan_json(const char *root);
YOLO_TOOLING_API char *node2bun_scan_with_options_json(const char *root, const char *options_json);
YOLO_TOOLING_API void node2bun_string_free(char *pointer);

/* UTF-16LE buffer; aligned uint32_t output slots. Returns total newline count,
 * even for count-only/null-output calls or an output capacity smaller than count. */
YOLO_TOOLING_API size_t find_newlines_u16(const uint8_t *buf, size_t byte_len, uint32_t *out, size_t out_cap);

/* Synchronous JS/TS source operations. Filename selects syntax. Each JSON
 * envelope is owned and must be freed exactly once by aphrody_oxc_free. */
YOLO_TOOLING_API char *aphrody_oxc_format(const char *source, const char *filename);
YOLO_TOOLING_API char *aphrody_oxc_minify(const char *source, const char *filename);
YOLO_TOOLING_API char *aphrody_oxc_lint(const char *source, const char *filename);
/* Success has result: module metadata or official ESTree JSON; spans are UTF-16.
 * Parser/semantic failures have kind=syntax. Release with aphrody_oxc_free. */
YOLO_TOOLING_API char *aphrody_oxc_analyze(const char *source, const char *filename);
YOLO_TOOLING_API char *aphrody_oxc_parse(const char *source, const char *filename);
YOLO_TOOLING_API void aphrody_oxc_free(char *pointer);

#ifdef __cplusplus
}
#endif
#endif /* YOLO_TOOLING_H */
