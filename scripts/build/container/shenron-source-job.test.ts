// SPDX-License-Identifier: Apache-2.0
/* eslint-disable no-await-in-loop -- Fixture lifecycle and readiness polling are intentionally sequential. */
import { afterEach, expect, test } from "bun:test";
import { chmod, mkdtemp, mkdir, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applySourceJob,
  planSourceJob,
  sourceJobArgs,
  sourceJobRun,
  type SourceJobConfig,
  type SourceJobPorts,
} from "./shenron-source-job.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const hash = (value: string) => new Bun.CryptoHasher("sha256").update(value).digest("hex");
async function fixtureFile(path: string, content: string, mode = 0o600) {
  await Bun.write(path, content);
  await chmod(path, mode);
  return path;
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "aphrody-source-vpn-"));
  roots.push(root);
  for (const part of ["data", "vpn", "resources"]) await mkdir(join(root, part), { mode: 0o700 });
  const file = fixtureFile;
  const config: SourceJobConfig = {
    version: 1,
    type: "shenron-source-vpn",
    host: "dbfr",
    imageId: "sha256:" + "1".repeat(64),
    runtime: {
      path: await file(join(root, "runtime"), "qualified fixture runtime", 0o755),
      sha256: hash("qualified fixture runtime"),
    },
    bundle: {
      path: await file(join(root, "bundle.mjs"), "qualified fixture bundle", 0o644),
      sha256: hash("qualified fixture bundle"),
    },
    resources: { path: join(root, "resources"), relaysSha256: hash("relay fixture") },
    dataRoot: join(root, "data"),
    vpnStateRoot: join(root, "vpn"),
    pipelineConfig: await file(
      join(root, "data/config.json"),
      JSON.stringify({
        collectionIsolation: "required",
        input: "/app/data/source-pipeline/input.jsonl",
        policy: "/app/data/source-pipeline/policy.json",
        job: "/app/data/source-pipeline/jobs",
      }),
    ),
    googleJar: await file(join(root, "cookies.json"), "[]"),
    timeoutMs: 10000,
  };
  await file(join(root, "resources/relays.json"), "relay fixture");
  const calls: { args: string[]; stdin?: Uint8Array }[] = [];
  let running = false;
  let ownership = "";
  const run: NonNullable<SourceJobPorts["run"]> = async (args, options) => {
    calls.push({ args, stdin: options.stdin });
    if (args[0] === "ip") return { code: 0, stdout: "fixture default route" };
    if (args[1] === "run") {
      running = true;
      ownership =
        args
          .find((value) => value.startsWith("aphrody.source.plan="))!
          .slice("aphrody.source.plan=".length) +
        "|" +
        args[args.indexOf("--name") + 1];
      return { code: 0, stdout: "fixture-container-id" };
    }
    if (args[1] === "stop") {
      running = false;
      return { code: 0, stdout: "stopped" };
    }
    if (args[1] === "inspect")
      return {
        code: running ? 0 : 1,
        stdout: running
          ? args.some((value) => value.includes(".Config.Labels"))
            ? ownership
            : "true"
          : "",
      };
    if (args.includes("status")) return { code: 0, stdout: "Connected { fixture: true }" };
    if (args.includes("-e")) {
      const code = args.at(-1)!;
      const destination = JSON.parse(/const path=("[^"]+")/.exec(code)![1]!) as string;
      const pinned = await file(join(config.dataRoot, "pinned.json"), "pinned collection fixture");
      const receipt = {
        schema: "shenron-source-collection/v1",
        configSha256: hash(await Bun.file(config.pipelineConfig).text()),
        pinnedConfigPath: "/app/data/source-pipeline/pinned.json",
        pinnedConfigSha256: hash(await Bun.file(pinned).text()),
        collectionSha256: "2".repeat(64),
        artifactsSha256: "3".repeat(64),
        revisionIdentity: "4".repeat(64),
      };
      await file(join(config.dataRoot, destination.split("/").at(-1)!), JSON.stringify(receipt));
    }
    return { code: 0, stdout: "" };
  };
  return { root, config, calls, run };
}
test("typed source job grants only private child capabilities and never mounts database credentials", async () => {
  const f = await fixture(),
    plan = await planSourceJob(f.config, { run: f.run });
  const args = sourceJobArgs(plan, "shenron-source-vpn-" + "a".repeat(16));
  expect(args).toContain("bridge");
  expect(args).not.toContain("host");
  expect(args).not.toContain("--privileged");
  expect(args).not.toContain("--env-file");
  expect(args.join(" ")).not.toContain("docker.sock");
  expect(args.join(" ")).not.toContain("DATABASE_URL");
  expect(args).toContain("TALPID_DNS_MODULE=static-file");
  expect(args).toContain("MULLVAD_RPC_SOCKET_PATH=/run/bun-vpn/pipeline.sock");
  expect(args).toContain("/dev/net/tun:/dev/net/tun");
  expect(args).toContain("none");
  expect(args.at(-1)).toContain("Bun.file(path).stream()");
  expect(args.at(-1)).not.toContain("Bun.file(path).bytes()");
  expect(args).toContain("/app/data/source-pipeline/credentials:ro,nosuid,nodev,noexec,mode=000");
});
test("only the pinned relay file is exposed even when its private parent contains other data", async () => {
  const f = await fixture();
  await fixtureFile(join(f.config.resources.path, "unrelated-private.json"), "private fixture");
  const plan = await planSourceJob(f.config, { run: f.run });
  const args = sourceJobArgs(plan, "shenron-source-vpn-" + "b".repeat(16));
  const mounts = args.filter((_, index) => args[index - 1] === "--mount");
  expect(mounts).toContain(
    `type=bind,src=${join(f.config.resources.path, "relays.json")},dst=/job/resources/relays.json,readonly`,
  );
  expect(mounts.some((mount) => mount.includes(`src=${f.config.resources.path},`))).toBe(false);
  expect(mounts.some((mount) => mount.includes("unrelated-private"))).toBe(false);
});
test("collection uses stdin login, UID1000 and finite teardown without claiming full pipeline success", async () => {
  const f = await fixture(),
    plan = await planSourceJob(f.config, { run: f.run });
  const result = await applySourceJob(plan, hash(JSON.stringify(plan)), {
    run: f.run,
    account: async () => "1234567890123456",
  });
  expect(result.collected).toBe(true);
  expect(result.pipelineComplete).toBe(false);
  expect(result.stage).toBe("collection-only");
  const login = f.calls.find((call) => call.args.includes("login"))!;
  expect(new TextDecoder().decode(login.stdin)).toBe("1234567890123456\n");
  expect(f.calls.some((call) => call.args.join(" ").includes("1234567890123456"))).toBe(false);
  const collect = f.calls.find((call) => call.args[1] === "exec" && call.args.includes("-e"))!;
  expect(collect.args).toContain("1000:1000");
  expect(collect.args.at(-1)).toContain("collectSourcePipeline");
  expect(collect.args.at(-1)).toContain("https://am.i.mullvad.net/json");
  expect(f.calls.some((call) => call.args[1] === "stop")).toBe(true);
  expect((await readdir(f.config.dataRoot)).some((path) => path.endsWith(".lock"))).toBe(false);
});
test("a failed container launch still removes an uncertain created child and releases the lock", async () => {
  const f = await fixture(),
    plan = await planSourceJob(f.config, { run: f.run });
  const run: NonNullable<SourceJobPorts["run"]> = async (args, options) => {
    const result = await f.run(args, options);
    return args[1] === "run" ? { code: 1, stdout: "" } : result;
  };
  await expect(
    applySourceJob(plan, hash(JSON.stringify(plan)), {
      run,
      account: async () => "1234567890123456",
    }),
  ).rejects.toThrow("native owner command failed");
  expect(f.calls.some((call) => call.args[1] === "stop")).toBe(true);
  expect((await readdir(f.config.dataRoot)).some((path) => path.endsWith(".lock"))).toBe(false);
});
test("teardown refuses a foreign container that raced an uncertain launch", async () => {
  const f = await fixture(),
    plan = await planSourceJob(f.config, { run: f.run });
  const run: NonNullable<SourceJobPorts["run"]> = async (args, options) => {
    const result = await f.run(args, options);
    if (args[1] === "run") return { code: 1, stdout: "" };
    if (args[1] === "inspect" && args.some((value) => value.includes(".Config.Labels")))
      return { code: 0, stdout: "foreign|foreign" };
    return result;
  };
  await expect(
    applySourceJob(plan, hash(JSON.stringify(plan)), {
      run,
      account: async () => "1234567890123456",
    }),
  ).rejects.toThrow("refused foreign");
  expect(f.calls.some((call) => call.args[1] === "stop")).toBe(false);
});
test("native command cancellation kills and reaps a process that ignores SIGTERM", async () => {
  const root = await mkdtemp(join(tmpdir(), "aphrody-source-vpn-cancel-"));
  roots.push(root);
  const ready = join(root, "ready");
  const controller = new AbortController();
  const result = sourceJobRun(
    [
      Bun.which("bun")!,
      "-e",
      `process.on("SIGTERM",()=>{});await Bun.write(${JSON.stringify(ready)},"ready");setInterval(()=>{},1000);`,
    ],
    { timeoutMs: 10000, signal: controller.signal },
  );
  const deadline = Date.now() + 5000;
  while (!(await Bun.file(ready).exists())) {
    if (Date.now() > deadline) throw Error("fixture not ready");
    await Bun.sleep(10);
  }
  const start = Date.now();
  controller.abort();
  expect((await result).code).not.toBe(0);
  expect(Date.now() - start).toBeLessThan(2500);
});
test("changed artifacts, unsafe cookie permissions and symlinked job roots fail before Docker", async () => {
  const f = await fixture(),
    plan = await planSourceJob(f.config, { run: f.run });
  await Bun.write(f.config.bundle.path, "changed");
  await expect(applySourceJob(plan, hash(JSON.stringify(plan)), { run: f.run })).rejects.toThrow(
    "artifact hash differs",
  );
  expect(f.calls.some((call) => call.args[0] === "docker")).toBe(false);
  await chmod(f.config.googleJar, 0o644);
  await expect(planSourceJob(f.config, { run: f.run })).rejects.toThrow("permissions");
  await chmod(f.config.googleJar, 0o600);
  const alias = join(f.root, "alias");
  await symlink(f.config.dataRoot, alias);
  await expect(planSourceJob({ ...f.config, dataRoot: alias }, { run: f.run })).rejects.toThrow(
    "regular owned",
  );
});
