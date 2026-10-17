export interface MaterialWasmExports extends WebAssembly.Exports {
  m3_abi_version: () => number;
  m3_color_count: () => number;
  m3_variant_count: () => number;
  m3_role_name_byte: (role: number, offset: number) => number;
  m3_variant_name_byte: (variant: number, offset: number) => number;
  m3_seed_color: (seed: number, variant: number, contrast: number, mode: number, role: number) => number;
  m3_color: (mode: number, role: number) => number;
  m3_type_size: (role: number) => number;
  m3_shape_radius: (role: number) => number;
  m3_application_navigation: (family: number, width: number) => number;
}

/** Load the portable M3 contract in a browser or any WebAssembly host. */
export async function loadMaterialWasm(bytes: BufferSource) {
  const module = await WebAssembly.compile(bytes);
  const instance = await WebAssembly.instantiate(module, {});
  const exports = instance.exports as MaterialWasmExports;
  for (const name of [
    "m3_abi_version",
    "m3_color_count",
    "m3_variant_count",
    "m3_role_name_byte",
    "m3_variant_name_byte",
    "m3_seed_color",
    "m3_color",
    "m3_type_size",
    "m3_shape_radius",
    "m3_application_navigation",
  ]) {
    if (typeof exports[name] !== "function") throw new Error(`Missing Material WASM export ${name}`);
  }
  if (exports.m3_abi_version() !== 2 || exports.m3_color_count() !== 49 || exports.m3_variant_count() !== 9)
    throw new Error("Unsupported Material WASM contract");
  const name = (read: (index: number, offset: number) => number, index: number) => {
    const bytes: number[] = [];
    for (let offset = 0; offset < 64; offset++) {
      const byte = read(index, offset);
      if (byte === 0) return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
      if (!Number.isInteger(byte) || byte < 1 || byte > 255) throw new Error("Invalid native Material name");
      bytes.push(byte);
    }
    throw new Error("Native Material name exceeds its bound");
  };
  const roleNames = Object.freeze(
    Array.from({ length: exports.m3_color_count() }, (_, index) => name(exports.m3_role_name_byte, index)),
  );
  const variantNames = Object.freeze(
    Array.from({ length: exports.m3_variant_count() }, (_, index) => name(exports.m3_variant_name_byte, index)),
  );
  return {
    exports,
    roleNames,
    variantNames,
    seedColor(seed: number, variant: number, contrast: number, mode: "light" | "dark", role: number) {
      if (
        (mode !== "light" && mode !== "dark") ||
        !Number.isInteger(seed) ||
        seed < 0xff000000 ||
        seed > 0xffffffff ||
        !Number.isInteger(variant) ||
        variant < 0 ||
        variant >= exports.m3_variant_count() ||
        !Number.isFinite(contrast) ||
        contrast < -1 ||
        contrast > 1 ||
        !Number.isInteger(role) ||
        role < 0 ||
        role >= exports.m3_color_count()
      )
        throw new RangeError("Invalid native Material theme request");
      return exports.m3_seed_color(seed, variant, contrast, mode === "light" ? 0 : 1, role) >>> 0;
    },
    color(mode: "light" | "dark", role: number) {
      if (mode !== "light" && mode !== "dark") throw new RangeError("Invalid Material theme mode");
      if (!Number.isInteger(role) || role < 0 || role >= 49) throw new RangeError("Material color role must be 0..48");
      return exports.m3_color(mode === "light" ? 0 : 1, role) >>> 0;
    },
    navigation(family: number, width: number) {
      if (
        !Number.isInteger(family) ||
        family < 0 ||
        family >= 15 ||
        !Number.isInteger(width) ||
        width < 0 ||
        width > 0xffffffff
      )
        throw new RangeError("Material application family or window width is invalid");
      return exports.m3_application_navigation(family, width) >>> 0;
    },
  };
}
