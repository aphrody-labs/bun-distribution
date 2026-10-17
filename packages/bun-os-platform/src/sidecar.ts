#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * The platform service for native hosts (crates/bun-os-platform `Sidecar`): JSON lines on stdio.
 *   request  {"id": 1, "method": "files.detect", "params": {"path": "..."}}
 *   response {"id": 1, "result": ...} | {"id": 1, "error": "..."}
 *   event    {"event": "transfer.progress", "data": {...}}
 * Methods mirror the HTTP routes of `server.ts` so the shell and play share one surface.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";
import { detectFile, importFile, previewFile } from "./files";
import { localizer, locales, negotiate } from "./i18n";
import { ensureDir, platformPaths, writeSettings } from "./paths";
import { plugins } from "./plugins";
import { currentTheme, listThemes, loadTheme, resolveTheme } from "./theme";
import { transfers, uploadFile } from "./transfer";

type Params = Record<string, unknown>;
const send = (message: unknown) =>
  process.stdout.write(`${JSON.stringify(message)}\n`);
const str = (p: Params, k: string) =>
  typeof p[k] === "string" ? (p[k] as string) : undefined;

async function menu(locale?: string) {
  const registry = await plugins();
  const { chain } = negotiate({ override: locale, os: true });
  return registry.menuFor(localizer(chain, ["common", "shell"]));
}

const methods: Record<string, (p: Params) => unknown> = {
  hello: () => ({ protocol: 1, pid: process.pid, usr: platformPaths().usr }),
  "i18n.negotiate": (p) => negotiate({ override: str(p, "locale"), os: true }),
  "i18n.locales": () => locales(),
  "settings.set": (p) => writeSettings(p as never),
  "theme.current": async () => resolveTheme(await currentTheme()),
  "theme.resolve": (p) =>
    resolveTheme(loadTheme(str(p, "theme")), {
      dark: typeof p.dark === "boolean" ? p.dark : undefined,
      highContrast: p.highContrast === true,
      seed: str(p, "seed"),
      reducedMotion: p.reducedMotion === true,
    }),
  "theme.list": () =>
    [...listThemes().entries()].map(([id, f]) => ({
      id,
      name: f.name ?? null,
      nameKey: f.nameKey ?? null,
    })),
  "plugins.list": async () => {
    const r = await plugins();
    return {
      loaded: r.plugins.map((p) => ({
        name: p.manifest.name,
        version: p.manifest.version,
        trust: p.trust,
        permissions: p.manifest.permissions,
        digest: p.digest,
      })),
      blocked: r.blocked,
      detectors: r.detectors.length,
      machines: r.machines.map((m) => ({ plugin: m.plugin, id: m.id })),
      sources: r.sources.map((s) => ({ plugin: s.plugin, id: s.id })),
      themes: r.themes.map((t) => t.id),
    };
  },
  "plugins.menu": async (p) => {
    const entries = await menu(str(p, "locale"));
    if (p.push) send({ event: "plugins.menu", data: entries });
    return entries;
  },
  "plugins.run": async (p) =>
    (await plugins()).run(str(p, "command") ?? "", (p.args as Params) ?? {}),
  "files.detect": (p) =>
    detectFile(str(p, "path") ?? "", { magika: p.magika === true }),
  "files.preview": async (p) => {
    const path = str(p, "path") ?? "";
    const preview = await previewFile(path, {
      width: typeof p.width === "number" ? p.width : 320,
    });
    let thumbnail: string | null = null;
    if (preview.thumbnail) {
      // A file the native host loads as an image asset, keyed by path + size.
      const key = createHash("sha256")
        .update(`${path}\0${preview.detection.size}`)
        .digest("hex")
        .slice(0, 24);
      thumbnail = join(
        ensureDir(
          join(platformPaths().usr, "var", "cache", "bun-os", "previews"),
        ),
        `${key}.webp`,
      );
      await Bun.write(thumbnail, preview.thumbnail);
    }
    return { ...preview, thumbnail };
  },
  "files.import": (p) => importFile(str(p, "path") ?? ""),
  "transfer.enqueue": async (p) => (await transfers()).enqueue(p as never),
  "transfer.pause": async (p) => (await transfers()).pause(str(p, "id") ?? ""),
  "transfer.resume": async (p) =>
    (await transfers()).resume(str(p, "id") ?? ""),
  "transfer.cancel": async (p) =>
    (await transfers()).cancel(str(p, "id") ?? ""),
  "transfer.list": async () => (await transfers()).list(),
  "upload.file": (p) =>
    uploadFile(str(p, "path") ?? "", {
      spec: str(p, "spec"),
      key: str(p, "key"),
    }),
};

(await transfers()).addEventListener("progress", (e) =>
  send({ event: "transfer.progress", data: (e as CustomEvent).detail }),
);

let buffer = "";
for await (const chunk of Bun.stdin.stream()) {
  buffer += new TextDecoder().decode(chunk);
  let nl: number;
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let request: { id?: number; method?: string; params?: Params };
    try {
      request = JSON.parse(line);
    } catch {
      continue;
    }
    const { id, method = "", params = {} } = request;
    const handler = methods[method];
    if (!handler) {
      send({ id, error: `unknown method ${method}` });
      continue;
    }
    Promise.resolve()
      .then(() => handler(params))
      .then(
        (result) => send({ id, result: result ?? null }),
        (error) =>
          send({
            id,
            error: error instanceof Error ? error.message : String(error),
          }),
      );
  }
}
process.exit(0);
