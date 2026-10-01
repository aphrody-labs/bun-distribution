// SPDX-License-Identifier: Apache-2.0
/** Translation contracts and consumer adapter for the Rust aphrody-translate owner. */
import { z } from "zod";
import { runAphrodyCli, type AphrodyCliOptions } from "./cli";

export const TranslateOptionsSchema = z.object({
  target: z.string().default("en"),
  source: z.string().default("auto"),
  format: z.enum(["text", "html"]).default("text"),
  timeoutMs: z.number().default(10000),
});
export type TranslateOptions = z.infer<typeof TranslateOptionsSchema>;

export const TranslationResultSchema = z.object({
  translatedText: z.string(),
  detectedSource: z.string().default("auto"),
  target: z.string(),
  provider: z.enum(["aphrody-translate", "bxc-cli", "lingva", "mymemory", "gemini-free", "cache"]),
  confidence: z.number().optional(),
});
export type TranslationResult = z.infer<typeof TranslationResultSchema>;

export class AphrodyTranslateService {
  constructor(private readonly defaults: Omit<AphrodyCliOptions, "json"> = {}) {}

  async translate(
    text: string,
    target = "en",
    source = "auto",
    options: Partial<TranslateOptions> & Omit<AphrodyCliOptions, "json"> = {},
  ): Promise<TranslationResult> {
    if (!text.trim())
      return { translatedText: text, detectedSource: source, target, provider: "cache" };
    if (!source.trim() || !target.trim())
      throw new Error("Translation requires source and target languages");
    const result = await runAphrodyCli<unknown>(
      ["translate", "--source", source, "--target", target, "--json", "--", text],
      { timeoutMs: 30_000, ...this.defaults, ...options, json: true },
    );
    if (result.kind === "exit" && result.ok) {
      const translation = TranslationResultSchema.parse(result.data);
      if (translation.target !== target || !translation.translatedText.trim()) {
        throw new Error("Aphrody translation returned an invalid target or empty text");
      }
      return translation;
    }
    if (result.kind === "not_found")
      throw new Error(`Aphrody translation CLI unavailable: ${result.message}`);
    if (result.kind === "timeout")
      throw new Error(`Aphrody translation timed out after ${result.timeoutMs} ms`);
    if (result.kind === "invalid_json")
      throw new Error(`Aphrody translation returned invalid JSON: ${result.error}`);
    throw new Error(
      `Aphrody translation exited ${result.code}: ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
}
