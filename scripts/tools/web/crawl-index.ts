#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
import { $ } from "bun";
import { parseArgs } from "node:util";

export interface CrawlJob {
  host: "vps" | "dbfr";
  label: string;
  seeds: string[];
  maxRequests: number;
  maxDepth: number;
}

export function validateJob(job: CrawlJob): CrawlJob {
  if (!["vps", "dbfr"].includes(job.host)) throw new Error("host must be vps or dbfr");
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(job.label)) throw new Error("label must be a slug");
  if (!Number.isInteger(job.maxRequests) || job.maxRequests < 1 || job.maxRequests > 5000)
    throw new Error("max-requests must be 1..5000");
  if (!Number.isInteger(job.maxDepth) || job.maxDepth < 0 || job.maxDepth > 10)
    throw new Error("max-depth must be 0..10");
  if (!job.seeds.length || job.seeds.length > 25) throw new Error("provide 1..25 seed URLs");
  for (const seed of job.seeds) {
    const url = new URL(seed);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      throw new Error("seed URLs must be HTTP(S) without credentials");
  }
  return job;
}

/** The remote script calls native owners; raw crawl data never leaves the target. */
export function remoteScript(input: CrawlJob): string {
  const job = validateJob(input);
  const binary = "/home/ubuntu/.local/bin/aphrody";
  return `
import { mkdir, chmod } from "node:fs/promises";
const job = ${JSON.stringify(job)};
const binary = ${JSON.stringify(binary)};
process.umask(0o077);
const root = "/home/ubuntu/.aphrody/private/web/jobs/" + job.label;
const documents = root + "/documents";
await mkdir(documents, { recursive: true, mode: 0o700 });
await chmod(root, 0o700);
const lock = root + "/running";
try { await mkdir(lock, { mode: 0o700 }); }
catch { throw new Error("this crawl job is already running; inspect its process before recovery"); }
const { rm } = await import("node:fs/promises");
await Bun.write(lock + "/owner.json", JSON.stringify({pid: process.pid, startedAt: new Date().toISOString()}));
try {
  const run = async (args) => {
    const child = Bun.spawn([binary, ...args], { stdout: "pipe", stderr: "pipe" });
    const deadline = setTimeout(() => child.kill("SIGTERM"), 1800000);
    const hardDeadline = setTimeout(() => child.kill("SIGKILL"), 1810000);
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited
    ]);
    clearTimeout(deadline); clearTimeout(hardDeadline);
    if (code !== 0) throw new Error(args[0] + " failed (" + code + "): " + stderr.slice(-2000));
    return JSON.parse(stdout);
  };
  const domains = [...new Set(job.seeds.map(url => new URL(url).hostname))];
  const report = await run(["web", "crawl", ...job.seeds,
    "--sqlite", root + "/frontier.sqlite", "--max-requests", String(job.maxRequests),
    "--max-depth", String(job.maxDepth), "--concurrency", "2", "--allowed-domains", domains.join(","),
    "--per-host-delay", "1", "--max-per-host", "1", "--max-retries", "2", "--obey-robots", "--json"]);
  await Bun.write(root + "/crawl.json", JSON.stringify(report));
  let written = 0;
  for (const page of report.pages ?? []) {
    if (page.status < 200 || page.status >= 300 || !page.markdown?.trim()) continue;
    const name = new Bun.CryptoHasher("sha256").update(page.url).digest("hex") + ".md";
    await Bun.write(documents + "/" + name, "# " + (page.title ?? page.url) + "\\nSource: " + page.url + "\\n\\n" + page.markdown);
    written++;
  }
  if (!written && !(report.frontier?.done > 0)) throw new Error("crawl yielded no indexable pages");
  const index = await run(["home", "index", documents, "--profile", "aphrody", "--label", "web:" + job.label]);
  const summary = {host: job.host, label: job.label, attempts: report.attempts,
    pages: report.pages?.length ?? 0, written, crawlErrors: report.errors?.length ?? 0,
    frontier: report.frontier, indexed: index.indexed, unchanged: index.unchanged,
    chunks: index.chunks, indexErrors: index.errors};
  await Bun.write(root + "/summary.json", JSON.stringify(summary));
  console.log(JSON.stringify(summary));
  if (index.errors?.length) process.exitCode = 1;
} finally { await rm(lock, { recursive: true }); }
`;
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      host: { type: "string" },
      label: { type: "string" },
      seed: { type: "string", multiple: true },
      "max-requests": { type: "string", default: "25" },
      "max-depth": { type: "string", default: "2" },
      local: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(
      "bun scripts/tools/web/crawl-index.ts --host vps|dbfr --label SLUG --seed URL [--seed URL] [--max-requests 25] [--max-depth 2] [--local]",
    );
  } else {
    const job = validateJob({
      host: values.host as CrawlJob["host"],
      label: values.label ?? "",
      seeds: values.seed ?? [],
      maxRequests: Number(values["max-requests"]),
      maxDepth: Number(values["max-depth"]),
    });
    const script = remoteScript(job);
    const cli = Bun.which("aphrody");
    if (!values.local && !cli) throw new Error("the native aphrody CLI must be on PATH");
    const args = values.local
      ? [process.execPath, "-e", script]
      : [cli!, "infra", "ssh", "exec", "--host", job.host, "--cmd", "bun -e " + $.escape(script)];
    const child = Bun.spawn(args, {
      windowsHide: true,
      env: { ...process.env, APHRODY_SSH_COMMAND_TIMEOUT_SECS: "3600" },
      stdout: "inherit",
      stderr: "inherit",
    });
    process.exitCode = await child.exited;
  }
}
