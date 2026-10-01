// SPDX-License-Identifier: Apache-2.0
/** Consumer adapter for Aphrody Web's Rust-owned media resolver. */
import { z } from "zod";
import { runAphrodyCli, type AphrodyCliOptions } from "./cli";

export const AphrodyResolvedMediaSchema = z.object({
  host: z.string(),
  embedUrl: z.string(),
  kind: z.enum(["hls", "dash", "mp4", "unknown"]),
  url: z.string().nullable().optional(),
  candidates: z.array(
    z.object({
      url: z.string(),
      kind: z.enum(["hls", "dash", "mp4", "unknown"]),
      rule: z.string(),
      confidence: z.number(),
      offset: z.number(),
      layer: z.number(),
      label: z.string().optional(),
    }),
  ),
  variants: z.array(
    z.object({
      url: z.string(),
      bandwidth: z.number().nullable().optional(),
      averageBandwidth: z.number().nullable().optional(),
      width: z.number().nullable().optional(),
      height: z.number().nullable().optional(),
      codecs: z.string().nullable().optional(),
      frameRate: z.number().nullable().optional(),
      name: z.string().nullable().optional(),
      label: z.string().nullable().optional(),
    }),
  ),
  headers: z.record(z.string(), z.string()),
  poster: z.string().nullable().optional(),
  expiresAt: z.number().nullable().optional(),
  error: z.string().optional(),
});
export type AphrodyResolvedMedia = z.infer<typeof AphrodyResolvedMediaSchema>;

/** Shenron's existing Voiranime compatibility shape, populated by the generic owner. */
export const AphrodyResolvedSourceSchema = z.object({
  host: z.string().default("unknown"),
  originalUrl: z.string().optional(),
  directUrl: z.string().optional(),
  hlsUrl: z.string().optional(),
  qualities: z.record(z.string(), z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  error: z.string().optional(),
});
export type AphrodyResolvedSource = z.infer<typeof AphrodyResolvedSourceSchema>;

export const AphrodyResolvedStreamSchema = z.object({
  url: z.string(),
  headers: z.record(z.string(), z.string()).default({}),
  type: z.string().default("application/x-mpegURL"),
  provider: z.string().optional(),
  at: z.number().default(() => Date.now()),
});
export type AphrodyResolvedStream = z.infer<typeof AphrodyResolvedStreamSchema>;

export interface AphrodyMediaOptions extends Omit<AphrodyCliOptions, "json"> {
  referer?: string;
  enumerateVariants?: boolean;
}

function validateEmbedUrl(value: string): string {
  const url = new URL(value);
  if (!(url.protocol === "http:" || url.protocol === "https:") || url.username || url.password) {
    throw new Error("Media embed URL must be HTTP(S) and must not contain credentials");
  }
  return url.href;
}

function errorMessage(
  result: Exclude<Awaited<ReturnType<typeof runAphrodyCli>>, { kind: "exit"; ok: true }>,
  label: string,
): string {
  if (result.kind === "not_found") return `Aphrody media CLI unavailable: ${result.message}`;
  if (result.kind === "timeout")
    return `Aphrody media resolution timed out after ${result.timeoutMs} ms`;
  if (result.kind === "invalid_json") return `Aphrody media returned invalid JSON: ${result.error}`;
  return `${label} exited ${result.code}: ${result.stderr.trim() || result.stdout.trim()}`;
}

export class AphrodyMediaService {
  constructor(
    private readonly defaults: Omit<AphrodyMediaOptions, "referer" | "enumerateVariants"> = {},
  ) {}

  async resolve(
    embedUrl: string,
    options: AphrodyMediaOptions = {},
  ): Promise<AphrodyResolvedMedia> {
    const url = validateEmbedUrl(embedUrl.trim());
    const merged = { ...this.defaults, ...options };
    const args = ["web", "media", "resolve", url];
    if (options.referer) args.push("--referer", options.referer);
    if (options.enumerateVariants !== false) args.push("--variants");
    if (merged.timeoutMs !== undefined) args.push("--timeout-ms", String(merged.timeoutMs));
    const result = await runAphrodyCli<unknown>(args, { ...merged, json: true });
    if (result.kind === "exit" && result.ok) {
      const media = AphrodyResolvedMediaSchema.parse(result.data);
      if (media.embedUrl !== url) throw new Error("Aphrody media returned a different embed URL");
      if (media.error) throw new Error(`Aphrody media resolution failed: ${media.error}`);
      if (!media.url && media.candidates.length === 0)
        throw new Error("Aphrody media returned no playable URL or candidates");
      return media;
    }
    throw new Error(errorMessage(result, "Aphrody media resolution"));
  }

  async resolveSource(
    embedUrl: string,
    options: AphrodyMediaOptions = {},
  ): Promise<AphrodyResolvedSource> {
    const media = await this.resolve(embedUrl, options);
    const qualities: Record<string, string> = {};
    for (const variant of media.variants) {
      const quality =
        variant.label ?? variant.name ?? (variant.height ? `${variant.height}p` : undefined);
      if (quality) qualities[quality] = variant.url;
    }
    const direct = media.url ?? media.candidates[0]?.url;
    return AphrodyResolvedSourceSchema.parse({
      host: media.host,
      originalUrl: media.embedUrl,
      ...(media.kind === "hls" ? { hlsUrl: direct } : direct ? { directUrl: direct } : {}),
      ...(Object.keys(qualities).length ? { qualities } : {}),
      headers: media.headers,
    });
  }

  async resolveStream(
    embedUrl: string,
    options: AphrodyMediaOptions = {},
  ): Promise<AphrodyResolvedStream> {
    const media = await this.resolve(embedUrl, options);
    const selected = media.url ?? media.candidates[0]?.url;
    if (!selected) throw new Error("Aphrody media returned no playable stream URL");
    const type =
      media.kind === "dash"
        ? "application/dash+xml"
        : media.kind === "mp4"
          ? "video/mp4"
          : "application/x-mpegURL";
    return AphrodyResolvedStreamSchema.parse({
      url: selected,
      headers: media.headers,
      type,
      provider: media.host,
    });
  }
}
