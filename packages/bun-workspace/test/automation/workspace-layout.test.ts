// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { join } from "node:path";
import { allowedWorkspace } from "../../src/automation/workspace-layout.ts";

const root = join(import.meta.dir, "../../../..");

test("product members are flat and pinned runtime packages keep their source boundary", () => {
  for (const path of [
    "packages/bun-workspace",
    "apps/m3-next-example",
    "packages/canvas",
    "toolchains/bun/packages/web/rust",
    "toolchains/bun/packages/web/rust/packages/agent-browser",
    "toolchains/bun/packages/bun-google/aphrody/packages/google",
  ])
    expect(allowedWorkspace(root, path)).toBe(true);
  for (const path of [
    "m3/templates/base",
    "m3/packages/canvas",
    "drive/apps/example",
    "crates/tauri/aphrody-tauri-api",
    "packages/m3-next/examples/app",
    "../material/packages/app-ui",
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
    "packages\\member",
    "toolchains/bun/packages/x/../../outside",
  ])
    expect(allowedWorkspace(root, path)).toBe(false);
});
