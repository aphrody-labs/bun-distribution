// SPDX-License-Identifier: Apache-2.0
// Local showcase computations. Providers, credentials and OS writes stay with their native owners.
import { defineM3Api } from "@aphrody/m3-bun/api";
import { DesignCompiler } from "@aphrody/m3-design";
import { generate, TARGETS, type Target, type ThemeInput } from "@aphrody/m3-os-themes";
import {
  generateM3Metadata,
  generateM3Viewport,
  m3JsonLd,
  m3RobotsTxt,
  m3SchemeColors,
  m3SchemeStylesheet,
  m3SitemapXml,
  withM3,
} from "@aphrody/m3-next";
import { ownerM3Version, renderTemplate, TEMPLATES } from "@aphrody/scaffold";
import { transformSource, type MigrationKind } from "@aphrody/m3-codemods";
import lintPlugin from "@aphrody/eslint-plugin-m3";
import { PACKAGES } from "../../../src/material/inventory.ts";
import { FIXTURE_HEADERS, fixtureStream } from "../../../src/material/ai-fixture.ts";

class InputError extends Error {}
const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
const guarded =
  (handler: (request: Request) => Response | Promise<Response>) => async (request: Request) => {
    try {
      return await handler(request);
    } catch (error) {
      return json(
        {
          error:
            error instanceof InputError
              ? error.message
              : "The local computation could not be completed.",
        },
        error instanceof InputError ? 400 : 500,
      );
    }
  };

/** Bound incoming JSON before parsing; no conversation or user source is persisted. */
async function readJson(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new InputError("A JSON request body is required.");
  const decoder = new TextDecoder();
  let body = "",
    bytes = 0;
  try {
    // eslint-disable-next-line no-await-in-loop -- The next request-body chunk depends on the previous read.
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      bytes += chunk.value.byteLength;
      if (bytes > 65_536) {
        // eslint-disable-next-line no-await-in-loop -- Stop the sequential request stream before rejecting oversized input.
        await reader.cancel();
        throw new InputError("The request body exceeds 64 KiB.");
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new InputError("The request body must be valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new InputError("The request body must be an object.");
  return value as Record<string, unknown>;
}
function textInput(value: unknown, name: string, limit = 2000): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit)
    throw new InputError(name + " must be a non-empty string of at most " + limit + " characters.");
  return value;
}
function themeInput(url: URL): ThemeInput {
  const seed = url.searchParams.get("seed") ?? "#8c6c88";
  const mode = url.searchParams.get("mode") ?? "auto";
  if (!/^#[a-f\d]{6}$/i.test(seed)) throw new InputError("seed must be #rrggbb.");
  if (!["light", "dark", "auto"].includes(mode))
    throw new InputError("mode must be light, dark or auto.");
  return { name: "Showcase", seed, mode: mode as ThemeInput["mode"] };
}
function targetsFor(url: URL): readonly Target[] {
  const target = url.searchParams.get("target") ?? "all";
  if (target === "all") return TARGETS;
  if (!(TARGETS as readonly string[]).includes(target))
    throw new InputError("Unknown OS theme target.");
  return [target as Target];
}

async function discoverMcpTools(): Promise<unknown[]> {
  const { listM3Tools } = await import("@aphrody/m3-mcp");
  return listM3Tools();
}

export default defineM3Api({
  "/api/packages": () =>
    Response.json(PACKAGES, { headers: { "Cache-Control": "public, max-age=60" } }),
  "/api/package": (request) => {
    const name = new URL(request.url).searchParams.get("name");
    const found = PACKAGES.find((p) => p.name === name);
    return found ? json(found) : json({ error: "Unknown package " + String(name) }, 404);
  },
  "/api/echo": {
    POST: guarded(async (request) =>
      json({
        received: await readJson(request),
        method: request.method,
        contentType: request.headers.get("content-type"),
      }),
    ),
  },
  "/api/ai/stream": {
    POST: guarded(
      async (request) =>
        new Response(
          fixtureStream(textInput((await readJson(request)).prompt, "prompt"), request.signal),
          { headers: FIXTURE_HEADERS },
        ),
    ),
  },
  "/api/design": {
    POST: guarded(async (request) => {
      const body = await readJson(request);
      const brief = textInput(body.brief, "brief");
      const seed = body.seed === undefined ? undefined : textInput(body.seed, "seed", 7);
      if (seed !== undefined && !/^#[a-f\d]{6}$/i.test(seed))
        throw new InputError("seed must be #rrggbb.");
      return json(new DesignCompiler().compile(brief, seed));
    }),
  },
  "/api/next": guarded((request) => {
    const url = new URL(request.url);
    const theme = themeInput(url);
    const options = { seed: theme.seed };
    return json({
      metadata: generateM3Metadata({
        name: "Aphrody M3 Showcase",
        description: "An adaptive Material 3 component showcase.",
        url: url.origin,
      }),
      viewport: generateM3Viewport(options),
      schemeCss: m3SchemeStylesheet(
        m3SchemeColors(options),
        m3SchemeColors({ ...options, dark: true }),
      ),
      config: withM3({}),
      robots: m3RobotsTxt({ origin: url.origin, rules: [{ userAgent: "*", disallow: ["/api/"] }] }),
      sitemap: m3SitemapXml(["/", "/theme", "/components"], url.origin),
      jsonLd: m3JsonLd({
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: "Aphrody M3 Showcase",
        applicationCategory: "DesignApplication",
        url: url.origin,
      }),
    });
  }),
  "/api/system": guarded(async (request) => {
    const url = new URL(request.url);
    const files = generate(themeInput(url), targetsFor(url));
    const sample = renderTemplate({
      template: "web",
      name: "m3-demo",
      m3Version: ownerM3Version(),
    });
    return json({
      themeFiles: files.map((file) => ({
        target: file.target,
        path: file.path,
        bytes:
          typeof file.content === "string"
            ? Buffer.byteLength(file.content)
            : file.content.byteLength,
        binary: typeof file.content !== "string",
      })),
      templates: TEMPLATES,
      scaffold: sample,
      mcpTools: await discoverMcpTools(),
      lintRules: Object.entries(lintPlugin.rules).map(([name, rule]) => ({
        name,
        description: rule.meta.docs?.description ?? "",
      })),
      migration: transformSource(
        'import { Button } from "@mui/material"; export default () => <Button variant="contained">Save</Button>;',
      ),
    });
  }),
  "/api/os-theme": guarded((request) => {
    const url = new URL(request.url);
    const path = url.searchParams.get("path");
    const file = generate(themeInput(url), targetsFor(url)).find((item) => item.path === path);
    if (!file) return json({ error: "Unknown generated theme file." }, 404);
    if (typeof file.content !== "string")
      return new Response(file.content as unknown as BodyInit, {
        headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
      });
    return json({ path: file.path, content: file.content });
  }),
  "/api/migrate": {
    POST: guarded(async (request) => {
      const body = await readJson(request);
      const source = textInput(body.source, "source", 40_000);
      const kind = body.kind ?? "mui";
      if (kind !== "mui" && kind !== "icons") throw new InputError("kind must be mui or icons.");
      try {
        return json(transformSource(source, kind as MigrationKind));
      } catch {
        throw new InputError("The source must be valid TSX.");
      }
    }),
  },
});
