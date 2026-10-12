// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { join } from "node:path";
import { allowedWorkspace } from "../src/workspace-layout.ts";

const root = join(import.meta.dir, "../../../..");

test("workspaces live below the declared roots or the sibling Bun fork packages, without escapes", () => {
  for (const path of [
    "packages/infra/workspace",
    "m3/packages/canvas",
    "m3/apps/example",
    "crates/tauri/aphrody-tauri-api",
    "../bun/packages/bun-aphrody-web",
    "../bun/packages/bun-aphrody-web/packages/agent-browser",
    "../bun/packages/bun-google/aphrody/packages/google",
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
    "packages/../../outside",
    "packages/./x",
  ])
    expect(allowedWorkspace(root, path)).toBe(false);
});
