#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Compatibility launcher: Rust owns HTTP, assets, catalogs and app transport.
import { resolve } from "node:path";
import { resolveRustAphrody } from "../../bin/aphrody";

const root = resolve(import.meta.dir, "../..");
const native = resolveRustAphrody(root);
if (!native)
  throw new Error("Install the native Aphrody CLI or set APHRODY_BIN before serving app-ui.");
const bind = process.env.APHRODY_SITE_BIND || `127.0.0.1:${process.env.PORT || "3000"}`;
const child = Bun.spawn(
  [
    native,
    "site",
    "serve",
    "--root",
    process.env.APHRODY_WORKSPACE_ROOT || root,
    "--app",
    "--bind",
    bind,
    ...process.argv.slice(2),
  ],
  { cwd: root, env: process.env, stdin: "inherit", stdout: "inherit", stderr: "inherit" },
);
process.exit(await child.exited);
