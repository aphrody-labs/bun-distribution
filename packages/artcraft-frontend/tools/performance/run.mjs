import { buildFrontend, serveFrontend } from "../../scripts/artcraft.ts";
import { chromium } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import os from "node:os";

import { parseArgs } from "node:util";
import { benchmarkPlugin, writeBundleReport } from "./benchmark-plugin.mjs";
import { installBrowserFixture, seedDrawingScene, measureTabChange } from "./browser-fixture.mjs";

const frontend = resolve(import.meta.dir, "../..");
const { values } = parseArgs({
  options: {
    output: {
      type: "string",
      default: process.env.ARTCRAFT_PERF_DIR || resolve(os.tmpdir(), "artcraft-performance"),
    },
    runs: { type: "string", default: process.env.ARTCRAFT_PERF_RUNS || "7" },
    "skip-build": { type: "boolean", default: !!process.env.ARTCRAFT_PERF_SKIP_BUILD },
    "build-only": { type: "boolean", default: false },
    channel: { type: "string", default: "chrome" },
    "baseline-ref": { type: "string" },
    "smoke-imports": { type: "boolean", default: false },
  },
});
const output = resolve(values.output);
const runs = Number(values.runs);
if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs must be a positive integer");
const outdir = resolve(output, "dist");
const gitText = (args) => {
  const result = Bun.spawnSync(["git", ...args], { cwd: frontend });
  if (result.exitCode !== 0) throw new Error("Git metadata lookup failed");
  return new TextDecoder().decode(result.stdout).trim();
};
await mkdir(output, { recursive: true });
if (!values["skip-build"]) {
  const result = await buildFrontend({
    outdir,
    plugins: [benchmarkPlugin({ baselineRef: values["baseline-ref"], frontend })],
  });
  await writeBundleReport(result, outdir, frontend);
  await writeFile(
    resolve(output, "build-info.json"),
    JSON.stringify(
      {
        builtAt: new Date().toISOString(),
        revision: gitText(["rev-parse", "HEAD"]),
        baselineOverlay: values["baseline-ref"] || null,
        changedFiles: gitText(["diff", "--name-only"]).split("\n"),
      },
      null,
      2,
    ),
  );
}
if (values["build-only"]) process.exit(0);
const server = serveFrontend({ outdir, port: 0 });
let browser;
try {
  browser = await chromium.launch({ channel: values.channel, headless: true });
  const url = server.url.href;
  const samples = [];
  const errors = [];
  const importedPages = [];
  for (let run = 0; run < runs; run++) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 1,
    });
    await context.addInitScript(installBrowserFixture);
    const page = await context.newPage();
    page.on("pageerror", (error) => {
      errors.push(error.message);
      console.error("Browser error:", error.message);
    });
    // No analytics, external media, or authenticated API traffic in this fixture.
    await context.route("**/*", (route) =>
      route.request().url().startsWith(url) || route.request().url().startsWith("blob:")
        ? route.continue()
        : route.abort(),
    );
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "What will you craft today?" }).waitFor();
    await page.waitForFunction(() => !document.querySelector("video"));
    if (
      !(await page.evaluate(
        () => getComputedStyle(document.querySelector(".fixed")).position === "fixed",
      ))
    ) {
      throw new Error("Tailwind styles are missing; benchmark layout is invalid");
    }
    const collectStartup = async () =>
      page.evaluate(async () => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return {
          readyMs: performance.now(),
          jsBytes: performance
            .getEntriesByType("resource")
            .filter((r) => r.name.endsWith(".js"))
            .reduce((sum, r) => sum + r.decodedBodySize, 0),
          longTaskMs: window.__ARTCRAFT_COUNTERS__.longTasks.reduce(
            (sum, t) => sum + t.duration,
            0,
          ),
          webglContexts: window.__ARTCRAFT_COUNTERS__.webglContexts,
        };
      });
    const startup = await collectStartup();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "What will you craft today?" }).waitFor();
    await page.waitForFunction(() => !document.querySelector("video"));
    const refresh = await collectStartup();
    const fixture = await page.evaluate(seedDrawingScene);
    const firstDraw = await page.evaluate(measureTabChange, "2D");
    // Allow image decoding and the canvas bake debounce to settle outside timing.
    await page.waitForTimeout(1000);
    const leaveDraw = await page.evaluate(measureTabChange, "APPS");
    const returnDraw = await page.evaluate(measureTabChange, "2D");
    await page.waitForTimeout(1000);
    const afterReturn = await page.evaluate(() => ({
      nodeCount: window.__ARTCRAFT_BENCH__.scene.getState().drawNodes.length,
      selectedCount: window.__ARTCRAFT_BENCH__.scene.getState().selectedNodeIds.length,
      historyLength: window.__ARTCRAFT_BENCH__.scene.getState().history.length,
      commands: window.__ARTCRAFT_COUNTERS__.commands,
    }));
    if (run === 0) await page.screenshot({ path: resolve(output, "drawing.png") });
    samples.push({ startup, refresh, firstDraw, leaveDraw, returnDraw, fixture, afterReturn });
    console.log(
      JSON.stringify({ run: run + 1, startup, refresh, firstDraw, leaveDraw, returnDraw }),
    );
    // Validate deferred module evaluation separately from all timed operations.
    if (values["smoke-imports"] && run === runs - 1) {
      const manifest = await Bun.file(resolve(outdir, "bun-metafile.json")).json();
      for (const [file, chunk] of Object.entries(manifest.outputs)) {
        if (
          chunk.entryPoint?.replaceAll("\\", "/").includes("/src/pages/") &&
          file.endsWith(".js")
        ) {
          const asset = file.split(String.fromCharCode(92)).join("/").replace(/^\.\//, "");
          await page.evaluate(async (file) => {
            await import(`/${file}`);
          }, asset);
          importedPages.push(chunk.entryPoint);
        }
      }
    }
    await context.close();
  }
  const summary = {};
  for (const event of ["startup", "refresh", "firstDraw", "leaveDraw", "returnDraw"]) {
    summary[event] = {};
    for (const metric of Object.keys(samples[0][event])) {
      const values = samples.map((s) => s[event][metric]).sort((a, b) => a - b);
      summary[event][metric] = {
        median: values[Math.floor(values.length / 2)],
        min: values[0],
        max: values.at(-1),
      };
    }
  }
  const result = {
    timestamp: new Date().toISOString(),
    build: JSON.parse(await readFile(resolve(output, "build-info.json"), "utf8")),
    environment: {
      platform: os.platform(),
      arch: os.arch(),
      cpu: os.cpus()[0].model,
      browser: browser.version(),
      bun: Bun.version,
      runs,
      viewport: "1440x1000@1",
      ipc: "mocked",
      network: "local assets only, browser cache disabled",
    },
    summary,
    samples,
    importedPages,
    errors: [...new Set(errors)],
  };
  await writeFile(resolve(output, "results.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ summary, errors: result.errors, output }, null, 2));
  if (errors.length) throw new Error("Browser errors invalidate this run; see results.json");
} finally {
  await browser?.close();
  server.stop(true);
}
