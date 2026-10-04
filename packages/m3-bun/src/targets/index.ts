// SPDX-License-Identifier: Apache-2.0
// The deploy targets of m3-bun. Every target is a pure function from a `TargetContext` to files; `generateTargets`
// writes them below `<out>/<id>/` and nothing else. No target applies anything: no docker push, no flyctl, no
// wrangler deploy, no systemctl, no nginx reload.
import { join } from "node:path";
import { yoloRoot, writeFiles, type GeneratedFile } from "../util.ts";
import type { M3App } from "../config.ts";
import { cloudflare } from "./cloudflare.ts";
import { coolify } from "./coolify.ts";
import { docker } from "./docker.ts";
import { fly } from "./fly.ts";
import { linuxImage } from "./linux-image.ts";
import { nginx } from "./nginx.ts";
import { systemd } from "./systemd.ts";
import type { Target, TargetContext } from "./types.ts";
import { vercel } from "./vercel.ts";
import { vscode } from "./vscode.ts";
import { windows } from "./windows.ts";

export type { Target, TargetContext } from "./types.ts";

export const TARGETS: readonly Target[] = [docker, systemd, nginx, vercel, fly, cloudflare, coolify, vscode, windows, linuxImage];

export function getTarget(id: string): Target {
  const target = TARGETS.find((t) => t.id === id);
  if (!target) throw new Error(`m3-bun: unknown deploy target ${id} (${TARGETS.map((t) => t.id).join(", ")})`);
  return target;
}

/** The context of `app`, with the deploy section of its config applied. */
export function contextFor(app: M3App, overrides: Partial<TargetContext> = {}): TargetContext {
  const deploy = app.bun.deploy ?? {};
  const relativeApi = app.api ? app.api.slice(app.dir.length + 1).replaceAll("\\", "/") : undefined;
  return {
    name: app.name,
    version: app.version,
    port: app.port,
    ...(deploy.domain ? { domain: deploy.domain } : {}),
    image: deploy.image ?? `ghcr.io/aphrody-labs/${app.name}`,
    namespace: deploy.namespace ?? "aphrody",
    user: deploy.user ?? "ubuntu",
    region: deploy.region ?? "cdg",
    binary: app.name,
    outdir: app.outdir.slice(app.dir.length + 1) || "dist",
    ...(relativeApi ? { api: relativeApi } : {}),
    bunVersion: Bun.version,
    yoloRoot: yoloRoot(),
    cli: "bunx --bun m3-bun",
    tls: "letsencrypt",
    ...(app.bun.compile?.windows ? { windows: app.bun.compile.windows } : {}),
    ...overrides,
  };
}

export interface GeneratedTarget {
  id: string;
  dir: string;
  files: string[];
}

/** Generate `ids` (or every target) into `<out>/<id>/`. Returns what was written. */
export async function generateTargets(ids: readonly string[], context: TargetContext, out: string): Promise<GeneratedTarget[]> {
  const targets = ids.length === 0 || ids.includes("all") ? TARGETS : ids.map(getTarget);
  const generated: GeneratedTarget[] = [];
  for (const target of targets) {
    const files: GeneratedFile[] = await target.generate(context);
    const dir = join(out, target.id);
    generated.push({ id: target.id, dir, files: await writeFiles(dir, files) });
  }
  return generated;
}
