// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { scan } from "../../../../packages/engine/n2b-client/src/index.ts";
import { n2bPlugin } from "../../../../packages/engine/n2b-client/src/plugin.ts";
import type { N2BReport } from "../../../../packages/engine/n2b-client/src/types.ts";
import type { N2BReport as SdkReport } from "../../../../packages/engine/runtime/src/tooling-schema.ts";

const work = mkdtempSync(join(tmpdir(), "yolo-n2b-packages-"));
const missing = join(work, "missing-provider");
const provider = process.env["YOLO_TOOLING_LIB"];
afterAll(() => rmSync(work, { recursive: true, force: true }));

function fixture(name: string): { root: string; file: string; original: string } {
  const root = join(work, name);
  mkdirSync(root);
  const file = join(root, "entry.js");
  const original = "#!/usr/bin/env node\nexport const value = 1;\n";
  writeFileSync(file, original);
  return { root, file, original };
}

async function failedBuild(
  entry: string,
  options: Parameters<typeof n2bPlugin>[0],
): Promise<string> {
  try {
    const result = await Bun.build({ entrypoints: [entry], plugins: [n2bPlugin(options)] });
    return result.success ? "Unexpected successful build" : result.logs.map(String).join("\n");
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe("canonical N2B Bun packages", () => {
  test("package scan rejects legacy CLI options and invalid native jobs before loading", async () => {
    await expect(scan(work, { bin: "unrequested-command", libraryPath: missing })).rejects.toThrow(
      "select @aphrody/n2b-core/cli explicitly",
    );
    await expect(scan(work, { cwd: work, libraryPath: missing })).rejects.toThrow(
      "cannot use bin/cwd",
    );
    await expect(scan(work, { jobs: 0, libraryPath: missing })).rejects.toThrow("N2B jobs");
    await expect(scan(work, { jobs: 7, libraryPath: missing })).rejects.toThrow("N2B jobs");
    await expect(scan(work, { libraryPath: missing })).rejects.toThrow(
      "Selected native tooling library is missing",
    );
  });

  test("a precomputed canonical report builds without native or CLI availability", async () => {
    const project = fixture("precomputed");
    const sdk: SdkReport = {
      schema_version: 2,
      tool: "node2bun",
      version: "0.6.2",
      mode: "check",
      root: project.root,
      files_scanned: 1,
      findings_total: 0,
      files: [{ path: "entry.js", changed: false, findings: [] }],
    };
    const report: N2BReport = sdk;
    const result = await Bun.build({
      entrypoints: [project.file],
      plugins: [n2bPlugin({ root: project.root, libraryPath: missing, report, quiet: true })],
    });
    expect(result.success).toBe(true);
    expect(result.outputs).toHaveLength(1);
    expect(readFileSync(project.file, "utf8")).toBe(project.original);
  });

  test("default and auto plugin policies propagate missing providers instead of disabling scanning", async () => {
    const project = fixture("missing-native");
    for (const native of [undefined, "auto", "required"] as const) {
      expect(
        await failedBuild(project.file, {
          root: project.root,
          libraryPath: missing,
          quiet: true,
          ...(native === undefined ? {} : { native }),
        }),
      ).toContain("Selected native tooling library is missing");
    }
    expect(readFileSync(project.file, "utf8")).toBe(project.original);
  });

  test("the native plugin rejects CLI configuration unless off is explicitly selected", async () => {
    const project = fixture("invalid-native-cli");
    expect(await failedBuild(project.file, { root: project.root, bin: "n2b" })).toContain(
      "cannot use a custom CLI binary",
    );
    expect(await failedBuild(project.file, { root: project.root, cwd: project.root })).toContain(
      "cannot use a custom CLI binary",
    );
  });

  test.skipIf(process.platform === "win32")(
    "an available legacy binary is never used as a missing-native fallback",
    async () => {
      const project = fixture("no-fallback");
      const marker = join(project.root, "unexpected-cli");
      const binary = join(project.root, "legacy-n2b");
      writeFileSync(binary, `#!/bin/sh\nprintf used > '${marker}'\nprintf '{"files":[]}'\n`);
      chmodSync(binary, 0o755);
      const previous = process.env["N2B_BIN"];
      try {
        process.env["N2B_BIN"] = binary;
        await expect(scan(project.root, { libraryPath: missing })).rejects.toThrow(
          "Selected native tooling library is missing",
        );
        expect(
          await failedBuild(project.file, {
            root: project.root,
            libraryPath: missing,
            quiet: true,
          }),
        ).toContain("Selected native tooling library is missing");
        expect(existsSync(marker)).toBe(false);
      } finally {
        if (previous === undefined) delete process.env["N2B_BIN"];
        else process.env["N2B_BIN"] = previous;
      }
    },
  );

  test.skipIf(provider === undefined)(
    "real SDK scans, previews, fixes and plugin builds use the same native engine",
    async () => {
      const project = fixture("native-sdk");
      const options = { libraryPath: resolve(provider!), jobs: 1 };
      const checked = await scan(project.root, options);
      expect(checked.schema_version).toBe(2);
      expect(checked.mode).toBe("check");
      expect(
        checked.files.some((file) =>
          file.findings.some((finding) => finding.rule_id === "shebang/node"),
        ),
      ).toBe(true);
      expect(readFileSync(project.file, "utf8")).toBe(project.original);
      const preview = await scan(project.root, { ...options, mode: "fix", dry_run: true });
      expect(preview.mode).toBe("fix");
      expect(readFileSync(project.file, "utf8")).toBe(project.original);
      const result = await Bun.build({
        entrypoints: [project.file],
        plugins: [n2bPlugin({ root: project.root, ...options, ignore: ["entry.js"], quiet: true })],
      });
      expect(result.success).toBe(true);
      expect(readFileSync(project.file, "utf8")).toBe(project.original);
      const fixed = await scan(project.root, { ...options, mode: "fix" });
      expect(fixed.mode).toBe("fix");
      expect(readFileSync(project.file, "utf8")).toContain("#!/usr/bin/env bun");
    },
  );
});
