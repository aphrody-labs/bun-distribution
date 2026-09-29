import { describe, expect, test } from "bun:test";
import { FFIType, suffix } from "bun:ffi";
import { IECODE_FFI_SYMBOLS, FFI_SCHEMA, resolveLibraryPath } from "../src/index";

describe("iecode FFI contract", () => {
  test("uses the explicit loader override", () => {
    const previous = Bun.env.IECODE_FFI_LIBRARY;
    Bun.env.IECODE_FFI_LIBRARY = "custom-iecode-ffi";
    expect(resolveLibraryPath()).toBe("custom-iecode-ffi");
    if (previous === undefined) delete Bun.env.IECODE_FFI_LIBRARY;
    else Bun.env.IECODE_FFI_LIBRARY = previous;
  });

  test("uses Cargo cdylib filenames when no override is configured", () => {
    const previous = Bun.env.IECODE_FFI_LIBRARY;
    delete Bun.env.IECODE_FFI_LIBRARY;
    const expected =
      process.platform === "win32" ? `iecode_ffi.${suffix}` : `libiecode_ffi.${suffix}`;
    expect(resolveLibraryPath()).toBe(expected);
    if (previous !== undefined) Bun.env.IECODE_FFI_LIBRARY = previous;
  });

  test("matches the Rust ABI symbol names and signatures", () => {
    expect(Object.keys(IECODE_FFI_SYMBOLS).sort()).toEqual([
      "iecode_bytes_free_fields",
      "iecode_core_version",
      "iecode_emu_registry_json_out",
      "iecode_ffi_free",
      "iecode_ffi_schema",
      "iecode_pipeline_validate_json",
    ]);
    expect(IECODE_FFI_SYMBOLS.iecode_core_version).toEqual({
      args: [],
      returns: FFIType.cstring,
    });
    expect(IECODE_FFI_SYMBOLS.iecode_pipeline_validate_json).toEqual({
      args: [FFIType.ptr, FFIType.u64, FFIType.ptr],
      returns: FFIType.i32,
    });
    expect(IECODE_FFI_SYMBOLS.iecode_bytes_free_fields).toEqual({
      args: [FFIType.ptr, FFIType.u64, FFIType.u64],
      returns: FFIType.void,
    });
  });

  test("publishes one schema identifier", () => {
    expect(FFI_SCHEMA).toBe("iecode.ffi/v1");
  });
});
