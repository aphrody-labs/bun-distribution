// SPDX-License-Identifier: Apache-2.0
import { chmod, lstat, open, readdir, rename, unlink } from "node:fs/promises";

const TARGET = "/etc/aphrody/cloudflare/cli/cdn-origin.mjs";
const UNIT = "/etc/systemd/system/shenron-cdn-origin.service";
const CONFIG = "/etc/aphrody/cloudflare/origin-cdn.json";
const SERVICE = "shenron-cdn-origin.service";
const sha = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

export interface ConsumerPins {
  sourceCommit: string;
  beforeCodeSha256: string;
  candidateCodeSha256: string;
  unitSha256: string;
  configSha256: string;
}

export function validateConsumerPins(pins: ConsumerPins) {
  if (!/^[a-f0-9]{40}$/.test(pins.sourceCommit)) throw Error("Qualified source commit required");
  for (const name of ["beforeCodeSha256", "candidateCodeSha256", "unitSha256", "configSha256"] as const)
    if (!/^[a-f0-9]{64}$/.test(pins[name])) throw Error("Complete qualified SHA256 pins required");
  if (pins.beforeCodeSha256 === pins.candidateCodeSha256) throw Error("Distinct qualified consumer required");
}

export function assertConsumerFile(
  info: {
    uid: number;
    mode: number;
    isFile(): boolean;
    isSymbolicLink(): boolean;
  },
  privateFile: boolean,
) {
  if (!info.isFile() || info.isSymbolicLink() || info.uid !== 0 || (privateFile && info.mode & 0o077))
    throw Error("Canonical root owned regular file required");
}

function command(args: string[]) {
  const result = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw Error(`Qualified operation failed: ${args[0]}`);
  return new TextDecoder().decode(result.stdout).trim();
}

/** Product supplies one pinned artifact; Infra alone replaces the installed consumer. */
export async function applyOriginConsumer(candidate: string, pins: ConsumerPins, apply = false) {
  validateConsumerPins(pins);
  if (process.platform !== "linux" || process.getuid?.() !== 0) throw Error("Native root Infra execution required");
  const candidateInfo = await lstat(candidate);
  if (!candidateInfo.isFile() || candidateInfo.isSymbolicLink() || candidateInfo.size > 2 * 1024 * 1024)
    throw Error("Bounded regular product artifact required");
  const bytes = await Bun.file(candidate).bytes();
  if (sha(bytes) !== pins.candidateCodeSha256) throw Error("Product artifact SHA256 mismatch");
  async function unchanged() {
    const inputs = [
      [TARGET, pins.beforeCodeSha256, true],
      [UNIT, pins.unitSha256, false],
      [CONFIG, pins.configSha256, true],
    ] as const;
    await Promise.all(
      inputs.map(async ([path, expected, privateFile]) => {
        assertConsumerFile(await lstat(path), privateFile);
        if (sha(await Bun.file(path).bytes()) !== expected) throw Error("Concurrent consumer input changed");
      }),
    );
    if (
      command(["systemctl", "show", SERVICE, "--value", "-p", "FragmentPath"]) !== UNIT ||
      command(["systemctl", "is-active", SERVICE]) !== "active"
    )
      throw Error("Canonical active unit required");
  }
  await unchanged();
  const mainPid = command(["systemctl", "show", SERVICE, "--value", "-p", "MainPID"]);
  const owners: string[] = [];
  const pids = (await readdir("/proc")).filter(value => /^\d+$/.test(value));
  let cursor = 0;
  async function inspectConsumer(): Promise<void> {
    const pid = pids[cursor++];
    if (!pid) return;
    const argv = await Bun.file(`/proc/${pid}/cmdline`)
      .text()
      .catch(() => "");
    if (argv.split("\0").includes(TARGET)) owners.push(pid);
    return inspectConsumer();
  }
  await Promise.all(Array.from({ length: Math.min(32, pids.length) }, inspectConsumer));
  if (owners.length !== 1 || owners[0] !== mainPid) throw Error("Exactly one current service consumer required");
  if (!apply)
    return {
      status: "qualified_unapplied",
      sourceCommit: pins.sourceCommit,
      beforeCodeSha256: pins.beforeCodeSha256,
      candidateCodeSha256: pins.candidateCodeSha256,
      service: SERVICE,
    };
  const temporary = `${TARGET}.candidate-${pins.candidateCodeSha256.slice(0, 16)}`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
    await file.close();
    await chmod(temporary, 0o600);
    await unchanged();
    await rename(temporary, TARGET);
  } finally {
    await file.close().catch(() => {});
    await unlink(temporary).catch((error: any) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  command(["timeout", "25", "systemctl", "restart", SERVICE]);
  if (
    sha(await Bun.file(UNIT).bytes()) !== pins.unitSha256 ||
    sha(await Bun.file(CONFIG).bytes()) !== pins.configSha256
  )
    throw Error("Unrelated runtime inputs changed");
  const response = await fetch("http://127.0.0.1:9077/.well-known/shenron-cdn-origin.json", {
    signal: AbortSignal.timeout(10000),
  }).catch((error: any) => {
    if (error.code !== "ECONNREFUSED") throw error;
    return null;
  });
  if (!response) {
    if (
      sha(await Bun.file(TARGET).bytes()) !== pins.candidateCodeSha256 ||
      command(["systemctl", "is-active", SERVICE]) !== "active"
    )
      throw Error("Installed consumer or service state mismatch");
    return {
      status: "installed_readiness_pending",
      sourceCommit: pins.sourceCommit,
      codeSha256: pins.candidateCodeSha256,
      service: SERVICE,
      configPreserved: true,
      unitPreserved: true,
      independentAttestationRequired: true,
    };
  }
  const attestation = await response.json();
  if (
    !response.ok ||
    attestation.codeSha256 !== pins.candidateCodeSha256 ||
    attestation.backend !== "native-manifest-origin"
  )
    throw Error("Live consumer attestation mismatch");
  return {
    status: "installed_and_attested",
    sourceCommit: pins.sourceCommit,
    codeSha256: attestation.codeSha256,
    inventorySha256: attestation.inventorySha256,
    service: SERVICE,
    configPreserved: true,
    unitPreserved: true,
  };
}

if (import.meta.main) {
  const [candidate, pinFile, mode] = Bun.argv.slice(2);
  if (!candidate || !pinFile || !["--plan", "--apply"].includes(mode ?? ""))
    throw Error("Expected CANDIDATE PINS --plan|--apply");
  const result = await applyOriginConsumer(candidate, await Bun.file(pinFile).json(), mode === "--apply");
  console.log(JSON.stringify(result));
}
