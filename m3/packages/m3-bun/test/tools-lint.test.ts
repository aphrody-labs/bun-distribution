// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lintApp, oxlintBinary, ruleName } from "../src/tools-lint.ts";
import { cleanup, tmp } from "./helpers.ts";

afterAll(cleanup);

const oxlint = (() => {
  try {
    return oxlintBinary();
  } catch {
    return undefined;
  }
})();

test("ruleName turns oxlint codes into plugin/rule", () => {
  expect(ruleName("m3(no-sx-prop)")).toBe("m3/no-sx-prop");
  expect(ruleName("eslint(no-unused-vars)")).toBe("eslint/no-unused-vars");
});

const app = (): string => {
  const dir = tmp("m3-bun-lint-");
  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, "dist"));
  const source =
    'export const A = () => <md-filled-button sx={{ p: 1 }} style={{ color: "#ff0000" }}><md-icon>Not An Icon</md-icon></md-filled-button>;\n';
  writeFileSync(join(dir, "src", "a.tsx"), source);
  writeFileSync(join(dir, "src", "mui.tsx"), 'import Button from "@mui/material/Button";\nexport { Button };\n');
  writeFileSync(join(dir, "dist", "a.tsx"), source);
  return dir;
};


describe.skipIf(!oxlint)("lintApp", () => {
  test("runs the m3 rules of the recommended preset through oxlint, outside dist", async () => {
    const report = await lintApp({ dir: app() });
    expect(report.diagnostics.map(d => `${d.file}:${d.line}:${d.column} ${d.rule} ${d.severity}`).toSorted()).toEqual([
      "src/a.tsx:1:24 m3/no-hardcoded-color warning",
      "src/a.tsx:1:42 m3/no-sx-prop error",
      "src/a.tsx:1:85 m3/valid-icon-name error",
      "src/mui.tsx:1:1 m3/no-mui-import warning",
    ]);
    expect(report).toMatchObject({ errors: 2, warnings: 2, files: 2, rules: 8 });
    expect(report.exitCode).toBe(1);
  });

  test("strict turns the warnings into errors; paths narrow the run", async () => {
    const report = await lintApp({ dir: app(), preset: "strict", paths: ["src/mui.tsx"] });
    expect(report.diagnostics.map(d => `${d.rule} ${d.severity}`)).toEqual(["m3/no-mui-import error"]);
    expect(report.files).toBe(1);
    expect(report.exitCode).toBe(1);
  });

  test("an unknown preset is an error that lists the presets", async () => {
    await expect(lintApp({ dir: app(), preset: "loose" as never })).rejects.toThrow(
      /unknown preset loose \(recommended, strict\)/,
    );
  });
});
