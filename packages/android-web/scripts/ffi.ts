import { dlopen, FFIType, suffix } from "bun:ffi";
import { resolve } from "node:path";

export function loadAndroidNative() {
  const target = resolve(import.meta.dir, "../../../target/rust");
  const library =
    process.env.ANDROID_NATIVE_LIB ??
    resolve(target, "debug", `${process.platform === "win32" ? "" : "lib"}android_native.${suffix}`);
  return dlopen(library, {
    android_add: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  });
}

if (import.meta.main) {
  const library = loadAndroidNative();
  try {
    const result = library.symbols.android_add(17, 25);
    if (result !== 42) throw new Error(`Native FFI returned ${result}, expected 42`);
    console.log(
      JSON.stringify({
        runtime: Bun.version,
        revision: Bun.revision,
        ffi: "android_add",
        result,
      }),
    );
  } finally {
    library.close();
  }
}
