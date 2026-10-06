#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Aphrody download server: a read-only Bun.serve app behind nginx (config/host/nginx/aphrody/
 * downloads.aphrody.com.conf). It serves one published release tree and never mutates anything.
 *
 *   <root>/latest.json        manifest: artifacts with name, version, platform, url, sha256, size
 *   <root>/SHA256SUMS         `<sha256>  <file>` for every artifact of the release
 *   <root>/install.sh|.ps1    one-line installers
 *   <root>/files/<file>       artifacts, each next to its `<file>.sha256`
 *
 * `<root>` is the `current` symlink that scripts/release/publish-downloads.ts flips atomically.
 * Environment: DOWNLOADS_ROOT (default /srv/aphrody-downloads/current), DOWNLOADS_PORT (8797),
 * DOWNLOADS_HOST (127.0.0.1).
 */
import { realpathSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";

export interface Artifact {
  name: string;
  version: string;
  platform: string;
  target?: string;
  kind?: string;
  url: string;
  sha256: string;
  size: number;
  file?: string;
  provides?: string[];
}

export interface Manifest {
  schemaVersion: number;
  generatedAt: string;
  release: { id: string; commit?: string };
  baseUrl: string;
  artifacts: Artifact[];
  notes?: string[];
}

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy":
    "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

const TEXT_TYPES: Record<string, string> = {
  ".sh": "text/x-shellscript; charset=utf-8",
  ".ps1": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".sha256": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

// The Aphrody pet, idle track of crates/ui/identity (atlas row 0, six timed cells), drawn by CSS
// at half scale from /pet.webp so the page carries no script for it.
const PET = { cell: [192, 208], atlas: [1536, 2288], idle: [280, 110, 110, 140, 140, 320] };
const petKeyframes = (): string => {
  const total = PET.idle.reduce((a, b) => a + b, 0);
  let at = 0;
  return PET.idle
    .map((ms, i) => {
      const pct = ((at / total) * 100).toFixed(2);
      at += ms;
      return `${pct}%{background-position:-${(i * PET.cell[0]) / 2}px 0}`;
    })
    .join("");
};

const cmd = (label: string, text: string) =>
  `<button class="cmd" data-copy="${text}" aria-label="Copy ${label} command"><span>${label}</span><code>${text}</code></button>`;

export function renderIndex(manifest: Manifest | null): string {
  const base = escapeHtml(manifest?.baseUrl ?? "https://downloads.aphrody.com");
  const desktop = (manifest?.artifacts ?? []).find(
    (a) => a.kind === "desktop" || /desktop|studio/i.test(a.name),
  );
  const button = desktop
    ? `<a class="btn" href="${escapeHtml(desktop.url)}">Download Aphrody</a>`
    : `<span class="btn off" aria-disabled="true">Download Aphrody</span>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Aphrody</title>
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<style>
/* M3 tonal-spot roles from the Aphrody pet seed #8c6c88 (m3/packages/identity PET_COLORS). */
:root{--md-sys-color-background:#fff7fa;--md-sys-color-on-background:#201a1e;--md-sys-color-primary:#7e4d7c;--md-sys-color-on-primary:#fff;--md-sys-color-surface-container:#f7ebf1;--md-sys-color-on-surface-variant:#4e444b;--md-sys-color-outline-variant:#d1c3cc}
@media (prefers-color-scheme:dark){:root{--md-sys-color-background:#171216;--md-sys-color-on-background:#ebdfe6;--md-sys-color-primary:#efb4e9;--md-sys-color-on-primary:#4b1f4b;--md-sys-color-surface-container:#241e22;--md-sys-color-on-surface-variant:#d1c3cc;--md-sys-color-outline-variant:#4e444b}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--md-sys-color-background);color:var(--md-sys-color-on-background);font:16px/1.5 Roboto,system-ui,sans-serif}
main{width:min(100% - 2rem,26rem);display:grid;gap:1rem;justify-items:center;padding:2rem 0}
.pet{width:96px;height:104px;background:url(/pet.webp) 0 0/768px 1144px no-repeat;animation:idle 1.1s step-end infinite}
@keyframes idle{${petKeyframes()}}
@media (prefers-reduced-motion:reduce){.pet{animation:none}}
h1{font:400 2.25rem/2.75rem Roboto,system-ui,sans-serif;margin:0;letter-spacing:0}
.btn{position:relative;display:inline-flex;align-items:center;height:40px;padding:0 24px;border-radius:20px;background:var(--md-sys-color-primary);color:var(--md-sys-color-on-primary);text-decoration:none;font:500 .875rem/1.25rem Roboto,system-ui,sans-serif;letter-spacing:.1px;overflow:hidden}
.btn::after{content:"";position:absolute;inset:0;background:currentColor;opacity:0;transition:opacity .15s}
.btn:hover::after{opacity:.08}.btn:focus-visible::after,.btn:active::after{opacity:.12}
.btn.off{opacity:.38;pointer-events:none}
.cmd{display:grid;gap:.25rem;width:100%;min-height:48px;box-sizing:border-box;text-align:left;padding:.75rem 1rem;border:1px solid var(--md-sys-color-outline-variant);border-radius:12px;background:var(--md-sys-color-surface-container);color:inherit;cursor:pointer;font:inherit;transition:background .15s}
.cmd:hover{background:color-mix(in srgb,var(--md-sys-color-on-background) 8%,var(--md-sys-color-surface-container))}
:is(.btn,.cmd):focus-visible{outline:3px solid var(--md-sys-color-primary);outline-offset:2px}
.cmd span{font-size:.75rem;letter-spacing:.5px;color:var(--md-sys-color-on-surface-variant)}
.cmd code{font:13px/1.4 ui-monospace,monospace;word-break:break-all}
.cmd.ok span::after{content:" \u00B7 copied";color:var(--md-sys-color-primary)}
</style></head><body><main>
<div class="pet" role="img" aria-label="Aphrody"></div>
<h1>Aphrody</h1>
${button}
${cmd("Linux / macOS", `curl -fsSL ${base}/install.sh | sh`)}
${cmd("Windows", `irm ${base}/install.ps1 | iex`)}
<script>for(const b of document.querySelectorAll(".cmd"))b.onclick=()=>{navigator.clipboard.writeText(b.dataset.copy).then(()=>{b.classList.add("ok");setTimeout(()=>b.classList.remove("ok"),1500)})}</script>
</main></body></html>
`;
}

export function resolveFile(root: string, name: string): string | null {
  if (name === "" || name.includes("\0") || name.includes("/") || name.includes("\\")) return null;
  if (name.startsWith(".")) return null;
  const base = resolve(root, "files");
  const candidate = join(base, name);
  try {
    const real = realpathSync(candidate);
    const realBase = realpathSync(base);
    return real.startsWith(realBase + sep) ? real : null;
  } catch {
    return null;
  }
}

function parseRange(header: string | null, size: number): [number, number] | "invalid" | null {
  if (header === null) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return "invalid";
  const [, startText, endText] = match;
  if (startText === "" && endText === "") return "invalid";
  let start: number;
  let end: number;
  if (startText === "") {
    const suffix = Number(endText);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText === "" ? size - 1 : Math.min(Number(endText), size - 1);
  }
  if (start > end || start >= size) return "invalid";
  return [start, end];
}

function withHeaders(init: Record<string, string>): Headers {
  return new Headers({ ...SECURITY_HEADERS, ...init });
}

async function readManifest(root: string): Promise<Manifest | null> {
  try {
    return (await Bun.file(join(root, "latest.json")).json()) as Manifest;
  } catch {
    return null;
  }
}

export function createHandler(rootInput: string): (request: Request) => Promise<Response> {
  const root = resolve(rootInput);
  return async (request) => {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("method not allowed", {
        status: 405,
        headers: withHeaders({ allow: "GET, HEAD" }),
      });
    }
    const head = request.method === "HEAD";
    const path = url.pathname;

    if (path === "/health" || path === "/healthz") {
      const manifest = await readManifest(root);
      const body = JSON.stringify({
        ok: manifest !== null,
        release: manifest?.release.id ?? null,
        artifacts: manifest?.artifacts.length ?? 0,
      });
      return new Response(head ? null : body, {
        status: manifest ? 200 : 503,
        headers: withHeaders({ "content-type": "application/json", "cache-control": "no-store" }),
      });
    }

    if (path === "/" || path === "/index.html") {
      const html = renderIndex(await readManifest(root));
      return new Response(head ? null : html, {
        headers: withHeaders({
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=60",
        }),
      });
    }

    if (
      [
        "/latest.json",
        "/SHA256SUMS",
        "/install.sh",
        "/install.ps1",
        "/install-yolo.sh",
        "/pet.webp",
        "/icon.svg",
      ].includes(path)
    ) {
      const file = Bun.file(join(root, path.slice(1)));
      if (!(await file.exists()))
        return new Response("not found", { status: 404, headers: withHeaders({}) });
      const ext = path.slice(path.lastIndexOf("."));
      return new Response(head ? null : file, {
        headers: withHeaders({
          "content-type": TEXT_TYPES[ext] ?? "text/plain; charset=utf-8",
          "cache-control": "public, max-age=60",
          "access-control-allow-origin": "*",
        }),
      });
    }

    if (path.startsWith("/files/")) {
      let name: string;
      try {
        name = decodeURIComponent(path.slice("/files/".length));
      } catch {
        return new Response("bad request", { status: 400, headers: withHeaders({}) });
      }
      const real = resolveFile(root, name);
      if (real === null)
        return new Response("not found", { status: 404, headers: withHeaders({}) });
      const file = Bun.file(real);
      const size = file.size;
      const type = TEXT_TYPES[name.slice(name.lastIndexOf("."))] ?? "application/octet-stream";
      const headers = withHeaders({
        "content-type": type,
        "accept-ranges": "bytes",
        "cache-control": "public, max-age=31536000, immutable",
        "content-disposition": `attachment; filename="${basename(real).replace(/"/g, "")}"`,
      });
      const range = parseRange(request.headers.get("range"), size);
      if (range === "invalid") {
        headers.set("content-range", `bytes */${size}`);
        return new Response(null, { status: 416, headers });
      }
      if (range === null) {
        headers.set("content-length", String(size));
        return new Response(head ? null : file, { headers });
      }
      const [start, end] = range;
      headers.set("content-range", `bytes ${start}-${end}/${size}`);
      headers.set("content-length", String(end - start + 1));
      return new Response(head ? null : file.slice(start, end + 1), { status: 206, headers });
    }

    return new Response("not found", { status: 404, headers: withHeaders({}) });
  };
}

if (import.meta.main) {
  const root = process.env.DOWNLOADS_ROOT ?? "/srv/aphrody-downloads/current";
  const port = Number(process.env.DOWNLOADS_PORT ?? 8797);
  const hostname = process.env.DOWNLOADS_HOST ?? "127.0.0.1";
  const handler = createHandler(root);
  const server = Bun.serve({ port, hostname, idleTimeout: 120, fetch: handler });
  console.log(
    `aphrody-downloads listening on http://${server.hostname}:${server.port} (root ${root})`,
  );
}
