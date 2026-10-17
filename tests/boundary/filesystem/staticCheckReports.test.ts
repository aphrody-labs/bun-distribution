import { spawnSync } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "../../support/bunTest.js";
import { z } from "zod";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const script = fileURLToPath(
  new URL("../../../scripts/ci/static-check-report.mjs", import.meta.url),
);
const repository = fileURLToPath(new URL("../../../", import.meta.url));
const fixture = async () => {
  const root = await createTestTempDirectory("rea-static-report-");
  await Promise.all([mkdir(join(root, "src")), mkdir(join(root, "tests"))]);
  await writeFile(
    join(root, ".oxlintrc.json"),
    JSON.stringify({
      rules: { "no-debugger": "error", "no-unused-vars": "warn" },
    }),
  );
  await writeFile(
    join(root, ".jscpd.json"),
    JSON.stringify({ threshold: 3, minLines: 5, minTokens: 50 }),
  );
  return root;
};
const invoke = (root: string, mode: string, ...arguments_: string[]) =>
  spawnSync(process.execPath, [script, mode, ...arguments_], {
    cwd: root,
    encoding: "utf8",
    timeout: 15_000,
  });
const lintDiagnostics = async (root: string) =>
  z
    .object({
      diagnostics: z.array(
        z.object({
          severity: z.string(),
          code: z.string().optional(),
          filename: z.string(),
        }),
      ),
    })
    .parse(
      JSON.parse(
        await readFile(join(root, ".cache/static-checks/oxlint.json"), "utf8"),
      ),
    ).diagnostics;

it("summarizes warnings without losing their complete diagnostic records", async () => {
  const root = await fixture();
  await writeFile(join(root, "src/warning.js"), "const forgotten = 1;\n");
  const result = invoke(root, "lint");
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("0 errors, 1 warnings");
  expect(result.stdout.split("\n").length).toBeLessThan(10);
  expect(await lintDiagnostics(root)).toEqual([
    expect.objectContaining({
      severity: "warning",
      code: "eslint(no-unused-vars)",
      filename: "src/warning.js",
    }),
  ]);
});

it("keeps lint errors failing and visible alongside the retained warnings", async () => {
  const root = await fixture();
  await writeFile(
    join(root, "src/fault.js"),
    "const forgotten = 1;\ndebugger;\n",
  );
  const result = invoke(root, "lint");
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stdout).toContain("1 errors, 1 warnings");
  expect(result.stderr).toContain("src/fault.js:2:1");
  expect(result.stderr).toContain("eslint(no-debugger)");
  expect(await lintDiagnostics(root)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ severity: "warning" }),
      expect.objectContaining({ severity: "error" }),
    ]),
  );
});

it("excludes translation staging while retaining authored website errors", async () => {
  const root = await fixture();
  for (const name of [".gitignore", ".oxlintrc.json"])
    await writeFile(join(root, name), await readFile(join(repository, name)));
  const authored = "website/public/assets/authored.js";
  const staged =
    "website/.i18n-regression/site/examples/notes-electron/main.js";
  for (const name of [authored, staged]) {
    const path = join(root, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      'const source = require("node:fs");\nconsole.log(source);\n',
    );
  }

  const result = invoke(root, "lint");
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stdout).toContain("1 errors, 0 warnings");
  expect(result.stderr).toContain(authored);
  expect(await lintDiagnostics(root)).toEqual([
    expect.objectContaining({
      severity: "error",
      code: "typescript(no-var-requires)",
      filename: authored,
    }),
  ]);
});

it("keeps malformed source failing with its parser diagnostic", async () => {
  const root = await fixture();
  await writeFile(join(root, "src/malformed.js"), "const value = ;\n");
  const result = invoke(root, "lint");
  expect(result.error).toBeUndefined();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("src/malformed.js:1:");
  expect(await lintDiagnostics(root)).toContainEqual(
    expect.objectContaining({ severity: "error" }),
  );
});

it.each([
  ["lint", "oxlint.json"],
  ["duplicates", "jscpd/jscpd-report.json"],
])(
  "removes stale %s evidence when the checker cannot run",
  async (mode, name) => {
    const root = await fixture();
    const reportPath = join(root, ".cache/static-checks", name);
    await mkdir(join(root, ".cache/static-checks/jscpd"), { recursive: true });
    await writeFile(reportPath, '{"previous_success":true}');
    const result = invoke(root, mode, "--rea-invalid-checker-option");
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("rea-invalid-checker-option");
    await expect(access(reportPath)).rejects.toMatchObject({ code: "ENOENT" });
  },
);
