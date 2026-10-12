// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { siteArguments, workspaceRoot } from "../site";

test("site launcher selects the canonical workspace and a loopback default", () => {
  expect(siteArguments({})).toEqual([
    "site",
    "serve",
    "--root",
    workspaceRoot,
    "--app",
    "--bind",
    "127.0.0.1:3000",
  ]);
});

test("explicit deployment context and native flags pass through", () => {
  expect(
    siteArguments(
      {
        APHRODY_WORKSPACE_ROOT: "/selected/workspace",
        PORT: "8000",
        APHRODY_SITE_BIND: "127.0.0.1:9000",
      },
      ["--help"],
    ),
  ).toEqual([
    "site",
    "serve",
    "--root",
    "/selected/workspace",
    "--app",
    "--bind",
    "127.0.0.1:9000",
    "--help",
  ]);
});
