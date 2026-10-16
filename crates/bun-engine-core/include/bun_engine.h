#ifndef BUN_ENGINE_H
#define BUN_ENGINE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct bun_engine_binary_info {
  uint32_t abi_version;
  uint32_t format;
  uint32_t family;
  uint32_t architecture;
  uint8_t bits;
  uint8_t endianness;
} bun_engine_binary_info;

uint32_t bun_engine_abi_version(void);
int32_t bun_engine_inspect(const uint8_t *data, size_t length, bun_engine_binary_info *output);

#ifdef __cplusplus
}
#endif

#endif
