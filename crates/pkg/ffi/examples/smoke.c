/* SPDX-License-Identifier: Apache-2.0 */
#include "aphrody_pkg.h"
#include <stdio.h>
#include <string.h>
int main(int argc, char **argv) {
  if (argc != 2 || aphrody_pkg_abi_version() != APHRODY_PKG_ABI_VERSION) return 1;
  uint64_t store = 0, result = 0, count = 0, size = 0;
  const uint8_t data[] = "ffi-package";
  int status = aphrody_pkg_store_open((const uint8_t*)argv[1], strlen(argv[1]), &store);
  if (status) return status;
  status = aphrody_pkg_store_put(store, data, sizeof(data)-1, NULL, 0, &result);
  uint8_t digest[64];
  if (!status) status = aphrody_pkg_buffer_copy(result, digest, sizeof(digest));
  if (!status) status = aphrody_pkg_store_verify(store, digest, sizeof(digest));
  if (!status) status = aphrody_pkg_store_stats(store, &count, &size);
  if (!status) printf("%.*s blobs=%llu bytes=%llu\n", 64, digest, (unsigned long long)count, (unsigned long long)size);
  if (result) aphrody_pkg_release(result);
  aphrody_pkg_release(store);
  return status;
}
