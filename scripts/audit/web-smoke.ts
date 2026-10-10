// SPDX-License-Identifier: Apache-2.0
//! End-to-end smoke of the Aphrody web layer on loopback fixtures: starts the engine on an
//! ephemeral port, loads a local page and checks DOM, Markdown, accessibility refs, screenshot,
//! PDF, the CDP session, the one-shot CLI (fetch, artifact, crawl with robots) and a clean
//! shutdown. Nothing leaves the machine.
//!
//!   bun scripts/audit/web-smoke.ts [--bin <aphrody-web>] [--json] [--out <file>]
//!
//! Exit code 0 only when every check passes; a binary without `crawl` fails the run (build it
//! with `cargo build -p aphrody-web-engine`).

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { AgentBrowser } from "../../packages/web/agent-browser/src/client.ts";
import { loadWebConfig, repositoryRoot } from "../../packages/web/agent-browser/src/config.ts";
import {
  installEngineCleanup,
  startEngine,
  stopAllEngines,
} from "../../packages/web/agent-browser/src/engine.ts";
import { WebService } from "../../packages/web/agent-browser/src/service.ts";

export interface Check {
  name: string;
  ok: boolean;
  ms: number;
  detail: string;
}

export interface SmokeReport {
  schema: "aphrody-web.smoke/1";
  binary: string;
  version: string;
  ok: boolean;
  passed: number;
  failed: number;
  checks: Check[];
}

export const PNG_SIGNATURE = "89504e470d0a1a0a";

export function isPngBase64(value: string): boolean {
  return Buffer.from(value, "base64").subarray(0, 8).toString("hex") === PNG_SIGNATURE;
}

export function isPdfBase64(value: string): boolean {
  return Buffer.from(value, "base64").subarray(0, 4).toString() === "%PDF";
}

export function summarize(binary: string, version: string, checks: Check[]): SmokeReport {
  const failed = checks.filter((check) => !check.ok).length;
  return {
    schema: "aphrody-web.smoke/1",
    binary,
    version,
    ok: failed === 0 && checks.length > 0,
    passed: checks.length - failed,
    failed,
    checks,
  };
}

