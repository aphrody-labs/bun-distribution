// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nativeM3Css } from "../src/theme-css.ts";
import { designApp } from "../src/tools-design.ts";
import { cleanup, tmp } from "./helpers.ts";

afterAll(cleanup);

const BRIEF =
  "A calm dashboard for a coffee shop with orders and a revenue chart";
const native = await nativeM3Css();

describe("designApp", () => {
  test("compiles a brief to a layout, a theme sheet and tokens in the requested seed", async () => {
    const report = await designApp({ prompt: BRIEF, color: "#8c6c88" });
    expect(report.brief).toMatchObject({
      outputKind: "dashboard",
      seedColor: "#8c6c88",
      rawBrief: BRIEF,
    });
    expect(report.seed.toLowerCase()).toBe("#8c6c88");
    expect(report.files.map((file) => file.path)).toEqual([
      "src/theme.css",
      "src/tokens.json",
      "src/index.tsx",
    ]);
    expect(report.files.every((file) => file.bytes > 0)).toBe(true);
    expect(report.written).toEqual([]);
    expect(
      report.result.files.find((file) => file.path === "src/theme.css")!
        .content,
    ).toContain("--md-sys-color-primary");
  });

  test("out writes the generated files", async () => {
    const out = tmp("m3-bun-design-");
    const report = await designApp({ prompt: BRIEF, out });
    expect(report.written).toEqual(
      report.files.map((file) => join(out, file.path)),
    );
    const tokens = JSON.parse(
      readFileSync(join(out, "src", "tokens.json"), "utf8"),
    ) as object;
    expect(typeof tokens).toBe("object");
    expect(readFileSync(join(out, "src", "index.tsx"), "utf8")).toContain(
      "@aphrody/m3-react",
    );
  });

  test("an empty brief is an error", async () => {
    await expect(designApp({ prompt: "  " })).rejects.toThrow(
      /the brief is empty/,
    );
  });

  test.skipIf(native !== undefined)(
    "validate without the native library says what is missing",
    async () => {
      await expect(
        designApp({ prompt: BRIEF, validate: true }),
      ).rejects.toThrow(/native library not found/);
    },
  );
});
