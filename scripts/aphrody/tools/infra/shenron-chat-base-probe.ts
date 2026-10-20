#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/** Isolated base-only language probe; never configures a caller or changes an adapter. */
import { chmodSync } from "node:fs";
import { join } from "node:path";
import { CHAT_DIGESTS } from "./shenron-chat-recovery";
const NAME = "aphrody-shenron-chat-base-probe";
export const BASE_PROBE_MODEL = "qwen3-4b-instruct-2507-no-lora";
export function baseProbeArgs(image: string, runtime: string, base: string) {
  if (!/^aphrody:toolbox-[a-f0-9]{12}$/.test(image))
    throw Error("Immutable toolbox image required");
  for (const path of [runtime, base])
    if (!path.startsWith("/") || /[\r\n:]/.test(path))
      throw Error("Absolute Linux mount paths required");
  return [
    "create",
    "--name",
    NAME,
    "--network",
    "host",
    "--read-only",
    "--user",
    "1000:1000",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--memory",
    "3500m",
    "--cpus",
    "1",
    "--tmpfs",
    "/tmp:uid=1000,gid=1000,mode=0700",
    "-e",
    "HOME=/tmp",
    "-v",
    runtime + ":/llama:ro",
    "-v",
    base + ":/models/base.gguf:ro",
    image,
    "/llama/llama-server",
    "--model",
    "/models/base.gguf",
    "--alias",
    BASE_PROBE_MODEL,
    "--host",
    "127.0.0.1",
    "--port",
    "8800",
    "--ctx-size",
    "8192",
    "--parallel",
    "1",
    "--threads",
    "1",
    "--threads-batch",
    "1",
    "--n-gpu-layers",
    "0",
  ];
}
async function command(args: string[], optional = false) {
  const p = Bun.spawn(["docker", ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, code] = await Promise.all([
    new Response(p.stdout).text(),
    p.exited,
  ]);
  if (code && !optional) throw Error(`Docker ${args[0]} failed (${code})`);
  return { out: out.trim(), code };
}
async function digest(path: string) {
  const h = new Bun.CryptoHasher("sha256");
  for await (const p of Bun.file(path).stream()) h.update(p);
  return h.digest("hex");
}
async function main() {
  const argv = process.argv.slice(2);
  const value = (name: string) => {
    const i = argv.indexOf(name);
    if (i < 0 || !argv[i + 1]) throw Error(`Missing ${name}`);
    return argv[i + 1]!;
  };
  const image = value("--image"),
    runtime = value("--runtime"),
    base = value("--base"),
    payload = value("--payload"),
    report = value("--report");
  const args = baseProbeArgs(image, runtime, base);
  console.log(
    JSON.stringify({
      owner: "aphrody-infra",
      mode: argv.includes("--apply") ? "apply" : "plan",
      model: BASE_PROBE_MODEL,
      listener: "127.0.0.1:8800",
      resources: {
        v2CpusDuringProbe: 4,
        candidateCpus: 1,
        candidateMemory: "3500m",
        reservedHostCpu: 1,
      },
      publicRoutingChanged: false,
      adapterMounted: false,
      cleanup: "remove owned probe container; restore exact prior v2 CPU quota",
    }),
  );
  if (!argv.includes("--apply")) return;
  if (process.getuid?.() !== 0)
    throw Error("Apply requires Infra root execution");
  const memory = await Bun.file("/proc/meminfo").text();
  const availableKiB = Number(memory.match(/^MemAvailable:\s+(\d+) kB/m)?.[1]);
  if (!Number.isFinite(availableKiB) || availableKiB < 4500 * 1024)
    throw Error(
      "Base probe requires 4500 MiB available memory including product headroom",
    );
  const inputs = await Bun.file(payload).json();
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > 3)
    throw Error("One to three private probe requests required");
  for (const request of inputs)
    if (
      !Array.isArray(request.messages) ||
      request.messages.length > 32 ||
      request.max_tokens !== 256
    )
      throw Error("Probe preserves the 256 token budget and bounded messages");
  if (
    (await digest(base)) !== CHAT_DIGESTS.base ||
    (await digest(join(runtime, "llama-server"))) !== CHAT_DIGESTS.server
  )
    throw Error("Pinned base/runtime digest mismatch");
  if (!(await command(["inspect", NAME], true)).code)
    throw Error("Probe name is already owned");
  const live = JSON.parse(
    (await command(["inspect", "aphrody-shenron-chat-1"])).out,
  )[0];
  if (live.HostConfig.NanoCpus !== 5_000_000_000)
    throw Error("Expected five-CPU v2 service before reserving one probe CPU");
  const id = live.Id;
  let probeId: string | undefined;
  const results: unknown[] = [];
  try {
    await command(["update", "--cpus", "4", id]);
    probeId = (await command(args)).out;
    await command(["start", probeId]);
    const deadline = Date.now() + 180000;
    while (true) {
      if (
        await fetch("http://127.0.0.1:8800/health", {
          signal: AbortSignal.timeout(2000),
        })
          .then((r) => r.ok)
          .catch(() => false)
      )
        break;
      if (Date.now() > deadline) throw Error("Base probe did not become ready");
      await Bun.sleep(500);
    }
    for (const input of inputs) {
      const started = performance.now();
      const r = await fetch("http://127.0.0.1:8800/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...input, model: BASE_PROBE_MODEL }),
        signal: AbortSignal.timeout(300000),
      });
      const body = await r.json();
      const result = {
        lang: input.lang,
        model: BASE_PROBE_MODEL,
        status: r.status,
        elapsedMs: Math.round(performance.now() - started),
        answer: body.choices?.[0]?.message?.content,
        finishReason: body.choices?.[0]?.finish_reason,
        usage: body.usage,
        timings: body.timings,
      };
      results.push(result);
      await Bun.write(
        report,
        JSON.stringify(
          {
            at: new Date().toISOString(),
            candidateOnly: true,
            publicRoutingChanged: false,
            results,
          },
          null,
          2,
        ),
      );
      chmodSync(report, 0o600);
      console.log(JSON.stringify(result));
    }
  } finally {
    if (probeId) await command(["rm", "-f", probeId]);
    const current = JSON.parse((await command(["inspect", id])).out)[0];
    if (current.HostConfig.NanoCpus === 4_000_000_000)
      await command(["update", "--cpus", "5", id]);
    else {
      console.error("Concurrent quota change observed; do not overwrite it");
      process.exitCode = 1;
    }
  }
}
if (import.meta.main) await main();
