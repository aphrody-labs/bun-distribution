// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyLink,
  BUILD_HINT,
  installedCopies,
  linkPlan,
  nativeFileFor,
  resolveLibrary,
  RUNTIME_SDK_FFI,
  SUFFIX,
  searchDirs,
} from "./native.ts";

const root = mkdtempSync(join(tmpdir(), "m3-native-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function pkg(dir: string, version: string, library?: string) {
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "@aphrody/bun", version }),
  );
  if (library) writeFileSync(join(dir, "src/library.ts"), library);
}

describe("installed @aphrody/bun copies", () => {
  const npmCopy = join(
    root,
    "node_modules/.bun/@aphrody+bun@3.3.0/node_modules/@aphrody/bun",
  );
  const workspaceCopy = join(root, "node_modules/@aphrody/bun");
  pkg(npmCopy, "3.3.0");
  pkg(workspaceCopy, "3.3.3", "const file = `lib aphrody_ffi.${suffix}`;");

  test("the npm build opens native/bun_rs, the workspace build native/libaphrody_ffi", () => {
    expect(nativeFileFor(npmCopy)).toBe(
      join(npmCopy, "native", `bun_rs.${SUFFIX}`),
    );
    expect(nativeFileFor(workspaceCopy)).toEndWith(`aphrody_ffi.${SUFFIX}`);
  });

  test("both layouts are discovered, with their missing native file", () => {
    const copies = installedCopies(root);
    expect(copies.map((c) => c.version).toSorted()).toEqual(["3.3.0", "3.3.3"]);
    expect(copies.every((c) => !c.present)).toBe(true);
  });

  test("link plans one symlink per copy and is idempotent", () => {
    const lib = join(root, `libaphrody_ffi.${SUFFIX}`);
    writeFileSync(lib, "not a real library");
    const copies = installedCopies(root);
    const steps = linkPlan(lib, copies);
    expect(steps.map((s) => s.action)).toEqual(["create", "create"]);
    applyLink(steps);
    for (const c of copies)
      expect(lstatSync(c.nativeFile).isSymbolicLink()).toBe(true);
    expect(linkPlan(lib, installedCopies(root)).map((s) => s.action)).toEqual([
      "keep",
      "keep",
    ]);
  });
});

describe("resolution through @aphrody/runtime-sdk/ffi", () => {
  test("a missing SDK is reported, not thrown", async () => {
    const r = await resolveLibrary({ sdk: join(root, "missing/ffi.ts") });
    expect(r.path).toBeNull();
    expect(r.error).toContain("runtime-sdk/ffi not found");
  });

  const hasSdk = existsSync(RUNTIME_SDK_FFI);
  test.skipIf(!hasSdk)(
    "an unloadable candidate is rejected by the loader",
    async () => {
      const fake = join(root, `bogus.${SUFFIX}`);
      writeFileSync(fake, "garbage");
      const r = await resolveLibrary({ lib: fake, dirs: [] });
      expect(r.path).toBeNull();
      expect(r.error).toContain("Failed to dlopen");
    },
  );

  test.skipIf(!hasSdk)("an absent library reports the build hint", async () => {
    const saved = {
      a: process.env["APHRODY_FFI_LIB"],
      b: process.env["BUN_RS_LIB"],
    };
    delete process.env["APHRODY_FFI_LIB"];
    delete process.env["BUN_RS_LIB"];
    try {
      const r = await resolveLibrary({ dirs: [join(root, "empty")] });
      // The executable directory and ~/.local/bin are part of the SDK search order; a machine that
      // installed the library there resolves it, any other reports how to build it.
      if (r.path === null) expect(r.error).toContain(BUILD_HINT);
      else expect(existsSync(r.path)).toBe(true);
    } finally {
      if (saved.a !== undefined) process.env["APHRODY_FFI_LIB"] = saved.a;
      if (saved.b !== undefined) process.env["BUN_RS_LIB"] = saved.b;
    }
  });
});

// The real library, when this machine has it: loaded and verified through the SDK loader.
const real = existsSync(RUNTIME_SDK_FFI)
  ? await resolveLibrary()
  : { path: null, error: "yolo runtime SDK not found" };
if (!real.path)
  console.warn(`[scripts/native] real-library check skipped: ${real.error}`);
test.skipIf(!real.path)(
  `the built library exports bun_rs_version${real.path ? "" : ` [skipped: ${real.error}]`}`,
  () => {
    expect(existsSync(real.path!)).toBe(true);
  },
);

test("search includes installed package library directories", () => {
  const copies = installedCopies(root);
  const dirs = searchDirs(join(root, "aphrody"), copies);
  for (const copy of copies) expect(dirs).toContain(join(copy.dir, "native"));
});

test.skipIf(!existsSync(RUNTIME_SDK_FFI))(
  "status rejects a present but unloadable package library",
  async () => {
    const fixture = join(root, "status-fixture");
    const script = join(fixture, "scripts/native.ts");
    mkdirSync(join(fixture, "scripts"), { recursive: true });
    writeFileSync(
      script,
      await Bun.file(import.meta.dir + "/native.ts").text(),
    );
    const copy = join(fixture, "node_modules/@aphrody/bun");
    pkg(copy, "3.3.0");
    mkdirSync(join(copy, "native"), { recursive: true });
    writeFileSync(nativeFileFor(copy), "garbage");
    const proc = Bun.spawn(
      [
        process.execPath,
        script,
        "status",
        "--json",
        ...(real.path ? ["--lib", real.path] : []),
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(err).toBe("");
    const status = JSON.parse(out);
    expect(status.copies).toHaveLength(1);
    expect(status.copies[0].present).toBe(true);
    expect(status.copies[0].library.path).toBeNull();
    expect(status.copies[0].library.error).toContain("Failed to dlopen");
    expect(code).toBe(1);
  },
);
