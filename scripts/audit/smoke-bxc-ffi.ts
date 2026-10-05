// SPDX-License-Identifier: Apache-2.0
import { dlopen, FFIType } from "bun:ffi";

const path = process.argv[2];
if (!path) throw new Error("usage: bun smoke-bxc-ffi.ts libaphrody_web_ffi.so");
const library = dlopen(path, {
	bxc_bridge_abi_version: { args: [], returns: FFIType.u32 },
});
try {
	const abi = library.symbols.bxc_bridge_abi_version();
	if (abi !== 3) throw new Error(`BXC FFI ABI mismatch: ${abi}`);
	console.log("BXC FFI load and ABI 3: ok");
} finally {
	library.close();
}
