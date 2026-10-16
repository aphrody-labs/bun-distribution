// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { join } from "node:path";
import { allowedWorkspace } from "../src/workspace-layout.ts";

const root = join(import.meta.dir, "../../../docs/aphrody");

test("workspaces live below the declared roots or the sibling Bun fork packages, without escapes", () => {
  for (const path of [
    "packages/infra/workspace",
    "m3/packages/canvas",
    "m3/apps/example",
    "crates/tauri/aphrody-tauri-api",
    "../bun/packages/web/rust",
    "../bun/packages/web/rust/packages/agent-browser",
    "../bun/packages/bun-google/aphrody/packages/google",
    "../material/packages/app-ui",
    "../material/packages/m3/packages/m3",
  ])
    expect(allowedWorkspace(root, path)).toBe(true);
  for (const path of [
    "m3/templates/base",
    "tools/config",
    "../other/packages/x",
    "../bun/src",
    "../bun/packages/",
    "../bun/packages/../../outside",
    "../bun/packages/x/../../../outside",
    "../material/src",
    "../material/packages/",
    "../material/packages/../../outside",
    "../material/packages/x/../../../outside",
    "packages/../../outside",
    "packages/./x",
  ])
    expect(allowedWorkspace(root, path)).toBe(false);
});
