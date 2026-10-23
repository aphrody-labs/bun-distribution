// SPDX-License-Identifier: MIT
import { dirname, resolve } from "node:path";
import { runProcess } from "../../packages/bun-workspace/src/process.ts";
import type { PacmanRepository } from "./index.ts";

const fingerprintPattern = /^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/;
const invalidStatus = /\[GNUPG:\] (?:BADSIG|ERRSIG|NO_PUBKEY|REVKEYSIG|EXPKEYSIG|EXPSIG|FAILURE)\b/;

function validPrimaryFingerprints(status: string): string[] {
  if (invalidStatus.test(status)) throw new Error("Detached package signature contains an invalid GnuPG status.");
  const fingerprints = new Set<string>();
  for (const line of status.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (fields[0] !== "[GNUPG:]" || fields[1] !== "VALIDSIG") continue;
    const primary = fields[11] ?? fields[2];
    if (primary && fingerprintPattern.test(primary)) fingerprints.add(primary.toUpperCase());
  }
  if (!fingerprints.size) throw new Error("GnuPG reported no complete valid primary fingerprint.");
  return [...fingerprints];
}

/** Require the GnuPG owner-trust state used by the official Arch keyring. */
export function trustedPacmanSigners(status: string): string[] {
  if (!/\[GNUPG:\] TRUST_(?:FULLY|ULTIMATE)\b/.test(status))
    throw new Error("Package signer is not trusted by the official Arch keyring.");
  return validPrimaryFingerprints(status);
}

export interface PacmanSignatureEvidence {
  primaryFingerprints: string[];
  trust: "pinned" | "full" | "ultimate";
}

/** Verify a pacman detached signature against the selected repository trust policy. */
export async function verifyPacmanSignature(
  signaturePath: string,
  contentPath: string,
  repository: PacmanRepository,
): Promise<PacmanSignatureEvidence> {
  const gpg = Bun.which("gpg");
  if (!gpg) throw new Error("GnuPG is required to authenticate pacman repositories.");
  const expected = repository.signingKey?.toUpperCase();
  if (repository.family !== "archlinux" && !expected)
    throw new Error(`${repository.name}: no pinned primary signing fingerprint is configured.`);
  if (expected && !fingerprintPattern.test(expected))
    throw new Error(`${repository.name}: signingKey must be a full primary fingerprint.`);
  const configuredHome = Bun.env.PACMAN2APT_GNUPGHOME;
  const standardHome = Bun.env.GNUPGHOME;
  if (!configuredHome && !standardHome && process.platform !== "linux")
    throw new Error("Set PACMAN2APT_GNUPGHOME to an existing trusted GnuPG home.");
  const gpgHome = resolve(configuredHome || standardHome || "/etc/pacman.d/gnupg");
  const result = await runProcess(
    [
      gpg,
      "--no-options",
      "--homedir",
      gpgHome,
      "--batch",
      "--no-tty",
      "--no-auto-key-retrieve",
      "--no-auto-key-import",
      "--status-fd",
      "1",
      "--verify",
      signaturePath,
      contentPath,
    ],
    dirname(resolve(contentPath)),
    { timeoutMs: 30_000, maxOutputBytes: 64 * 1024 },
  );
  const status = result.stdout;
  if (result.code !== 0) throw new Error(`${repository.name}: detached signature verification failed.`);
  const primaryFingerprints = validPrimaryFingerprints(status);
  if (expected && !primaryFingerprints.includes(expected))
    throw new Error(`${repository.name}: signature is from an unexpected primary key.`);
  if (expected) return { primaryFingerprints, trust: "pinned" };
  const trusted = trustedPacmanSigners(status);
  return {
    primaryFingerprints: trusted,
    trust: /\[GNUPG:\] TRUST_ULTIMATE\b/.test(status) ? "ultimate" : "full",
  };
}
