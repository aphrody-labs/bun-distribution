// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { peExports, runtimeCapabilities } from "./runtime-artifact-info.ts";

const target = "x86_64-pc-windows-msvc";
const header = readFileSync(
  new URL("../../../crates/aphrody-ffi/include/aphrody.h", import.meta.url),
  "utf8",
);
const core = [
  ...new Set(header.match(/\b(?:yolo_[a-z0-9_]+|ffi_sum_squares)(?=\()/g) ?? []),
].filter((name) => !name.startsWith("yolo_browser_") && name !== "yolo_gpu_call_start");

function dll(names: string[]) {
  const bytes = new Uint8Array(8192);
  const view = new DataView(bytes.buffer);
  const u16 = (offset: number, value: number) => view.setUint16(offset, value, true);
  const u32 = (offset: number, value: number) => view.setUint32(offset, value, true);
  u16(0, 0x5a4d);
  u32(0x3c, 0x80);
  u32(0x80, 0x4550);
  u16(0x84, 0x8664);
  u16(0x86, 1);
  u16(0x94, 240);
  u16(0x96, 0x2000);
  const optional = 0x98;
  u16(optional, 0x20b);
  u32(optional + 108, 16);
  u32(optional + 112, 0x1000);
  u32(optional + 116, 0x500);
  const section = optional + 240;
  u32(section + 12, 0x1000);
  u32(section + 16, 0x1800);
  u32(section + 20, 0x200);
  const directory = 0x200;
  u32(directory + 20, names.length);
  u32(directory + 24, names.length);
  u32(directory + 28, 0x1040);
  u32(directory + 32, 0x1140);
  u32(directory + 36, 0x1240);
  let cursor = 0x800;
  for (let i = 0; i < names.length; i++) {
    u32(0x240 + i * 4, 0x1700 + i);
    u32(0x340 + i * 4, cursor + 0xe00);
    u16(0x440 + i * 2, i);
    const encoded = new TextEncoder().encode(names[i]!);
    bytes.set(encoded, cursor);
    cursor += encoded.length + 1;
  }
  return { bytes, u16, u32 };
}

describe("cross-target runtime PE qualification", () => {
  test("packages a core DLL without requiring optional browser/GPU exports", () => {
    const image = dll(core);
    expect(runtimeCapabilities(peExports(image.bytes, target), header)).toEqual([
      "system.stats",
      "bench.compute",
      "process.supervise",
      "http.probe",
    ]);
  });
  test("incidental symbol strings cannot satisfy missing exports", () => {
    const image = dll(core.filter((name) => name !== "yolo_abi_version"));
    image.bytes.set(new TextEncoder().encode("yolo_abi_version"), 0x1900);
    expect(() => runtimeCapabilities(peExports(image.bytes, target), header)).toThrow(
      "yolo_abi_version",
    );
  });
  test("complete browser exports enable browser capabilities", () => {
    const image = dll([
      ...core,
      "yolo_browser_create",
      "yolo_browser_call_start",
      "yolo_browser_close",
    ]);
    expect(runtimeCapabilities(peExports(image.bytes, target), header)).toContain(
      "browser.contexts",
    );
  });
  test("partial browser providers fail", () => {
    expect(() =>
      runtimeCapabilities(peExports(dll([...core, "yolo_browser_create"]).bytes, target), header),
    ).toThrow("Incomplete browser");
  });
  test("one GPU export does not falsely promise CUDA", () => {
    expect(
      runtimeCapabilities(peExports(dll([...core, "yolo_gpu_call_start"]).bytes, target), header),
    ).not.toContain("gpu.cuda");
  });
  test("rejects architecture mismatch and unsupported target", () => {
    const image = dll(core);
    expect(() => peExports(image.bytes, "aarch64-pc-windows-msvc")).toThrow("machine");
    expect(() => peExports(image.bytes, "aarch64-apple-darwin")).toThrow("Unsupported");
  });
  test("rejects executables and corrupted signatures", () => {
    const image = dll(core);
    image.u16(0x96, 0);
    expect(() => peExports(image.bytes, target)).toThrow("not a DLL");
    image.u32(0x80, 0);
    expect(() => peExports(image.bytes, target)).toThrow("signature");
  });
  test("rejects truncation, unbacked RVAs, bad ordinals and forwarders", () => {
    expect(() => peExports(new Uint8Array(10), target)).toThrow("Truncated");
    const rva = dll(core);
    rva.u32(0x340, 0xfffffffe);
    expect(() => peExports(rva.bytes, target)).toThrow("RVA");
    const ordinal = dll(core);
    ordinal.u16(0x440, core.length);
    expect(() => peExports(ordinal.bytes, target)).toThrow("ordinal");
    const forward = dll(core);
    forward.u32(0x240, 0x1100);
    expect(() => peExports(forward.bytes, target)).toThrow("Forwarded");
  });
});
