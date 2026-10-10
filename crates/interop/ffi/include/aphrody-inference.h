/* SPDX-License-Identifier: Apache-2.0 */
#ifndef APHRODY_INFERENCE_H
#define APHRODY_INFERENCE_H

#include "aphrody.h"

#define APHRODY_INFERENCE_ABI_VERSION 1u

#ifdef __cplusplus
extern "C" {
#endif

/* Asynchronous in-process inference (cargo feature `inference` of aphrody-ffi).
 * Requests are JSON (operation open/chat/close). submit returns an owned JSON
 * envelope ({"job":id} or {"error":..}); poll returns {"pending":true}, a result
 * or an error. Release every returned string exactly once with aphrody_inference_free. */
APHRODY_NODISCARD APHRODY_API uint32_t aphrody_inference_abi_version(void);
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *aphrody_inference_submit(const uint8_t *input, uint32_t length);
APHRODY_NODISCARD APHRODY_MALLOC APHRODY_API char *aphrody_inference_poll(uint64_t id);
APHRODY_API void aphrody_inference_cancel(uint64_t id);
APHRODY_API void aphrody_inference_free(char *value);

#ifdef __cplusplus
}
#endif

#endif
