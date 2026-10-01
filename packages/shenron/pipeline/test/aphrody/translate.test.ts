// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AphrodyTranslateService } from "../../src/aphrody/translate";
import { GoogleTranslateService } from "../../src/bxc/services";

const directory = mkdtempSync(join(tmpdir(), "aphrody-translation-consumer-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

function fixture(name: string, code: string): string {
  const path = join(directory, name);
  writeFileSync(path, `#!${process.execPath}\n${code}\n`);
  chmodSync(path, 0o755);
  return path;
}

describe.skipIf(process.platform === "win32")("Rust translation consumer contract", () => {
  it("preserves a requested Japanese target and option-like source text in its CLI request", async () => {
    const bin = fixture(
      "translate-success",
      `
const args = process.argv.slice(2);
if (args[0] !== "translate" || !args.includes("--json") || args[args.length - 2] !== "--") process.exit(2);
console.log(JSON.stringify({ translatedText: args.at(-1), target: args[args.indexOf("--target") + 1], detectedSource: args[args.indexOf("--source") + 1], provider: "aphrody-translate" }));
`,
    );
    const result = await new AphrodyTranslateService({ bin }).translate("--Hello", "ja", "en");
    expect(result).toEqual({
      translatedText: "--Hello",
      target: "ja",
      detectedSource: "en",
      provider: "aphrody-translate",
    });
  });

  it("propagates owner failures instead of returning untranslated input or starting another provider", async () => {
    const bin = fixture(
      "translate-failure",
      'console.error("backend unavailable"); process.exit(7);',
    );
    await expect(
      new AphrodyTranslateService({ bin }).translate("Hello", "fr", "en"),
    ).rejects.toThrow("exited 7: backend unavailable");
  });

  it("rejects output for a different language", async () => {
    const bin = fixture(
      "translate-wrong-target",
      'console.log(JSON.stringify({translatedText:"Bonjour",target:"de",provider:"aphrody-translate"}));',
    );
    await expect(
      new AphrodyTranslateService({ bin }).translate("Hello", "fr", "en"),
    ).rejects.toThrow("invalid target");
  });

  it("keeps the historical compatibility entry point's empty-input contract", async () => {
    expect(await new GoogleTranslateService().translate("  ", "fr", "en")).toEqual({
      translatedText: "  ",
      target: "fr",
      detectedSource: "en",
      provider: "cache",
    });
  });
});
