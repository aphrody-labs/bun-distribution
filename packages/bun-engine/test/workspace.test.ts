import { describe, expect, test } from "bun:test";
import { compileTargets, isCompileTarget } from "../src/workspace";

type Workspace = {
  schema: number;
  cli: string;
  ffi: string;
  web: string;
  cargoWorkspace: string;
  bunWorkspace: string;
  cmakeWorkspace: string;
  owners: Record<string, string | string[]>;
};

const root = new URL("../../../", import.meta.url).pathname.slice(1);

describe("canonical workspace", () => {
  test("exposes the supported standalone targets", () => {
    expect(compileTargets).toContain("bun-windows-arm64");
    expect(compileTargets).toContain("bun-linux-x64-musl");
    expect(isCompileTarget("bun-darwin-arm64")).toBeTrue();
    expect(isCompileTarget("bun-browser-x64")).toBeFalse();
  });

  test("has one entry point for every build surface", async () => {
    const workspace: Workspace = await Bun.file(`${root}/packages/bun-engine/config/workspace.json`).json();
    expect(workspace.schema).toBe(1);
    for (const path of [
      workspace.cli,
      workspace.ffi,
      workspace.web,
      workspace.cargoWorkspace,
      workspace.bunWorkspace,
      workspace.cmakeWorkspace,
    ]) {
      expect(await Bun.file(`${root}/${path}`).exists()).toBeTrue();
    }
  });

  test("pins every declared source owner as a local path", async () => {
    const workspace: Workspace = await Bun.file(`${root}/packages/bun-engine/config/workspace.json`).json();
    for (const value of Object.values(workspace.owners).flat()) {
      let found = false;
      for await (const _entry of new Bun.Glob("*").scan({ cwd: `${root}/${value}`, dot: true })) {
        found = true;
        break;
      }
      expect(found).toBeTrue();
    }
  });
});
