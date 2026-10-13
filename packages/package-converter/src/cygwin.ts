// SPDX-License-Identifier: MIT
import { decoder, LIMITS, type Fields, type PackageRecord, type SourceArtifact } from "./types.ts";

/** setup.ini retains current/previous/test versions and native dependency expressions. */
export function cygwin(data: Uint8Array): PackageRecord[] {
  if (data.length > LIMITS.metadata) throw new Error("Cygwin metadata exceeds limit");
  const packages: PackageRecord[] = [];
  let name = "";
  let fields: Fields = Object.create(null);
  let common: Fields = Object.create(null);
  let channel = "current";
  let architecture: string | undefined;
  let pending: { key: string; value: string } | undefined;
  const emit = () => {
    if (!name || !fields.version) return;
    const all = { ...common, ...fields };
    const artifacts: SourceArtifact[] = [];
    for (const key of ["install", "source"]) {
      if (!all[key]) continue;
      const parts = all[key]![0]!.trim().split(/\s+/);
      if (parts.length !== 3 || !/^\d+$/.test(parts[1]!) || !/^[a-fA-F0-9]+$/.test(parts[2]!))
        throw new Error("Invalid Cygwin archive record");
      const algorithm = ({ 32: "md5", 40: "sha1", 64: "sha256", 128: "sha512" } as Record<number, string>)[
        parts[2]!.length
      ];
      if (!algorithm || !Number.isSafeInteger(Number(parts[1]))) throw new Error("Invalid Cygwin archive integrity");
      artifacts.push({
        path: parts[0]!,
        size: Number(parts[1]),
        integrity: `${algorithm}:${parts[2]!.toLowerCase()}`,
      });
    }
    packages.push({
      ecosystem: "cygwin",
      kind: all.install ? "binary" : "source",
      name,
      version: all.version![0]!,
      architecture: all.arch?.[0] ?? architecture,
      description: all.sdesc?.[0],
      homepage: all.homepage?.[0],
      licenses: all.license ?? [],
      sources: artifacts,
      dependencies: Object.fromEntries(
        ["requires", "depends2", "provides", "conflicts", "obsoletes", "build-depends"]
          .filter(key => all[key])
          .map(key => [key, all[key]!]),
      ),
      fields: { ...all, channel: [channel] },
    });
    if (packages.length > LIMITS.entries) throw new Error("Too many Cygwin records");
  };
  for (const line of decoder.decode(data).split(/\r?\n/)) {
    if (line.length > 65536) throw new Error("Cygwin line exceeds limit");
    if (pending) {
      pending.value += `\n${line}`;
      if (pending.value.length > LIMITS.metadata) throw new Error("Cygwin quoted field exceeds limit");
      if (line.endsWith('"')) {
        fields[pending.key] = [pending.value.slice(1, -1)];
        pending = undefined;
      }
      continue;
    }
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("@ ")) {
      emit();
      name = line.slice(2).trim();
      fields = Object.create(null);
      common = Object.create(null);
      channel = "current";
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.+-]*$/.test(name)) throw new Error("Invalid Cygwin package name");
    } else if (/^\[(prev|test|curr)\]$/.test(line)) {
      emit();
      common = { ...common, ...fields };
      delete common.version;
      delete common.install;
      delete common.source;
      fields = Object.create(null);
      channel = line.slice(1, -1);
    } else {
      const match = /^([a-z0-9_-]+):\s*(.*)$/.exec(line);
      if (!match) throw new Error("Invalid Cygwin setup line");
      if (!name) {
        if (match[1] === "arch") architecture = match[2]!;
        continue;
      }
      if (fields[match[1]!]) throw new Error("Duplicate Cygwin field");
      const value = match[2]!;
      if (value.startsWith('"') && !value.endsWith('"')) pending = { key: match[1]!, value };
      else fields[match[1]!] = [value.startsWith('"') ? value.slice(1, -1) : value];
    }
  }
  if (pending) throw new Error("Unterminated Cygwin quoted field");
  emit();
  return packages;
}
