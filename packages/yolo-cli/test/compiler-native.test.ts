// SPDX-License-Identifier: MIT
import { afterAll, expect, test } from "bun:test";
import { dlopen, FFIType } from "bun:ffi";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativeTooling } from "@aphrody/runtime-sdk/tooling";

// This tiny C provider tests ownership/transport failures only, never Oxc or N2B behavior.
const compiler = Bun.which("clang");
const fixtureTest = test.skipIf(!compiler || process.platform !== "linux");
const providerPath = process.env.YOLO_TOOLING_LIB;
const providerTest = test.skipIf(!providerPath);
const directory = mkdtempSync(join(tmpdir(), "yolo-tooling-transport-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
const source = String.raw`
#include <stdint.h>
#include <stddef.h>
#include <stdlib.h>
#include <string.h>
static uint32_t calls, frees;
static char options[1024];
uint32_t fixture_calls(void) { return calls; }
uint32_t fixture_frees(void) { return frees; }
const char *fixture_options(void) { return options; }
uint32_t yolo_tooling_abi_version(void) { return TOOLING_ABI; }
uint32_t node2bun_abi_version(void) { return 2; }
uint32_t aphrody_oxc_abi_version(void) { return 1; }
static char *response(const char *input, const char *success) {
  calls++;
  if (!strcmp(input, "null")) return NULL;
  if (!strcmp(input, "malformed-json")) return strdup("{");
  if (!strcmp(input, "native-error")) return strdup("{\"ok\":false,\"error\":\"fixture failure\"}");
  if (!strcmp(input, "syntax")) return strdup("{\"ok\":false,\"kind\":\"syntax\",\"error\":\"fixture syntax\"}");
  if (!strcmp(input, "bad-schema")) return strdup("{\"ok\":true,\"diagnostics\":42}");
  return strdup(success);
}
void aphrody_oxc_free(char *value) { if (value) { frees++; free(value); } }
void node2bun_string_free(char *value) { aphrody_oxc_free(value); }
char *aphrody_oxc_format(const char *input, const char *filename) {
  (void)filename; return response(input, "{\"ok\":true,\"code\":\"fixture-code\"}");
}
char *aphrody_oxc_minify(const char *input, const char *filename) { return aphrody_oxc_format(input, filename); }
char *aphrody_oxc_lint(const char *input, const char *filename) {
  (void)filename; return response(input, "{\"ok\":true,\"diagnostics\":[\"fixture\"]}");
}
char *aphrody_oxc_analyze(const char *input, const char *filename) {
  (void)filename; return response(input, "{\"ok\":true,\"result\":{\"imports\":[],\"exports\":[],\"hasModuleSyntax\":false,\"spanEncoding\":\"utf16\",\"requests\":[],\"exportEntries\":[]}}");
}
char *aphrody_oxc_parse(const char *input, const char *filename) {
  (void)filename; return response(input, "{\"ok\":true,\"result\":{\"type\":\"Program\",\"body\":[]}}");
}
char *node2bun_scan_with_options_json(const char *root, const char *json) {
  if (json) { strncpy(options, json, sizeof(options)-1); options[sizeof(options)-1] = 0; }
  else options[0] = 0;
  return response(root, "{\"ok\":true,\"report\":{\"schema_version\":2,\"$schema\":\"fixture\",\"files\":[]}}");
}
char *node2bun_scan_json(const char *root) { return node2bun_scan_with_options_json(root, NULL); }
size_t find_newlines_u16(const uint8_t *bytes, size_t length, uint32_t *output, size_t capacity) {
  size_t count = 0;
  for (size_t index = 0; index + 1 < length; index += 2) {
    if (bytes[index] == 10 && bytes[index+1] == 0) {
      if (output && count < capacity) output[count] = (uint32_t)(index / 2);
      count++;
    }
  }
  return count;
}
`;

function fixture(abi = 1) {
  const path = join(directory, `libfixture-${abi}.so`);
  const input = join(directory, `fixture-${abi}.c`);
  writeFileSync(input, source);
  const built = Bun.spawnSync(
    [compiler!, "-shared", "-fPIC", `-DTOOLING_ABI=${abi}`, input, "-o", path],
    { windowsHide: true },
  );
  if (built.exitCode) throw new Error(built.stderr.toString());
  expect(built.exitCode).toBe(0);
  const observer = dlopen(path, {
    fixture_calls: { args: [], returns: FFIType.u32 },
    fixture_frees: { args: [], returns: FFIType.u32 },
    fixture_options: { args: [], returns: FFIType.cstring },
  });
  return { path, observer };
}

test("input validation does not load a missing provider or alter explicit selection", () => {
  using tooling = new NativeTooling({ path: join(directory, "missing.so") });
  expect(() => tooling.formatSource("bad\0source")).toThrow(TypeError);
  expect(() => tooling.scanNodeProject("project", { jobs: 0 })).toThrow(
    TypeError,
  );
  expect(() => tooling.scanNodeProject("project", { jobs: 7 })).toThrow(
    TypeError,
  );
  expect(() =>
    tooling.scanNodeProject("project", { unknown: true } as never),
  ).toThrow(TypeError);
  expect(tooling.probe().error).toContain("selection preserved");
  expect(tooling.probe().available).toBe(false);
});

fixtureTest(
  "owned native strings are released on success and every decoding failure",
  () => {
    const { path, observer } = fixture();
    try {
      using tooling = new NativeTooling({ path });
      const start = observer.symbols.fixture_frees();
      expect(tooling.formatSource("valid")).toBe("fixture-code");
      expect(observer.symbols.fixture_frees()).toBe(start + 1);
      expect(() => tooling.formatSource("malformed-json")).toThrow(
        "invalid native JSON",
      );
      expect(observer.symbols.fixture_frees()).toBe(start + 2);
      expect(() => tooling.formatSource("native-error")).toThrow(
        "fixture failure",
      );
      expect(observer.symbols.fixture_frees()).toBe(start + 3);
      expect(() => tooling.lintSource("bad-schema")).toThrow(
        "invalid native diagnostics",
      );
      expect(observer.symbols.fixture_frees()).toBe(start + 4);
      expect(() => tooling.analyzeModule("syntax", "fixture.ts")).toThrow(
        SyntaxError,
      );
      expect(observer.symbols.fixture_frees()).toBe(start + 5);
      expect(() => tooling.formatSource("null")).toThrow("null pointer");
      expect(observer.symbols.fixture_frees()).toBe(start + 5);
    } finally {
      observer.close();
    }
  },
);

fixtureTest(
  "N2B options retain absence, explicit dry-run and bounded jobs",
  () => {
    const { path, observer } = fixture();
    try {
      using tooling = new NativeTooling({ path });
      expect(tooling.scanNodeProject("project").schema_version).toBe(2);
      expect(observer.symbols.fixture_options()!.toString()).toBe("");
      tooling.scanNodeProject("project", {
        mode: "fix",
        jobs: 2,
        dry_run: true,
        ignore: ["vendor"],
      });
      expect(
        JSON.parse(observer.symbols.fixture_options()!.toString()),
      ).toEqual({
        mode: "fix",
        jobs: 2,
        dry_run: true,
        ignore: ["vendor"],
      });
      expect([...tooling.findNewlinesUtf16("\u0a00🐈\nline\n")]).toEqual([
        3, 8,
      ]);
      const calls = observer.symbols.fixture_calls();
      expect(() => tooling.scanNodeProject("project", { jobs: 7 })).toThrow(
        TypeError,
      );
      expect(observer.symbols.fixture_calls()).toBe(calls);
    } finally {
      observer.close();
    }
  },
);

fixtureTest("ABI mismatch closes the owner before engine dispatch", () => {
  const { path, observer } = fixture(9);
  try {
    using tooling = new NativeTooling({ path });
    expect(tooling.probe()).toMatchObject({ available: false, closed: true });
    expect(tooling.probe().error).toContain("ABI mismatch");
    expect(() => tooling.formatSource("valid")).toThrow("ABI mismatch");
    expect(observer.symbols.fixture_calls()).toBe(0);
  } finally {
    observer.close();
  }
});

fixtureTest("closing an owner prevents all later native dispatch", () => {
  const { path, observer } = fixture();
  try {
    const tooling = new NativeTooling({ path });
    expect(tooling.probe().available).toBe(true);
    const calls = observer.symbols.fixture_calls();
    tooling.close();
    tooling.close();
    expect(tooling.probe()).toMatchObject({ available: false, closed: true });
    expect(() => tooling.formatSource("valid")).toThrow("closed");
    expect(() => tooling.findNewlinesUtf16("")).toThrow("closed");
    expect(observer.symbols.fixture_calls()).toBe(calls);
  } finally {
    observer.close();
  }
});

providerTest(
  "the real provider scans an isolated project without changing its source",
  () => {
    const root = join(directory, "real-project");
    mkdirSync(root);
    const input = join(root, "index.js");
    const text =
      'import fs from "node:fs"; const contents = fs.readFileSync("input.txt", "utf8");\n';
    writeFileSync(input, text);
    using tooling = new NativeTooling({ path: providerPath! });
    const report = tooling.scanNodeProject(root);
    expect(report.schema_version).toBe(2);
    expect(report.mode).toBe("check");
    expect(report.files_scanned).toBe(1);
    expect(report.findings_total).toBeGreaterThan(0);
    expect(report.files.every((file) => !file.changed)).toBe(true);
    expect(readFileSync(input, "utf8")).toBe(text);
    expect([...tooling.findNewlinesUtf16("\u0a00🐈\nline\n")]).toEqual([3, 8]);
  },
);
