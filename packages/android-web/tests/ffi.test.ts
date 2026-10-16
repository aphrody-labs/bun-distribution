import { test, expect } from "bun:test";
import { loadAndroidNative } from "../scripts/ffi";

test("real Rust DLL exposes the Android C ABI to Bun FFI", () => {
  const library = loadAndroidNative();
  try {
    expect(library.symbols.android_add(17, 25)).toBe(42);
    expect(library.symbols.android_add(-12, 5)).toBe(-7);
    expect(library.symbols.android_add(0, 0)).toBe(0);
  } finally {
    library.close();
  }
});
