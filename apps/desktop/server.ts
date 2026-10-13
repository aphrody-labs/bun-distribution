import { join, resolve } from "node:path";
import { serveForTauri } from "@aphrody/tauri/server";
import { assertRuntime, findWorkspace, listModuleStatus, loadConfig, runModule } from "@aphrody/bun-workspace";
import { capabilityFor, type Catalog, type Inspection } from "./shared.ts";
import { nativeVideoCapabilities } from "@aphrody/bun-video-project/native";

const root = await findWorkspace();
const config = await loadConfig(root);
assertRuntime(config);
const session = crypto.randomUUID();
const inspections = new Map<string, Inspection>();
const staticRoot = Bun.env.APHRODY_WEB_ROOT ? resolve(Bun.env.APHRODY_WEB_ROOT) : join(import.meta.dir, "web");
const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers });
}

async function catalog(): Promise<Catalog> {
  const statuses = await listModuleStatus(config, root);
  return {
    runtime: { version: config.runtime.version, repository: config.runtime.repository },
    video: { nativeAvailable: nativeVideoCapabilities().available },
    libraries: config.modules
      .filter(module => module.kind === "library")
      .map(module => {
        const status = statuses.find(item => item.id === module.id);
        return {
          id: module.id,
          priority: config.priorities?.includes(module.id) ?? false,
          ...capabilityFor(module.id),
          license: module.license,
          initialized: status?.initialized ?? false,
          inspectable: status?.launchable ?? false,
          inspectReason: status?.launchable ? undefined : "No headless CLI is configured.",
        };
      }),
    inspections: [...inspections.values()],
    session,
  };
}

const server = serveForTauri({
  port: Bun.env.PORT ? Number(Bun.env.PORT) : 0,
  maxRequestBodySize: 1024,
  async fetch(request) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    if ((origin && origin !== url.origin) || request.headers.get("Sec-Fetch-Site") === "cross-site")
      return json({ error: "Origin denied." }, 403);
    if (request.method === "OPTIONS") return json({ error: "Origin denied." }, 403);
    try {
      if (url.pathname === "/api/catalog" && request.method === "GET") return json(await catalog());
      if (url.pathname === "/api/inspect" && request.method === "POST") {
        if (request.headers.get("X-Aphrody-Session") !== session) return json({ error: "Invalid session." }, 403);
        const payload: unknown = await request.json();
        if (
          !payload ||
          typeof payload !== "object" ||
          Object.keys(payload).length !== 1 ||
          !("id" in payload) ||
          typeof payload.id !== "string"
        )
          return json({ error: "A catalog identifier is required." }, 400);
        const module = config.modules.find(item => item.id === payload.id && item.kind === "library");
        if (!module) return json({ error: "Unknown library." }, 404);
        if ([...inspections.values()].some(item => item.libraryId === module.id && item.state === "running"))
          return json({ error: "CLI inspection is already running." }, 409);
        // Reserve before status discovery so concurrent requests cannot start duplicate jobs.
        const inspection: Inspection = {
          id: crypto.randomUUID(),
          libraryId: module.id,
          state: "running",
          startedAt: new Date().toISOString(),
        };
        inspections.set(inspection.id, inspection);
        try {
          const library = (await catalog()).libraries.find(item => item.id === module.id);
          if (!library?.inspectable) {
            inspections.delete(inspection.id);
            return json({ error: "No headless CLI is available." }, 409);
          }
        } catch {
          inspections.delete(inspection.id);
          return json({ error: "Library status is unavailable." }, 503);
        }
        void runModule(config, module.id, ["--help"], { root, timeoutMs: 30_000 })
          .then(code => {
            inspection.state = code === 0 ? "completed" : "failed";
            inspection.exitCode = code;
          })
          .catch(() => {
            inspection.state = "failed";
          });
        if (inspections.size > 64) {
          for (const [id, item] of inspections) {
            if (item.state !== "running") {
              inspections.delete(id);
              break;
            }
          }
        }
        return json(inspection, 202);
      }
      if (url.pathname.startsWith("/api/")) return json({ error: "Unknown route." }, 404);
      if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers });
      const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      if (!["index.html", "app.js", "style.css"].includes(name)) return new Response(null, { status: 404, headers });
      const file = Bun.file(join(staticRoot, name));
      if (!(await file.exists()))
        return new Response("Frontend unavailable. Run bun run build.", { status: 503, headers });
      return new Response(request.method === "HEAD" ? null : file, { headers });
    } catch {
      return json({ error: "Request failed." }, 500);
    }
  },
});

console.log("Aphrody: " + server.url);
