// SPDX-License-Identifier: Apache-2.0
/** Read PE exports without loading a foreign DLL or treating incidental strings as exports. */
export function peExports(bytes: Uint8Array, target: string): ReadonlySet<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bounds = (offset: number, size: number) => {
    if (!Number.isSafeInteger(offset) || offset < 0 || size < 0 || offset + size > bytes.length)
      throw new Error("Truncated PE image");
  };
  const u16 = (offset: number) => {
    bounds(offset, 2);
    return view.getUint16(offset, true);
  };
  const u32 = (offset: number) => {
    bounds(offset, 4);
    return view.getUint32(offset, true);
  };
  bounds(0, 64);
  if (u16(0) !== 0x5a4d) throw new Error("Not a PE image");
  const pe = u32(0x3c);
  if (u32(pe) !== 0x4550) throw new Error("Invalid PE signature");
  const machine = u16(pe + 4);
  const expected =
    target === "x86_64-pc-windows-msvc"
      ? 0x8664
      : target === "aarch64-pc-windows-msvc"
        ? 0xaa64
        : undefined;
  if (expected === undefined) throw new Error(`Unsupported cross-package target ${target}`);
  if (machine !== expected) throw new Error(`PE machine does not match ${target}`);
  if ((u16(pe + 22) & 0x2000) === 0) throw new Error("PE image is not a DLL");
  const count = u16(pe + 6);
  const optionalSize = u16(pe + 20);
  const optional = pe + 24;
  bounds(optional, optionalSize);
  if (optionalSize < 120 || u16(optional) !== 0x20b)
    throw new Error("Expected PE32+ optional header");
  if (u32(optional + 108) < 1) throw new Error("PE image has no export directory");
  const exportRva = u32(optional + 112);
  const exportSize = u32(optional + 116);
  if (!exportRva || exportSize < 40) throw new Error("PE image has no exports");
  const sections = optional + optionalSize;
  bounds(sections, count * 40);
  const rva = (address: number, size: number) => {
    for (let i = 0; i < count; i++) {
      const section = sections + i * 40;
      const start = u32(section + 12);
      const rawSize = u32(section + 16);
      const delta = address - start;
      if (delta >= 0 && delta + size <= rawSize) {
        const offset = u32(section + 20) + delta;
        bounds(offset, size);
        return offset;
      }
    }
    throw new Error("PE RVA is outside backed section data");
  };
  const directory = rva(exportRva, 40);
  const functionsCount = u32(directory + 20);
  const namesCount = u32(directory + 24);
  if (namesCount > functionsCount || namesCount > bytes.length / 4)
    throw new Error("Invalid PE export count");
  const functions = rva(u32(directory + 28), functionsCount * 4);
  const names = rva(u32(directory + 32), namesCount * 4);
  const ordinals = rva(u32(directory + 36), namesCount * 2);
  const exports = new Set<string>();
  for (let i = 0; i < namesCount; i++) {
    const ordinal = u16(ordinals + i * 2);
    if (ordinal >= functionsCount) throw new Error("Invalid PE export ordinal");
    const functionRva = u32(functions + ordinal * 4);
    if (!functionRva) throw new Error("Null PE exported function");
    // Forwarded exports are not implementations of the ABI in this runtime library.
    if (functionRva >= exportRva && functionRva < exportRva + exportSize)
      throw new Error("Forwarded runtime exports are unsupported");
    rva(functionRva, 1);
    const nameOffset = rva(u32(names + i * 4), 1);
    let length = 0;
    while (length < 256 && nameOffset + length < bytes.length && bytes[nameOffset + length] !== 0) {
      rva(u32(names + i * 4), length + 1);
      length++;
    }
    if (!length || length === 256 || bytes[nameOffset + length] !== 0)
      throw new Error("Invalid PE export name");
    const name = new TextDecoder().decode(bytes.subarray(nameOffset, nameOffset + length));
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error("Invalid PE export name");
    if (exports.has(name)) throw new Error("Duplicate PE export name");
    exports.add(name);
  }
  return exports;
}

/** Only mandatory core exports are required; optional capability families must be complete. */
export function runtimeCapabilities(exports: ReadonlySet<string>, header: string): string[] {
  const browser = ["yolo_browser_create", "yolo_browser_call_start", "yolo_browser_close"];
  const gpu = ["yolo_gpu_call_start"];
  const optional = new Set([...browser, ...gpu]);
  const required = new Set(header.match(/\b(?:yolo_[a-z0-9_]+|ffi_sum_squares)(?=\()/g) ?? []);
  if (!required.has("yolo_abi_version")) throw new Error("Runtime header has no ABI declarations");
  for (const symbol of required) {
    if (!optional.has(symbol) && !exports.has(symbol))
      throw new Error(`Runtime DLL does not export ${symbol}`);
  }
  const capabilities = ["system.stats", "bench.compute", "process.supervise", "http.probe"];
  const foundBrowser = browser.filter((symbol) => exports.has(symbol)).length;
  if (foundBrowser > 0 && foundBrowser !== browser.length)
    throw new Error("Incomplete browser exports");
  if (foundBrowser)
    capabilities.push("browser.navigate", "browser.dom", "browser.capture", "browser.contexts");
  // GPU/CUDA capability negotiation requires executing the actual provider; a shared export
  // does not distinguish supported GPU backends. Cross-package manifests claim only core/browser.
  return capabilities;
}
