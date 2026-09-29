#ifndef NIE_EMU_ADAPTER_H
#define NIE_EMU_ADAPTER_H

#include <stddef.h>
#include <stdint.h>

typedef enum {
    NIE_EMU_OK = 0,
    NIE_EMU_INVALID_REQUEST = 1,
    NIE_EMU_UNSUPPORTED = 2,
    NIE_EMU_FORMAT_ERROR = 3,
    NIE_EMU_DEPENDENCY_UNAVAILABLE = 4
} iecode_emu_status;

typedef struct { uint8_t *data; size_t len; } iecode_emu_buffer;

iecode_emu_status iecode_emu_adapter_capabilities_json(
    const char *adapter_id, size_t adapter_id_len, iecode_emu_buffer *out);
iecode_emu_status iecode_emu_adapter_call_json(
    const uint8_t *request, size_t request_len, iecode_emu_buffer *out);
void iecode_emu_buffer_free(iecode_emu_buffer buffer);

/* Returns 0 for a valid pipeline, 3 for malformed JSON, 4 for contract failure. */
int32_t iecode_pipeline_validate_json(
    const uint8_t *input, size_t input_len, iecode_emu_buffer *out);

#endif
