// SPDX-License-Identifier: Apache-2.0
#include "aphrody_pkg.h"
#include <array>
#include <cstring>
#include <iostream>
#include <stdexcept>
#include <string>
struct Handle {
  uint64_t id = 0;
  Handle() = default;
  Handle(const Handle&) = delete;
  Handle& operator=(const Handle&) = delete;
  ~Handle() { if (id) aphrody_pkg_release(id); }
};
static void check(int status) { if(status) throw std::runtime_error("package ABI status " + std::to_string(status)); }
int main(int argc, char **argv) {
  try {
    if (argc != 2 || aphrody_pkg_abi_version() != APHRODY_PKG_ABI_VERSION) return 1;
    Handle store, digest;
    check(aphrody_pkg_store_open(reinterpret_cast<const uint8_t*>(argv[1]), std::strlen(argv[1]), &store.id));
    constexpr char value[] = "ffi-package";
    check(aphrody_pkg_store_put(store.id, reinterpret_cast<const uint8_t*>(value), sizeof(value)-1, nullptr, 0, &digest.id));
    std::array<uint8_t,64> bytes{};
    check(aphrody_pkg_buffer_copy(digest.id, bytes.data(), bytes.size()));
    check(aphrody_pkg_store_verify(store.id, bytes.data(), bytes.size()));
    std::cout.write(reinterpret_cast<const char*>(bytes.data()), bytes.size());
    std::cout << '\n';
    return 0;
  } catch(const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
