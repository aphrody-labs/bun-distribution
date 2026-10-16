// SPDX-License-Identifier: MIT
import {
  decoder,
  LIMITS,
  type Ecosystem,
  type Fields,
  type PackageRecord,
} from "./types.ts";
import { required } from "./deb822.ts";

function assignments(data: Uint8Array): Array<[string, string]> {
  if (data.length > LIMITS.metadata)
    throw new Error("ALPM metadata exceeds limit");
  return decoder
    .decode(data)
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trimStart().startsWith("#"))
    .map((line) => {
      if (line.length > 65536) throw new Error("ALPM line exceeds limit");
      const match = /^\s*([a-z][a-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!match) throw new Error("Invalid ALPM assignment");
      return [match[1]!, match[2]!.trimEnd()];
    });
}

function append(fields: Fields, key: string, value: string) {
  (fields[key] ??= []).push(value);
}

function record(
  fields: Fields,
  ecosystem: Ecosystem,
  source: boolean,
): PackageRecord {
  const version = source
    ? `${fields.epoch?.[0] ? `${fields.epoch[0]}:` : ""}${required(fields, "pkgver")}-${required(fields, "pkgrel")}`
    : required(fields, "pkgver");
  const dependencies: Record<string, string[]> = Object.create(null);
  for (const [key, values] of Object.entries(fields)) {
    if (
      /^(depend|optdepend|makedepend|checkdepend|provides|conflict|replaces)(_|$)/.test(
        key,
      )
    )
      dependencies[key] = values;
  }
  const sources = Object.entries(fields)
    .filter(([key]) => /^source(_|$)/.test(key))
    .flatMap(([key, values]) => {
      const suffix = key.slice(6);
      const checksums = fields[`sha256sums${suffix}`] ?? [];
      if (checksums.length && checksums.length !== values.length)
        throw new Error("ALPM source/checksum count mismatch");
      return values.map((value, index) => {
        const separator = value.indexOf("::");
        const url = separator < 0 ? value : value.slice(separator + 2);
        const path =
          separator < 0 ? value.split("/").at(-1)! : value.slice(0, separator);
        const hash = checksums[index];
        if (hash && hash !== "SKIP" && !/^[a-fA-F0-9]{64}$/.test(hash))
          throw new Error("Invalid ALPM SHA256");
        return {
          path,
          url,
          integrity:
            hash && hash !== "SKIP"
              ? `sha256:${hash.toLowerCase()}`
              : undefined,
        };
      });
    });
  return {
    ecosystem,
    kind: source ? "source" : "binary",
    name: required(fields, "pkgname"),
    version,
    architecture: fields.arch?.join(" "),
    description: fields.pkgdesc?.[0],
    homepage: fields.url?.[0],
    licenses: fields.license ?? [],
    dependencies,
    sources,
    fields,
  };
}

export function pkginfo(
  data: Uint8Array,
  ecosystem: Ecosystem,
): PackageRecord[] {
  const fields: Fields = Object.create(null);
  for (const [key, value] of assignments(data)) append(fields, key, value);
  for (const key of ["pkgname", "pkgver", "arch"]) {
    if (fields[key]?.length !== 1)
      throw new Error(`ALPM needs exactly one ${key}`);
  }
  return [record(fields, ecosystem, false)];
}

/** .SRCINFO is parsed without executing PKGBUILD or its shell functions. */
export function srcinfo(
  data: Uint8Array,
  ecosystem: Ecosystem,
): PackageRecord[] {
  const base: Fields = Object.create(null);
  const packages: Fields[] = [];
  let current = base;
  for (const [key, value] of assignments(data)) {
    if (key === "pkgbase" && Object.keys(base).length)
      throw new Error("Repeated ALPM base section");
    if (key === "pkgname") {
      current = Object.create(null);
      packages.push(current);
    }
    append(current, key, value);
  }
  required(base, "pkgbase");
  if (!packages.length) throw new Error("ALPM source has no package sections");
  return packages.map((fields) =>
    record({ ...base, ...fields }, ecosystem, true),
  );
}
