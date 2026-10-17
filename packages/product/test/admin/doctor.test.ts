// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  parseProbe,
  readTrainStatus,
  renderReport,
  runDoctor,
  verdictOf,
  type Check,
} from "../../src/admin/lib/doctor.ts";
import { saveProfile } from "../../src/admin/lib/profile.ts";
import type { FakeSystem } from "../../src/admin/lib/system.ts";
import { samplePack, testContext, type TestContext } from "./helpers.ts";

const SONDE_OK = [
  "user|omar",
  "cpu|16",
  "load|0.42",
  "mem|65536000|40000000",
  "disk|412000000|500000000",
  "gpu|NVIDIA RTX 4090, 24564, 1200, 3",
  "aphrody|aphrody 1.0.0",
  "repo|oui",
  'train|{   "gpu_lock_active": false,   "python_train_project": true }',
  "jobs|0",
].join("\n");

function touch(path: string, content = "x") {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

/** A Windows PC where everything is installed and the tunnel is up, unless the test breaks something. */
async function readyPc(): Promise<TestContext> {
  const t = testContext();
  const { ctx, sys } = t;
  touch(join(ctx.paths.programFiles, "Git", "cmd", "git.exe"));
  touch(join(ctx.paths.programFiles, "WireGuard", "wireguard.exe"));
  touch(join(ctx.sys.env.SystemRoot!, "System32", "OpenSSH", "ssh.exe"));
  touch(join(ctx.sys.env.SystemRoot!, "System32", "OpenSSH", "ssh-keygen.exe"));
  touch(ctx.paths.sshKey);
  touch(`${ctx.paths.sshKey}.pub`);
  mkdirSync(join(ctx.paths.repoDir, ".git"), { recursive: true });
  await saveProfile(ctx.paths, samplePack());
  const aphrody = join(ctx.paths.home, ".local", "bin", "aphrody.exe");
  touch(aphrody);
  sys.handlers.push(
    {
      match: /git(\.exe)? --version/,
      result: { stdout: "git version 2.50.0" },
    },
    { match: /git(\.exe)? -C .* rev-parse/, result: { stdout: "main\n" } },
    {
      match: "sc query",
      result: { stdout: "        STATE              : 4  RUNNING" },
    },
    { match: /aphrody(\.exe)? --version/, result: { stdout: "aphrody 1.0.0" } },
    { match: /^ssh /, result: { stdout: SONDE_OK } },
  );
  sys.open.add("198.51.100.1:22");
  sys.open.add("198.51.100.2:22");
  sys.http["http://198.51.100.1:8789/healthz"] = { status: 200, body: "ok" };
  sys.http["http://198.51.100.1:8788/ping"] = { status: 200, body: "pong" };
  return t;
}

const find = (checks: Check[], id: string) => checks.find(entry => entry.id === id);

test("parseProbe reads every line of the host probe", () => {
  const probe = parseProbe(SONDE_OK);
  expect(probe).toMatchObject({
    user: "omar",
    cpu: 16,
    load: "0.42",
    memTotalKb: 65536000,
    memAvailKb: 40000000,
    diskAvailKb: 412000000,
    aphrody: "aphrody 1.0.0",
    repo: true,
    jobs: 0,
  });
  expect(probe.gpus).toEqual([{ name: "NVIDIA RTX 4090", totalMiB: 24564, usedMiB: 1200, util: 3 }]);
  expect(parseProbe("gpu|aucun\naphrody|absent\nrepo|non").noGpu).toBe(true);
  expect(parseProbe("aphrody|absent").aphrodyAbsent).toBe(true);
});

test("readTrainStatus tells a JSON status from a build without the train feature", () => {
  expect(readTrainStatus('{ "gpu_lock_active": true }').json?.gpu_lock_active).toBe(true);
  expect(readTrainStatus("× `aphrody train` requires --features train").missing).toBe(true);
  expect(readTrainStatus("Segmentation fault").missing).toBe(false);
});

const c = (status: Check["status"]): Check => ({
  id: "x",
  titre: "x",
  status,
  detail: "",
});

test("verdict: failures block, remarks do not", () => {
  expect(verdictOf([c("ok")])).toBe("pret");
  expect(verdictOf([c("ok"), c("attention")])).toBe("presque");
  expect(verdictOf([c("ok"), c("attente")])).toBe("presque");
  expect(verdictOf([c("ok"), c("attention"), c("echec")])).toBe("pas-pret");
});

test("a fully set up PC is ready, and training can start", async () => {
  const { ctx } = await readyPc();
  ctx.fetchImpl = async () =>
    Response.json({
      schemaVersion: 1,
      release: { id: "r" },
      baseUrl: "x",
      artifacts: [],
    });
  const report = await runDoctor(ctx);
  const failing = report.checks.filter(entry => entry.status === "echec");
  expect(failing).toEqual([]);
  expect(find(report.checks, "tunnel")?.status).toBe("ok");
  expect(find(report.checks, "ssh-gpu")?.detail).toContain("omar");
  expect(find(report.checks, "ressources-gpu")?.detail).toContain("16 coeurs");
  expect(find(report.checks, "ressources-gpu")?.detail).toContain("GPU NVIDIA RTX 4090 23364 Mo libres");
  expect(find(report.checks, "entrainement-gpu")?.status).toBe("ok");
  expect(find(report.checks, "entrainement-vps")).toBeUndefined();
  expect(find(report.checks, "mcpHttp")?.status).toBe("ok");
  expect(find(report.checks, "a2a")?.status).toBe("ok");
  expect(report.entrainementPret).toBe(true);
  expect(renderReport(report).join("\n")).toContain("Entraînement : prêt à être lancé.");
});

test("tunnel down: the report says to start it and the servers are not blamed", async () => {
  const { ctx, sys } = await readyPc();
  sys.handlers.unshift({
    match: "sc query",
    result: { stdout: "        STATE              : 1  STOPPED" },
  });
  sys.open.clear();
  const report = await runDoctor(ctx);
  expect(find(report.checks, "tunnel")).toMatchObject({
    status: "echec",
    responsable: "omar",
  });
  expect(find(report.checks, "reseau-gpu")).toMatchObject({
    status: "echec",
    responsable: "omar",
  });
  expect(find(report.checks, "ssh-gpu")).toBeUndefined();
  expect(report.verdict).toBe("pas-pret");
  expect(report.entrainementPret).toBe(false);
  const text = renderReport(report).join("\n");
  expect(text).toContain("PAS PRÊT");
  expect(text).toContain("À faire de ton côté");
});

test("key refused: the team is told, with the exact reason", async () => {
  const { ctx, sys } = await readyPc();
  sys.handlers.unshift({
    match: /^ssh /,
    result: { code: 255, stderr: "omar@x: Permission denied (publickey)." },
  });
  const report = await runDoctor(ctx);
  expect(find(report.checks, "ssh-gpu")).toMatchObject({
    status: "echec",
    responsable: "equipe",
  });
  expect(find(report.checks, "ssh-gpu")?.detail).toContain("refuse ta clé");
  expect(renderReport(report).join("\n")).toContain("À signaler à l'équipe");
});

test("training feature missing on the host is a team problem, not Omar's", async () => {
  const { ctx, sys } = await readyPc();
  sys.handlers.unshift({
    match: /^ssh /,
    result: {
      stdout: SONDE_OK.replace(/train\|.*/, "train|× `aphrody train` requires --features train"),
    },
  });
  const report = await runDoctor(ctx);
  expect(find(report.checks, "entrainement-gpu")).toMatchObject({
    status: "echec",
    responsable: "equipe",
  });
  expect(report.entrainementPret).toBe(false);
});

test("a full disk or a missing GPU on the training host is flagged before launching", async () => {
  const { ctx, sys } = await readyPc();
  sys.handlers.unshift({
    match: /^ssh /,
    result: {
      stdout: SONDE_OK.replace("disk|412000000|500000000", "disk|2000000|500000000"),
    },
  });
  expect(find((await runDoctor(ctx)).checks, "ressources-gpu")?.status).toBe("echec");
  sys.handlers.shift();
  sys.handlers.unshift({
    match: /^ssh /,
    result: { stdout: SONDE_OK.replace(/gpu\|.*/, "gpu|aucun") },
  });
  const noGpu = find((await runDoctor(ctx)).checks, "ressources-gpu");
  expect(noGpu?.status).toBe("attention");
  expect(noGpu?.detail).toContain("pas de carte graphique");
});

test("a GPU already reserved is a remark, not a failure", async () => {
  const { ctx, sys } = await readyPc();
  sys.handlers.unshift({
    match: /^ssh /,
    result: { stdout: SONDE_OK.replace("false", "true") },
  });
  expect(find((await runDoctor(ctx)).checks, "entrainement-gpu")?.status).toBe("attention");
});

test("server services that are not up yet are remarks for the team, never blockers", async () => {
  const { ctx, sys } = await readyPc();
  delete sys.http["http://198.51.100.1:8788/ping"];
  sys.http["http://198.51.100.1:8789/healthz"] = { status: 503, body: "" };
  const report = await runDoctor(ctx);
  expect(find(report.checks, "mcpHttp")).toMatchObject({
    status: "attention",
    responsable: "equipe",
  });
  expect(find(report.checks, "a2a")?.status).toBe("attention");
  expect(report.verdict).toBe("presque");
});

test("a bare PC says what to do first, and aphrody not published for Windows is the team's wait, not a failure", async () => {
  const { ctx } = testContext();
  ctx.fetchImpl = async () =>
    Response.json({
      schemaVersion: 1,
      release: { id: "r" },
      baseUrl: "https://downloads.aphrody.com",
      artifacts: [
        {
          name: "aphrody",
          platform: "linux-x86_64",
          version: "1",
          url: "u",
          sha256: "0",
          size: 1,
        },
      ],
    });
  const report = await runDoctor(ctx);
  expect(find(report.checks, "git")?.status).toBe("echec");
  expect(find(report.checks, "acces")?.action).toContain("aphrody-omar-acces.json");
  expect(find(report.checks, "aphrody")).toMatchObject({
    status: "attente",
    responsable: "equipe",
  });
  expect(find(report.checks, "ssh-gpu")).toBeUndefined();
  expect(report.entrainementPret).toBe(false);
});

test("the check never modifies anything", async () => {
  const { ctx, sys } = await readyPc();
  await runDoctor(ctx);
  const mutating = sys.calls.filter(
    call =>
      /install|uninstall|clone|pull|add|remove|kill|rm /.test(call.argv.join(" ")) &&
      !call.argv.join(" ").startsWith("ssh "),
  );
  expect(mutating).toEqual([]);
  const ssh = sys.calls.filter(call => call.argv[0] === "ssh");
  expect(ssh.length).toBeGreaterThan(0);
  for (const call of ssh) expect(call.options.input).not.toMatch(/\brm\b|\bkill\b|\bmkdir\b/);
});

export type { FakeSystem };
