// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  literalKeyFiles,
  owners,
  pyprojectDeclares,
  uvPin,
  uvSatisfies,
  verifyStatic,
} from "./verify-google-pipeline.ts";

const sandbox = mkdtempSync(join(tmpdir(), "google-pipeline-"));
afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

describe("verify-google-pipeline", () => {
  test("reads the uv pin and checks the installed version", () => {
    expect(uvPin('[tool.uv]\nrequired-version = ">=0.12.24"\n')).toEqual({
      operator: ">=",
      version: "0.12.24",
    });
    expect(uvPin('required-version = "==0.9.1"')).toEqual({ operator: "==", version: "0.9.1" });
    expect(uvPin("[tool.uv]\n")).toBeUndefined();
    const pin = { operator: ">=", version: "0.12.24" };
    expect(uvSatisfies("uv 0.12.24 (x86_64-pc-windows-msvc)", pin)).toBe(true);
    expect(uvSatisfies("uv 0.13.0", pin)).toBe(true);
    expect(uvSatisfies("uv 0.12.3", pin)).toBe(false);
    expect(uvSatisfies("uv 0.13.0", { operator: "==", version: "0.12.24" })).toBe(false);
  });

  test("checks pyproject names and script entry points", () => {
    const toml =
      '[project]\nname = "aphrody-cli"\n\n[project.scripts]\naphrody-python = "aphrody_cli.main:main"\naphrody-python-google = "aphrody_cli.google:main"\n\n[tool.x]\n';
    expect(pyprojectDeclares(toml, "aphrody-cli")).toBe(true);
    expect(pyprojectDeclares(toml, "aphrody")).toBe(false);
    expect(
      pyprojectDeclares(toml, "aphrody-cli", ["aphrody-python-google", "aphrody_cli.google:main"]),
    ).toBe(true);
    expect(
      pyprojectDeclares(toml, "aphrody-cli", ["aphrody-google", "aphrody_cli.google:main"]),
    ).toBe(false);
  });

  test("finds literal key assignments in sources only", () => {
    const dir = join(sandbox, "src");
    mkdirSync(join(dir, "nested"), { recursive: true });
    writeFileSync(join(dir, "ok.ts"), "const key = process.env.GEMINI_API_KEY;\n");
    writeFileSync(join(dir, "nested", "bad.py"), `GOOGLE_API_KEY${"="}placeholder\n`);
    writeFileSync(join(dir, "notes.md"), `GEMINI_API_KEY${"="}placeholder\n`);
    expect(literalKeyFiles(dir).map((file) => file.replaceAll("\\", "/"))).toEqual([
      "nested/bad.py",
    ]);
  });

  test("the current checkout satisfies the static owner checks", () => {
    const { crates, uv } = verifyStatic(owners(resolve(import.meta.dir, "../..")));
    expect(crates).toContain("aphrody-google");
    expect(uv.version).toMatch(/^\d+\.\d+/);
  });
});