/** Fixture site: a home page, a linked page, a robots-blocked page and a script-rendered page. */
export function fixturePages(): Record<string, { type: string; body: string }> {
  const html = (title: string, body: string) =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>` +
    `<meta name="description" content="${title} fixture"></head><body>${body}</body></html>`;
  return {
    "/": {
      type: "text/html",
      body: html(
        "Smoke Home",
        `<header><nav aria-label="Primary"><a href="/about">About</a><a href="/private/secret">Secret</a></nav></header>` +
          `<main><h1>Smoke Home</h1><p id="result">Ready for the aphrody web smoke test, with enough prose for the extractor to keep this paragraph as main content.</p>` +
          `<input id="query" aria-label="Query"><button id="submit" onclick="document.title=document.querySelector('#query').value">Go</button></main>`,
      ),
    },
    "/about": {
      type: "text/html",
      body: html(
        "About",
        `<main><h1>About</h1><p>The about page carries different words so the crawler stores it as a distinct page.</p><a href="/js">Rendered</a></main>`,
      ),
    },
    "/js": {
      type: "text/html",
      body: html(
        "Rendered",
        `<main><h1>Rendered</h1><p id="slot">pending</p></main><script>document.getElementById('slot').textContent = 'rendered-by-v8-' + (6 * 7);</script>`,
      ),
    },
    "/private/secret": {
      type: "text/html",
      body: html(
        "Secret",
        "<main><h1>Secret</h1><p>robots.txt forbids crawling this page.</p></main>",
      ),
    },
    "/robots.txt": { type: "text/plain", body: "User-agent: *\nDisallow: /private\n" },
  };
}

async function timed(checks: Check[], name: string, run: () => Promise<string>): Promise<void> {
  const started = performance.now();
  try {
    const detail = await run();
    checks.push({ name, ok: true, ms: Math.round(performance.now() - started), detail });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    checks.push({
      name,
      ok: false,
      ms: Math.round(performance.now() - started),
      detail: detail.slice(0, 400),
    });
  }
}

function expect(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function runSmoke(binaryOverride?: string): Promise<SmokeReport> {
  const config = loadWebConfig();
  const service = new WebService({ config, binary: binaryOverride });
  const binary = service.binary;
  const checks: Check[] = [];
  let version = "unknown";
  installEngineCleanup();

  const pages = fixturePages();
  const fixture = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const page = pages[new URL(request.url).pathname];
      return page
        ? new Response(page.body, { headers: { "content-type": page.type } })
        : new Response("not found", { status: 404 });
    },
  });
  const base = `http://127.0.0.1:${fixture.port}`;

  try {
    await timed(checks, "binary:version", async () => {
      version = await service.version();
      expect(
        /^aphrody-web \d/.test(version),
        `unexpected version output ${JSON.stringify(version)}`,
      );
      return version;
    });
    await timed(checks, "binary:subcommands", async () => {
      const missing: string[] = [];
      for (const name of ["launch", "fetch", "scrape", "crawl"])
        if (!(await service.supports(name))) missing.push(name);
      expect(
        missing.length === 0,
        `binary lacks ${missing.join(", ")}; rebuild with cargo build -p aphrody-web-engine`,
      );
      return "launch fetch scrape crawl";
    });

    await timed(checks, "cli:fetch-markdown", async () => {
      const markdown = await service.markdown(`${base}/`, {
        allowPrivateNetwork: true,
        timeoutSecs: 20,
      });
      expect(markdown.includes("Smoke Home"), "markdown lacks the page heading");
      return `${markdown.length} chars`;
    });
    await timed(checks, "cli:fetch-artifact", async () => {
      const artifact = await service.artifact(`${base}/`, {
        allowPrivateNetwork: true,
        timeoutSecs: 20,
      });
      expect(artifact.html.includes("<main>"), "artifact lacks the DOM");
      expect(
        artifact.extracted.text.includes("aphrody web smoke"),
        "artifact lacks extracted text",
      );
      return `html ${artifact.html.length} bytes, ${artifact.scripts.length} scripts`;
    });
    await timed(checks, "cli:fetch-runs-scripts", async () => {
      const text = await service.fetch(`${base}/js`, {
        dump: "html",
        allowPrivateNetwork: true,
        timeoutSecs: 20,
      });
      expect(text.includes("rendered-by-v8-42"), "V8 did not execute the inline script");
      return "inline script executed";
    });
    await timed(checks, "cli:crawl-obeys-robots", async () => {
      const report = await service.crawl([`${base}/`], {
        allowPrivateNetwork: true,
        includeLinks: true,
        maxPages: 10,
        delayMs: 0,
        timeoutSecs: 30,
      });
      const urls = report.pages.map((page) => new URL(page.url).pathname);
      expect(report.schema === "aphrody-web.crawl/1", `schema ${report.schema}`);
      expect(
        urls.includes("/") && urls.includes("/about") && urls.includes("/js"),
        `crawled ${urls.join(",")}`,
      );
      expect(
        !urls.some((path) => path.startsWith("/private")),
        "crawler fetched a robots-disallowed page",
      );
      expect(report.stats.robotsBlocked >= 1, "robots block not recorded");
      expect(
        report.pages[0]?.links?.some((link) => link.endsWith("/about")),
        "links missing from the report",
      );
      return `${report.pages.length} pages, robotsBlocked ${report.stats.robotsBlocked}`;
    });

    const engine = await startEngine({ config, binary, allowPrivateNetwork: true }).catch(
      (error: unknown) => {
        checks.push({
          name: "engine:start",
          ok: false,
          ms: 0,
          detail: error instanceof Error ? error.message : String(error),
        });
        return undefined;
      },
    );
    if (engine) {
      checks.push({
        name: "engine:start",
        ok: true,
        ms: 0,
        detail: `${engine.endpoint} pid ${engine.pid}`,
      });
      await timed(checks, "cdp:json-version", async () => {
        const body = (await (await fetch(`${engine.httpUrl}/json/version`)).json()) as {
          Browser?: string;
          webSocketDebuggerUrl?: string;
        };
        expect(typeof body.Browser === "string", "no Browser field");
        return `${body.Browser}`;
      });
      await timed(checks, "cdp:session-dom-a11y-input", async () => {
        const page = await AgentBrowser.open(`${base}/`, { cdpUrl: engine.endpoint });
        try {
          const snapshot = await page.snapshot();
          expect(snapshot.refs.size >= 2, `snapshot has ${snapshot.refs.size} refs`);
          expect(snapshot.raw.includes("[ref=@e"), "snapshot has no refs");
          expect((await page.getText("#result")) !== "", "DOM text query is empty");
          await page.fill("#query", "typed");
          await page.click("#submit");
          expect(
            (await page.evaluate<string>("document.title")) === "typed",
            "click handler did not run",
          );
          return `${snapshot.refs.size} refs`;
        } finally {
          await page.close();
        }
      });
      await timed(checks, "cdp:screenshot-pdf", async () => {
        const page = await AgentBrowser.open(`${base}/`, { cdpUrl: engine.endpoint });
        try {
          const png = await page.screenshot();
          const pdf = await page.pdf();
          expect(isPngBase64(png), "screenshot is not a PNG");
          expect(isPdfBase64(pdf), "pdf is not a PDF");
          return `png ${Buffer.from(png, "base64").length} bytes, pdf ${Buffer.from(pdf, "base64").length} bytes`;
        } finally {
          await page.close();
        }
      });
      await timed(checks, "engine:clean-shutdown", async () => {
        const { pid, port, host } = engine;
        const code = await engine.stop();
        expect(code === 0 || code === 143, `engine exit code ${code}`);
        expect(!pidAlive(pid), `pid ${pid} still alive`);
        const closed = await fetch(`http://${host}:${port}/json/version`, {
          signal: AbortSignal.timeout(1500),
        }).then(
          () => false,
          () => true,
        );
        expect(closed, "port still answering after stop");
        return `exit ${code}, port closed`;
      });
    }
  } finally {
    fixture.stop(true);
    await stopAllEngines();
    await service.close();
  }
  return summarize(binary, version, checks);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const value = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const out = value("--out");
  const report = await runSmoke(value("--bin"));
  if (out) {
    const target = resolve(repositoryRoot(), out);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    for (const check of report.checks)
      console.log(
        `${check.ok ? "ok  " : "FAIL"} ${check.name.padEnd(30)} ${String(check.ms).padStart(6)} ms  ${check.detail}`,
      );
    console.log(
      `\nweb smoke: ${report.passed} passed, ${report.failed} failed (${report.binary} ${report.version})`,
    );
  }
  process.exit(report.ok ? 0 : 1);
}
