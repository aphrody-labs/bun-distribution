#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Installs the host compose project ~/apps/compose.yaml (tools/config/host/apps/<host>/) and the compose file of every
// app it includes, from the one checkout of its repository (~/src/<repo>). Runs ON the host, from ~/src/aphrody:
//   bun scripts/tools/infra/host-apps.ts --host vps|dbfr [--apply]
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { hostLayout, type HostLayout } from "../../../packages/engine/core/src/host/layout.ts";

const REPO = join(import.meta.dir, "..", "..", "..");
export const HOSTS = ["vps", "dbfr"] as const;

/** Source (absolute, in ~/src/<repo>) -> destination on the host. */
export function hostAppFiles(
  host: (typeof HOSTS)[number],
  layout: HostLayout,
  repo = REPO,
): [string, string][] {
  const files: [string, string][] = [
    [join(repo, "tools/config/host/apps", host, "compose.yaml"), layout.compose],
    [join(repo, "tools/config/host/apps", host, "env"), join(dirname(layout.compose), ".env")],
    [
      join(repo, "tools/config/container/compose.yaml"),
      join(layout.apps, "aphrody", "compose.yaml"),
    ],
  ];
  if (host === "dbfr") {
    files.push([
      join(layout.src, "bun", "scripts/aphrody/deploy/docker/compose.yaml"),
      join(layout.apps, "aphrody-bun", "compose.yaml"),
    ]);
    for (const filename of ["bun-prod-runtime.yaml", "bun-services-runtime.yaml"])
      files.push([
        join(repo, "tools/config/host/apps/dbfr", filename),
        join(layout.apps, filename),
      ]);
  }
  return files;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const host = args[args.indexOf("--host") + 1] as (typeof HOSTS)[number];
  if (!args.includes("--host") || !HOSTS.includes(host)) {
    console.error(`usage: host-apps.ts --host ${HOSTS.join("|")} [--apply]`);
    process.exit(2);
  }
  const apply = args.includes("--apply");
  const layout = hostLayout(process.env["HOME"] || homedir());
  for (const [source, destination] of hostAppFiles(host, layout)) {
    const text = readFileSync(source, "utf8");
    const state = !existsSync(destination)
      ? "new"
      : readFileSync(destination, "utf8") === text
        ? "same"
        : "changed";
    console.log(`${state.padEnd(7)} ${destination} <- ${source}`);
    if (!apply || state === "same") continue;
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(`${destination}.new`, text);
    renameSync(`${destination}.new`, destination);
  }
  if (apply) {
    const check = Bun.spawnSync(["docker", "compose", "-f", layout.compose, "config", "--quiet"], {
      stdout: "inherit",
      stderr: "inherit",
    });
    if (check.exitCode !== 0) process.exit(1);
    console.log(`${layout.compose}: valid (docker compose -f ${layout.compose} up -d applies it)`);
  }
}
