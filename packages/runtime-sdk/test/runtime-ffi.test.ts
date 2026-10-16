import { describe, expect, it } from "bun:test";
import { ptr, suffix } from "bun:ffi";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defaultLibraryPath, libraryFile, Runtime, SYMBOLS } from "../src/index.ts";
import { hostTarget } from "../src/target.ts";
import { NativeTooling } from "../src/tooling.ts";
import {
  nativeLibrary,
  embeddedNativeLibraryPath,
  readNativeBytes,
  readNativeString,
  readOwnedBytes,
  readOwnedString,
  toCString,
} from "../../runtime/src/ffi";

describe("runtime SDK ffi helpers", () => {
  const provider = process.env.YOLO_TOOLING_LIB;
  it.skipIf(!provider || !existsSync(provider))(
    "loads the same installed provider for runtime and tooling without explicit library variables",
    () => {
      const home = mkdtempSync(join(tmpdir(), "yolo-shared-installed-"));
      const current = join(home, "runtime", hostTarget(), "current");
      mkdirSync(current, { recursive: true });
      const path = join(current, libraryFile());
      symlinkSync(provider!, path, "file");
      const keys = ["YOLO_HOME", "YOLO_RUNTIME_HOME", "YOLO_RUNTIME_LIB", "YOLO_TOOLING_LIB"] as const;
      const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
      try {
        for (const key of keys) delete process.env[key];
        process.env.YOLO_HOME = home;
        expect(defaultLibraryPath()).toBe(path);
        using tooling = new NativeTooling();
        const runtime = Runtime.load();
        expect(tooling.probe().libraryPath).toBe(path);
        expect(runtime.systemStats().os).toBe(
          process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : process.platform,
        );
        runtime.close();
        expect(tooling.analyzeModule("export const retained = 1;", "retained.ts").exports).toContain("retained");
      } finally {
        for (const key of keys) {
          if (previous[key] === undefined) delete process.env[key];
          else process.env[key] = previous[key];
        }
        rmSync(home, { recursive: true, force: true });
      }
    },
  );
  it("selects the sole embedded provider and ignores unrelated assets", () => {
    const stem = process.platform === "win32" ? "aphrody_ffi" : "libaphrody_ffi";
    const path = `/virtual/${stem}.${suffix}`;
    expect(embeddedNativeLibraryPath("aphrody_ffi", [])).toBeNull();
    expect(embeddedNativeLibraryPath("aphrody_ffi", [new File([], "unrelated.so"), new File([], path)])).toBe(path);
  });

  it("rejects competing embedded providers before any library load", () => {
    const stem = process.platform === "win32" ? "aphrody_ffi" : "libaphrody_ffi";
    expect(() =>
      embeddedNativeLibraryPath("aphrody_ffi", [
        new File([], `${stem}.${suffix}`),
        new File([], `${stem}-other.${suffix}`),
      ]),
    ).toThrow("Multiple embedded native libraries");
  });
  it("toCString appends a NUL", () => {
    expect([...toCString("ab")]).toEqual([97, 98, 0]);
  });

  it("readNativeBytes copies and frees", () => {
    const src = new Uint8Array([1, 2, 3]);
    let freed = 0;
    const out = readNativeBytes(ptr(src), 3, a => (freed = a));
    expect([...out]).toEqual([1, 2, 3]);
    expect(freed).toBe(Number(ptr(src)));
  });

  it("readOwnedBytes returns null for an empty slot", () => {
    expect(readOwnedBytes(new Uint8Array(24), () => {})).toBeNull();
  });

  it("readOwnedString decodes the borrowed bytes and releases (data, len, cap) once", () => {
    const source = new TextEncoder().encode("héllo 🐈");
    const slot = new Uint8Array(24);
    const view = new DataView(slot.buffer);
    const data = BigInt(ptr(source));
    view.setBigUint64(0, data, true);
    view.setBigUint64(8, BigInt(source.length), true);
    view.setBigUint64(16, BigInt(source.length + 4), true);
    const calls: bigint[][] = [];
    expect(readOwnedString(slot, (...args) => calls.push(args))).toBe("héllo 🐈");
    expect(calls).toEqual([[data, BigInt(source.length), BigInt(source.length + 4)]]);
  });

  it("readNativeString copies UTF-8 and releases exactly once", () => {
    const source = toCString('{"value":"🐈"}');
    let releases = 0;
    const value = readNativeString(ptr(source), address => {
      expect(address).toBe(Number(ptr(source)));
      releases++;
    });
    expect(JSON.parse(value)).toEqual({ value: "🐈" });
    expect(releases).toBe(1);
  });

  it("close before load is terminal and idempotent", () => {
    const library = nativeLibrary({ name: "x", path: import.meta.path, symbols: {} });
    library.close();
    library.close();
    expect(library.closed).toBe(true);
    expect(library.load()).toBeNull();
    expect(library.loadError()).toContain("closed");
  });

  it("nativeLibrary resolves an explicit path", () => {
    const lib = nativeLibrary({ name: "x", path: import.meta.path, symbols: {} });
    expect(lib.resolvePath()).toBe(import.meta.path);
  });

  it("nativeLibrary reports a diagnostic and honours fileNames", () => {
    const lib = nativeLibrary({ name: "nope", fileNames: ["Nope.Ffi.so"], symbols: {} });
    expect(lib.isAvailable()).toBe(false);
    expect(lib.loadError()).toContain("Nope.Ffi.so");
  });
});

