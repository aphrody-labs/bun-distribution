// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkCatalog } from "@aphrody/yolo-core/host";

const root = resolve(import.meta.dir, "../../../docs/aphrody");
const host = join(root, "infra/config/host");
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("the host catalog stays consistent with the self-update units", () => {
  expect(checkCatalog(host)).toEqual([]);
  const catalog = JSON.parse(read("infra/config/host/catalog.json")) as {
    units: { unit: string; targetHost: string; pairs?: string }[];
    scheduledTasks: {
      task: string;
      command: string;
      bootEntry: string;
      intervalMinutes: number;
      hosts: string[];
    }[];
  };
  for (const [suffix, target] of [
    ["", "vps"],
    ["-dbfr", "dbfr"],
  ] as const) {
    const service = catalog.units.find(u => u.unit === `aphrody-self-update${suffix}.service`);
    const timer = catalog.units.find(u => u.unit === `aphrody-self-update${suffix}.timer`);
    expect(service?.targetHost).toBe(target);
    expect(timer?.pairs).toBe(`aphrody-self-update${suffix}.service`);
    expect(read(`infra/config/host/systemd/aphrody/aphrody-self-update${suffix}.service`)).toContain(
      "aphrody self update",
    );
  }
  const task = catalog.scheduledTasks.find(t => t.task === "Aphrody self update");
  expect(task?.command).toBe("aphrody self update");
  // Registered by `aphrody infra boot apply` from the boot catalog entry (hidden S4U task).
  const boot = JSON.parse(read("infra/config/service-catalog.json")) as {
    boot: {
      entries: {
        host: string;
        name?: string;
        arguments?: string;
        triggers?: string[];
      }[];
    };
  };
  const entry = boot.boot.entries.find(e => `${e.host}:${e.name}` === task!.bootEntry);
  expect(`aphrody ${entry?.arguments}`).toBe(task!.command);
  expect(entry?.triggers).toContain(`every:${task!.intervalMinutes}m`);
});

test("release-main.yml has gates, a build matrix, publication and host deployment, and no inline secret", () => {
  const workflow = read(".github/workflows/release-main.yml");
  for (const needle of [
    "branches: [main]",
    "windows-2025",
    "windows-11-arm",
    "ubuntu-24.04",
    "wasm32-unknown-unknown",
    "scripts/release/auto-release.sh",
    "aphrody self update",
    "cancel-in-progress: false",
  ])
    expect(workflow).toContain(needle);
  expect(workflow).not.toMatch(/(ghp_|github_pat_|BEGIN [A-Z ]*PRIVATE KEY|sk-[A-Za-z0-9]{20})/);
  // every credential comes from the secrets / vars context
  expect(workflow).toContain("secrets.RELEASE_SSH_KEY");
});

test("auto-release.sh is the downloads:publish chain, locked and revision-checked", () => {
  const script = read("scripts/release/auto-release.sh");
  for (const step of ["plan", "build", "release", "verify"]) expect(script).toContain(`downloads:publish ${step}`);
  expect(script).toContain("flock");
  expect(script).toContain("set -euo pipefail");
});
