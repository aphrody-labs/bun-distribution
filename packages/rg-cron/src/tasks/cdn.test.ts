/**
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { sharedAssetsDestDir } from "./cdn";

describe("sharedAssetsDestDir", () => {
  test("publie sous <racine statique>/rg/public sans doubler /static", () => {
    expect(sharedAssetsDestDir("/var/www/cdn/static")).toBe(join("/var/www/cdn/static", "rg/public"));
  });
});