describe("aphrody.h contract", () => {
  it("declares every yolo_* symbol the SDK binds, with the same arity", async () => {
    const header = (
      await Bun.file(join(import.meta.dir, "../../../crates/aphrody-ffi/include/aphrody.h")).text()
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    const declared = new Map<string, number>();
    for (const m of header.matchAll(/\b(yolo_\w+)\s*\(([^;{]*)\)\s*;/g)) {
      const params = m[2]!.trim();
      declared.set(m[1]!, params === "" || params === "void" ? 0 : params.split(",").length);
    }
    const drift = Object.entries(SYMBOLS)
      .filter(([name, def]) => declared.get(name) !== def.args.length)
      .map(([name, def]) => `${name}: sdk ${def.args.length}, header ${declared.get(name)}`);
    expect(drift).toEqual([]);

    // Optional browser/gpu ABI: own dlopen tables, never in the core SYMBOLS.
    const bound = new Map<string, number>(Object.entries(SYMBOLS).map(([name, def]) => [name, def.args.length]));
    const abiFiles = ["browser.ts", "gpu.ts"];
    // A module that only re-exports a canonical source (`export * from "…"`) is read through to it.
    const abiSource = async (path: string): Promise<string> => {
      const text = await Bun.file(path).text();
      const reexport = /^export \* from "([^"]+)";\s*$/m.exec(text);
      return reexport ? abiSource(Bun.resolveSync(reexport[1]!, dirname(path))) : text;
    };
    const abiSources = await Promise.all(abiFiles.map(file => abiSource(join(import.meta.dir, "../src", file))));
    for (const [index, file] of abiFiles.entries()) {
      for (const m of abiSources[index]!.matchAll(/^ {2}(yolo_\w+): \{\s*args: \[([^\]]*)\]/gm)) {
        const arity = m[2]!.split(",").filter(a => a.trim()).length;
        bound.set(m[1]!, arity);
        if (declared.get(m[1]!) !== arity) drift.push(`${m[1]}: ${file} ${arity}, header ${declared.get(m[1]!)}`);
      }
    }
    expect(drift).toEqual([]);
    expect([...declared.keys()].filter(name => !bound.has(name)).toSorted()).toEqual([]);
    for (const name of [
      "yolo_browser_create",
      "yolo_browser_call_start",
      "yolo_browser_close",
      "yolo_gpu_call_start",
    ]) {
      expect(name in SYMBOLS).toBe(false);
    }
  });
});
