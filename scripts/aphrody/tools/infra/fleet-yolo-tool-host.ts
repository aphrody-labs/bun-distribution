#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Static deployment entry for the Yolo tool host consumed by the canonical Aphrody MCP.
import { runToolHost } from "@aphrody/yolo-core/tool-host";
import { findCheckout } from "@aphrody/yolo-core/src/vfs/home.ts";

if (import.meta.main) {
  process.exitCode = await runToolHost(
    Bun.argv.slice(2),
    findCheckout() ?? process.cwd(),
  );
}
