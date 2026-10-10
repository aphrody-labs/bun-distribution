# SPDX-License-Identifier: Apache-2.0
"""python smoke.py <native-library> <explicit-test-store>"""
import ctypes as c
import sys

lib = c.CDLL(sys.argv[1])
u64, size, ptr = c.c_uint64, c.c_size_t, c.c_void_p
signatures = {
    "abi_version": (c.c_uint32, []),
    "store_open": (c.c_int32, [ptr, size, c.POINTER(u64)]),
    "store_put": (c.c_int32, [u64, ptr, size, ptr, size, c.POINTER(u64)]),
    "store_verify": (c.c_int32, [u64, ptr, size]),
    "store_stats": (c.c_int32, [u64, c.POINTER(u64), c.POINTER(u64)]),
    "buffer_copy": (c.c_int32, [u64, ptr, size]),
    "release": (c.c_int32, [u64]),
}
for name, (restype, argtypes) in signatures.items():
    fn = getattr(lib, "aphrody_pkg_" + name)
    fn.restype, fn.argtypes = restype, argtypes

def check(status):
    if status:
        raise RuntimeError(f"package ABI status {status}")

if lib.aphrody_pkg_abi_version() != 1:
    raise RuntimeError("unsupported package ABI")
root = sys.argv[2].encode("utf-8")
store, result, count, length = u64(), u64(), u64(), u64()
check(lib.aphrody_pkg_store_open(root, len(root), c.byref(store)))
try:
    data = b"ffi-package"
    check(lib.aphrody_pkg_store_put(store, data, len(data), None, 0, c.byref(result)))
    try:
        digest = c.create_string_buffer(64)
        check(lib.aphrody_pkg_buffer_copy(result, digest, 64))
        check(lib.aphrody_pkg_store_verify(store, digest, 64))
        check(lib.aphrody_pkg_store_stats(store, c.byref(count), c.byref(length)))
        print(digest.raw.decode("ascii"), count.value, length.value)
    finally:
        check(lib.aphrody_pkg_release(result))
finally:
    check(lib.aphrody_pkg_release(store))
