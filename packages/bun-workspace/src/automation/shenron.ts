// SPDX-License-Identifier: Apache-2.0
// Shenron operations through Aphrody Infra. The product source (site, bot, pipeline, Koharu) lives in
// aphrody-labs/shenron and runs its own package scripts; its host plane (systemd, nginx, deploy adapter,
// backups) stays in this repository's Infra catalog.
import { runRustBridge } from "./bridges.ts";
import { parseArgs } from "node:util";

const USAGE = "usage: yolo ops shenron <infra|service|deploy|dev-env|timeline> ...";

export async function runShenron(args: string[]): Promise<number> {
  const [action, ...rest] = args;
  const inherit = { stdout: "inherit", stderr: "inherit" } as const;
  if (action === "timeline") {
    const [operation, ...timelineArgs] = rest;
    const { values } = parseArgs({
      args: timelineArgs,
      options: {
        output: { type: "string" },
        index: { type: "boolean" },
        "crawl-budget": { type: "string" },
        port: { type: "string", default: "8813" },
        query: { type: "string" },
        help: { type: "boolean" },
      },
    });
    if (!operation || ["--help", "help", "-h"].includes(operation) || values.help) {
      console.log(
        "yolo ops shenron timeline refresh|query|serve --output PRIVATE_DIR [--index] [--crawl-budget 32] [--query GRAPHQL] [--port 8813]",
      );
      return 0;
    }
    if (!values.output) throw new Error("--output required");
    const { refresh, load, query, createTimelineHandler, indexRetrieval } = await import("@aphrody/timeline");
    if (operation === "refresh") {
      process.umask(0o077);
      const indexDocuments = values.index
        ? async (directory: string, snapshot: import("@aphrody/timeline").Snapshot) => {
            const binary = Bun.which("aphrody");
            if (!binary) throw new Error("native Aphrody home owner required");
            const child = Bun.spawn(
              [binary, "home", "index", directory, "--profile", "dbfr", "--label", "shenron:timeline"],
              { windowsHide: true, stdout: "pipe", stderr: "pipe" },
            );
            const timeout = setTimeout(() => child.kill("SIGTERM"), 1800000);
            const killTimeout = setTimeout(() => child.kill("SIGKILL"), 1810000);
            try {
              const [stdout, , code] = await Promise.all([
                new Response(child.stdout).text(),
                new Response(child.stderr).text(),
                child.exited,
              ]);
              if (code !== 0) throw new Error(`home indexing failed (${code})`);
              const result = JSON.parse(stdout);
              if (result.errors?.length) throw new Error("home indexing reported errors");
              const url = process.env.APHRODY_AI_HTTP_URL;
              const retrieval = url
                ? await indexRetrieval(snapshot, {
                    url,
                    token: process.env.APHRODY_AI_HTTP_TOKEN ?? "",
                    originSourceId: "shenron:timeline",
                    lang: "fr",
                    requireVectors: true,
                    content: entry => Bun.file(`${directory}/${entry.key.replace(":", "-")}.md`).text(),
                  })
                : null;
              return { home: result, retrieval };
            } finally {
              clearTimeout(timeout);
              clearTimeout(killTimeout);
            }
          }
        : undefined;
      console.log(
        JSON.stringify(
          await refresh(values.output, {
            redisUrl: process.env.SHENRON_TIMELINE_REDIS_URL,
            indexDocuments,
            crawlBudget: values["crawl-budget"] === undefined ? undefined : Number(values["crawl-budget"]),
          }),
        ),
      );
      return 0;
    }
    if (operation === "query") {
      console.log(
        JSON.stringify(
          await query(await load(values.output), values.query ?? "{ timeline { mediaTotal ageTotal generation } }"),
        ),
      );
      return 0;
    }
    if (operation === "serve") {
      const port = Number(values.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("invalid port");
      const output = values.output;
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port,
        maxRequestBodySize: 32768,
        fetch: createTimelineHandler(() => load(output)),
      });
      console.log(JSON.stringify({ host: server.hostname, port: server.port }));
      await new Promise<void>(resolve => {
        for (const signal of ["SIGINT", "SIGTERM"] as const)
          process.once(signal, () => {
            server.stop(true);
            resolve();
          });
      });
      return 0;
    }
    throw new Error("unknown timeline operation");
  }
  if (action === "infra") {
    if (!rest.length) throw new Error("usage: yolo ops shenron infra <aphrody-infra arguments...>");
    return runRustBridge("aphrody-infra", rest, inherit);
  }
  if (action === "service") return runRustBridge("aphrody-infra", ["service", ...rest], inherit);
  if (action === "deploy") {
    const targetIndex = rest.indexOf("--target");
    if (
      targetIndex < 0 ||
      !rest[targetIndex + 1] ||
      !rest.includes("--release") ||
      !rest[rest.indexOf("--release") + 1] ||
      rest.includes("--stack") ||
      rest.filter(argument => argument === "--target").length !== 1
    )
      throw new Error("usage: yolo ops shenron deploy --target <infra-target> --release <path> [--apply]");
    return runRustBridge("aphrody-infra", ["deploy", "--stack", "shenron", ...rest], inherit);
  }
  if (action === "dev-env") return runRustBridge("aphrody-infra", ["dev-env", ...rest], inherit);
  throw new Error(USAGE);
}

if (import.meta.main) process.exitCode = await runShenron(process.argv.slice(2));
