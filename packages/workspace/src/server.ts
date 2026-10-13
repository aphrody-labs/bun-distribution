import { mkdir, realpath } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { AppManifest, AppRuntime } from "../../artifacts/src/types.ts";
import { hashContent, runProcess } from "./index.ts";
import {
  createVideoLibrary,
  VideoLibraryError,
  parseNativeJSON,
  stringifyNativeJSON,
  type NativeObject,
  type VideoCommand,
} from "../../video/src/index.ts";

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const reply = (value: unknown, status = 200) =>
  new Response(stringifyNativeJSON(value), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });

/** One application transport binds verified engines; native libraries retain processing. */
export async function startApp(manifest: AppManifest, runtime: AppRuntime): Promise<void> {
  const arguments_ = Bun.argv.slice(2);
  const signal = new AbortController();
  const interrupt = () => signal.abort();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  const limits = { timeoutMs: 30_000, maxOutputBytes: 16 * 1024 * 1024, signal: signal.signal };
  if (arguments_[0] === "--native") {
    try {
      const result = await runProcess([runtime.nativeBinary, ...arguments_.slice(1)], runtime.cwd, {
        ...limits,
        timeoutMs: 3_600_000,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      process.exitCode = result.code;
    } finally {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", interrupt);
    }
    return;
  }
  if (arguments_.length && (arguments_.length !== 1 || arguments_[0] !== "--serve")) {
    throw new Error("Use --native <engine arguments> or --serve.");
  }
  const port = Number(Bun.env.PORT ?? 3000);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535)
    throw new Error("A valid application port is required.");
  const host = Bun.env.HOST ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "::1" && host !== "0.0.0.0")
    throw new Error("Invalid application bind address.");
  const token = Bun.env.APHRODY_APP_TOKEN;
  if (!token || token.length < 32) throw new Error("Inject the application token from its protected store.");
  const tokenDigest = new TextEncoder().encode(hashContent(token));
  await mkdir(runtime.appDataDir, { recursive: true });
  const dataRoot = await realpath(runtime.appDataDir);
  const containedPath = async (value: unknown, output = false): Promise<string> => {
    if (typeof value !== "string" || !value || value.length > 512 || value.includes("\0"))
      throw new Error("A data path is required.");
    const selected = resolve(dataRoot, value);
    const path = output
      ? join(await realpath(dirname(selected)), selected.slice(dirname(selected).length + 1))
      : await realpath(selected);
    const local = relative(dataRoot, path);
    if (!local || local === ".." || local.startsWith(`..${sep}`) || resolve(dataRoot, local) !== path)
      throw new Error("The data path leaves this application.");
    return path;
  };
  const engine = manifest.native.find(file => file.path === manifest.engine.path)!;
  const video =
    manifest.app.id === "video"
      ? await createVideoLibrary({
          binary: runtime.nativeBinary,
          dataDir: join(dataRoot, "presets"),
          ...limits,
          artifact: {
            runtime: runtime.runtime,
            version: "0.7.2",
            sourceRevision: manifest.source.revision,
            sha256: engine.sha256,
            cwd: runtime.cwd,
          },
        })
      : undefined;
  let active = 0;
  const server = Bun.serve({
    port,
    hostname: host,
    maxRequestBodySize: 1_048_576,
    idleTimeout: 60,
    async fetch(request) {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/healthz")
        return reply({ status: "ready", app: manifest.app.id, runtime: runtime.runtime.version });
      const authorization = request.headers.get("Authorization");
      if (
        !authorization?.startsWith("Bearer ") ||
        !timingSafeEqual(new TextEncoder().encode(hashContent(authorization.slice(7))), tokenDigest)
      )
        return reply({ error: "Authentication required." }, 401);
      if (
        request.headers.get("Sec-Fetch-Site") === "cross-site" ||
        (request.headers.get("Origin") && request.headers.get("Origin") !== url.origin)
      )
        return reply({ error: "Origin denied." }, 403);
      if (request.method === "GET" && url.pathname === "/api/catalog")
        return reply({
          identity: manifest.identity,
          app: manifest.app,
          sharedAssets: manifest.sharedAssets,
          protocol: manifest.engine.protocol,
          operations: video ? ["commands", "describe", "inspect", "probe", "run"] : ["help"],
          native: "Use --native for the complete native engine CLI.",
        });
      if (active >= 2) return reply({ error: "Application is busy." }, 429);
      active++;
      try {
        if (request.method === "GET" && url.pathname === "/api/help") {
          const result = await runProcess([runtime.nativeBinary, "--help"], runtime.cwd, limits);
          if (result.code) return reply({ error: "Native help failed." }, 502);
          return new Response(result.stdout, { headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" } });
        }
        if (video && request.method === "POST" && url.pathname === "/api/video") {
          const value = parseNativeJSON<NativeObject>(await request.text());
          if (!value || typeof value !== "object" || Array.isArray(value))
            return reply({ error: "A video request is required." }, 400);
          switch (value.operation) {
            case "commands":
              return reply(await video.commands(typeof value.filter === "string" ? value.filter : undefined));
            case "describe": {
              if (typeof value.id !== "string") break;
              return reply(await video.describe(value.id));
            }
            case "inspect": {
              const path = await containedPath(value.path);
              return reply(
                value.kind === "project" ? await video.inspect(path, "project") : await video.inspect(path, "sequence"),
              );
            }
            case "probe":
              return reply(await video.probe(await containedPath(value.path)));
            case "run": {
              if (
                !Array.isArray(value.commands) ||
                value.commands.length > 1000 ||
                value.commands.some(
                  command =>
                    !command || typeof command !== "object" || Array.isArray(command) || typeof command.id !== "string",
                )
              )
                break;
              const commands = value.commands as unknown as VideoCommand[];
              // Commands can reference media paths; full editing remains the local CLI contract
              // until the native owner offers filesystem confinement for every parameter.
              const allowed = new Set(["sequence.addEdit", "sequence.addEditAllTracks", "sequence.addTracks"]);
              if (commands.some(command => !allowed.has(command.id)))
                return reply({ error: "Use the native CLI for this command." }, 403);
              return reply(
                await video.run(await containedPath(value.path), commands, {
                  saveAs: value.saveAs === undefined ? undefined : await containedPath(value.saveAs, true),
                }),
              );
            }
          }
          return reply({ error: "Unsupported video request." }, 400);
        }
        return reply({ error: "Not found." }, 404);
      } catch (error) {
        if (error instanceof VideoLibraryError)
          return reply({ error: error.code, exitCode: error.exitCode, result: error.result }, 400);
        return reply({ error: "Invalid or unavailable application input." }, 400);
      } finally {
        active--;
      }
    },
  });
  const stop = () => {
    server.stop(true);
  };
  signal.signal.addEventListener("abort", stop, { once: true });
  if (signal.signal.aborted) stop();
  console.log(`Aphrody ${manifest.app.title}: ${server.url}`);
}
