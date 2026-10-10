// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildApp } from "../../src/app/build.ts";
import {
  compileAppRouter,
  DOCKER_BASE_IMAGE,
  dockerAppRouter,
  embeddedFiles,
  renderDockerfile,
  renderDockerServer,
  renderExecutableEntry,
} from "../../src/app/compile.ts";
import { embeddedSource, loadAppSource, relativeFile } from "../../src/app/host.ts";
import { tempDir } from "../helpers.ts";

const FIXTURE = join(import.meta.dir, "../fixtures/app-router");
const ORIGIN = "http://localhost";
const project = { root: FIXTURE, appDir: "app", outDir: join(FIXTURE, "dist"), port: 3000 };

let tmp: Awaited<ReturnType<typeof tempDir>>;
let outDir: string;

beforeAll(async () => {
  tmp = await tempDir("m3-compile-");
  outDir = join(tmp.dir, "dist");
  await buildApp({ root: FIXTURE, outDir, buildId: "compile" });
}, 120_000);
afterAll(() => tmp?.[Symbol.asyncDispose]());

describe("relativeFile", () => {
  test.each([
    ["boot-1.js", "boot-1.js"],
    ["media/a.png", "media/a.png"],
    ["../manifest.json", undefined],
    ["a/../../x", undefined],
    ["./a.js", undefined],
    ["a//b.js", undefined],
    ["", undefined],
    ["a\\..\\b", undefined],
    ["a\0.js", undefined],
  ] as const)("%j", (path, expected) => {
    expect(relativeFile(path)).toBe(expected);
  });
});

describe("generated files", () => {
  test("the executable entry imports the server layers lazily and embeds the other files", () => {
    const entry = renderExecutableEntry({
      host: "C:\\m3\\host.ts",
      outDir: "/out",
      manifest: { rscEntry: "server/rsc/rsc.js", ssrEntry: "server/ssr/ssr.js" },
      files: [["client/boot-1.js", "/out/client/boot-1.js"]],
      port: 4000,
    });
    expect(entry).toContain(`import { serveEmbeddedApp } from "C:/m3/host.ts";`);
    expect(entry).toContain(`rsc: () => import("/out/server/rsc/rsc.js"),`);
    expect(entry).toContain(`ssr: () => import("/out/server/ssr/ssr.js"),`);
    expect(entry).toContain(`import file0 from "/out/client/boot-1.js" with { type: "file" };`);
    expect(entry).toContain(`"client/boot-1.js": file0,`);
    expect(entry).toContain("process.env.PORT ?? 4000");
    expect(entry).not.toMatch(/^import \* as/m);
  });

  test("embedded files leave out the server layers and the manifest", async () => {
    const files = (await embeddedFiles(outDir)).map(([path]) => path);
    expect(files.some((path) => path.startsWith("client/boot-"))).toBe(true);
    expect(files).toContain("static/hello.txt");
    expect(files.filter((path) => path.startsWith("server/") || path === "manifest.json")).toEqual(
      [],
    );
  });

  test("Dockerfile and server.js", () => {
    const dockerfile = renderDockerfile({ base: DOCKER_BASE_IMAGE, port: 3000 });
    expect(dockerfile).toContain(
      `ARG BASE=ghcr.io/aphrody-labs/alpine:3.24-runtime\nFROM \${BASE}`,
    );
    expect(dockerfile).toContain("COPY --chown=agent:agent dist ./dist");
    expect(dockerfile).toContain(`CMD ["bun", "server.js"]`);
    const server = renderDockerServer("C:\\m3\\host.ts", 3000);
    expect(server).toContain(`import { serveApp } from "C:/m3/host.ts";`);
    expect(server).toContain(`outDir: join(import.meta.dir, "dist")`);
  });
});

describe("embedded source", () => {
  test("serves assets, public files and pages from the file table only", async () => {
    const manifest = await Bun.file(join(outDir, "manifest.json")).json();
    const files = Object.fromEntries(await embeddedFiles(outDir));
    const app = await loadAppSource(
      embeddedSource({
        manifest,
        files,
        rsc: () => import(join(outDir, manifest.rscEntry)),
        ssr: () => import(join(outDir, manifest.ssrEntry)),
      }),
    );
    expect(app.outDir).toBe("embedded");
    const get = (path: string) => app.fetch(new Request(ORIGIN + path));
    const boot = await get(`/_m3/${manifest.bootstrap}`);
    expect(boot.headers.get("cache-control")).toContain("immutable");
    expect((await boot.text()).length).toBeGreaterThan(1000);
    expect(await (await get("/hello.txt")).text()).toBe("fixture static\n");
    expect((await get("/_m3/missing.js")).status).toBe(404);
    expect((await get("/_m3/..%5Cmanifest.json")).status).toBe(404);
    const home = await get("/");
    expect(await home.text()).toContain("Home page");
    expect(home.status).toBe(200);
  });
});

describe("m3 compile", () => {
  test("links one executable that serves the build from any directory", async () => {
    const outfile = join(tmp.dir, "bin", process.platform === "win32" ? "fixture.exe" : "fixture");
    const report = await compileAppRouter({
      project,
      outDir,
      outfile,
      build: false,
      cacheDir: join(tmp.dir, "cache"),
    });
    expect(report.outfile).toBe(outfile);
    expect(report.files).toBeGreaterThan(3);
    expect(existsSync(outfile)).toBe(true);

    await using proc = Bun.spawn([outfile], {
      windowsHide: true,
      cwd: tmp.dir,
      env: { ...process.env, PORT: "0", HOSTNAME: "127.0.0.1" },
      stdout: "pipe",
      stderr: "inherit",
    });
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (!/m3: \S+/.test(text)) {
      // oxlint-disable-next-line no-await-in-loop -- lecture séquentielle d'un flux stdout jusqu'à la ligne d'origine : chaque chunk dépend du précédent
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }
    reader.releaseLock();
    const origin = text.match(/m3: (\S+)/)?.[1]?.replace(/\/$/, "");
    expect(origin).toStartWith("http://127.0.0.1:");
    const home = await fetch(`${origin}/`);
    expect(await home.text()).toContain("Home page");
    expect(home.status).toBe(200);
    expect(await (await fetch(`${origin}/hello.txt`)).text()).toBe("fixture static\n");
    proc.kill();
  }, 120_000);
});

describe("m3 docker", () => {
  test("writes the Docker context: Dockerfile, a self-contained server.js and the build", async () => {
    const contextDir = join(tmp.dir, "docker");
    const report = await dockerAppRouter({ project, contextDir, prerender: false });
    expect(report.files).toEqual(["Dockerfile", "server.js", "dist"]);
    expect(await Bun.file(join(contextDir, "Dockerfile")).text()).toContain(DOCKER_BASE_IMAGE);
    expect(existsSync(join(contextDir, "dist", "manifest.json"))).toBe(true);
    expect(existsSync(join(contextDir, "server-entry.ts"))).toBe(false);
    const server = await Bun.file(join(contextDir, "server.js")).text();
    const specifiers = [...server.matchAll(/from\s*"([^"]+)"/g)].map((match) => match[1]);
    expect(
      specifiers.filter(
        (specifier) => !["path", "url", "node:path", "node:url"].includes(specifier),
      ),
    ).toEqual([]);
  }, 120_000);
});
