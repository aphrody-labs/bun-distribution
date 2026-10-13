// SPDX-License-Identifier: MIT
import { decoder, LIMITS, type Ecosystem, type Fields, type PackageRecord, type SourceArtifact } from "./types.ts";

/** Debian control fields: case-insensitive names, folded values and blank-line stanzas. */
export function deb822(data: Uint8Array): Fields[] {
  if (data.length > LIMITS.metadata) throw new Error("Debian metadata exceeds limit");
  let text = decoder.decode(data);
  // .dsc files may carry a cleartext OpenPGP signature. Preserve its presence, never its trust claim.
  const signed = text.startsWith("-----BEGIN PGP SIGNED MESSAGE-----");
  if (signed) {
    const lines = text.split(/\r?\n/);
    const start = lines.indexOf("");
    const end = lines.indexOf("-----BEGIN PGP SIGNATURE-----", start + 1);
    if (start < 1 || end < start || !lines.includes("-----END PGP SIGNATURE-----"))
      throw new Error("Malformed Debian cleartext signature");
    text = lines
      .slice(start + 1, end)
      .map(line => (line.startsWith("- ") ? line.slice(2) : line))
      .join("\n");
  }
  const rows: Fields[] = [];
  let row: Fields = Object.create(null);
  let previous = "";
  for (const line of [...text.split(/\r?\n/), ""]) {
    if (line.length > 65536) throw new Error("Debian field line exceeds limit");
    if (!line.length) {
      if (Object.keys(row).length) rows.push(row);
      if (rows.length > LIMITS.entries) throw new Error("Too many Debian stanzas");
      row = Object.create(null);
      previous = "";
    } else if (/^[ \t]/.test(line)) {
      if (!previous) throw new Error("Orphan Debian continuation");
      const text = `${row[previous]![0]}\n${line.slice(1)}`;
      if (text.length > 1024 * 1024) throw new Error("Debian field exceeds limit");
      row[previous] = [text];
    } else if (!line.startsWith("#")) {
      const at = line.indexOf(":");
      const name = line.slice(0, at).toLowerCase();
      if (at < 1 || !/^[a-z0-9][a-z0-9-]*$/.test(name) || row[name])
        throw new Error("Invalid or duplicate Debian field");
      row[name] = [line.slice(at + 1).replace(/^[ \t]+/, "")];
      previous = name;
    }
  }
  if (signed) for (const fields of rows) fields["openpgp-clearsigned"] = ["present-unverified"];
  return rows;
}

export function required(fields: Fields, key: string): string {
  const value = fields[key]?.[0];
  if (!value) throw new Error(`Missing package field: ${key}`);
  return value;
}

function checksumFiles(fields: Fields): SourceArtifact[] {
  const byPath = new Map<string, SourceArtifact>();
  for (const [key, algorithm, digits] of [
    ["files", "md5", 32],
    ["checksums-sha1", "sha1", 40],
    ["checksums-sha256", "sha256", 64],
  ] as const) {
    for (const line of (fields[key]?.[0] ?? "").split("\n").filter(line => line.trim())) {
      const parts = line.trim().split(/\s+/);
      // Sources/.dsc use three columns; .changes may add section and priority columns.
      const [hash, size] = parts;
      const path = parts.at(-1);
      if (
        !hash ||
        !size ||
        !path ||
        ![3, 5].includes(parts.length) ||
        !new RegExp(`^[a-fA-F0-9]{${digits}}$`).test(hash) ||
        !/^\d+$/.test(size)
      )
        throw new Error("Invalid Debian source checksum");
      const count = Number(size);
      if (!Number.isSafeInteger(count)) throw new Error("Debian source size exceeds safe integer");
      const old = byPath.get(path);
      if (old && old.size !== count) throw new Error("Conflicting source artifact sizes");
      byPath.set(path, { path, size: count, integrity: `${algorithm}:${hash.toLowerCase()}` });
    }
  }
  return [...byPath.values()];
}

export function debianRecords(rows: Fields[], ecosystem: Ecosystem): PackageRecord[] {
  return rows.map(fields => {
    const name = fields.package?.[0] ?? required(fields, "source");
    if (!/^[a-z0-9][a-z0-9+.-]+$/.test(name)) throw new Error("Invalid Debian package name");
    const version = required(fields, "version");
    const source = !!fields.directory || !!fields["checksums-sha256"] || !!fields["binary"];
    const sources = checksumFiles(fields);
    if (fields.filename) {
      const artifact: SourceArtifact = { path: required(fields, "filename") };
      if (fields.size) {
        const size = required(fields, "size");
        if (!/^\d+$/.test(size) || !Number.isSafeInteger(Number(size))) throw new Error("Invalid Debian package size");
        artifact.size = Number(size);
      }
      if (fields.sha256) {
        const hash = required(fields, "sha256");
        if (!/^[a-fA-F0-9]{64}$/.test(hash)) throw new Error("Invalid Debian package SHA256");
        artifact.integrity = `sha256:${hash.toLowerCase()}`;
      }
      sources.push(artifact);
    }
    const dependencies: Record<string, string[]> = Object.create(null);
    for (const key of [
      "pre-depends",
      "depends",
      "recommends",
      "suggests",
      "enhances",
      "provides",
      "conflicts",
      "breaks",
      "replaces",
      "build-depends",
      "build-depends-indep",
      "build-depends-arch",
      "build-conflicts",
    ]) {
      if (fields[key]) dependencies[key] = fields[key]!;
    }
    return {
      ecosystem,
      kind: source ? "source" : "binary",
      name,
      version,
      architecture: fields.architecture?.[0],
      description: fields.description?.[0],
      homepage: fields.homepage?.[0],
      licenses: fields.license ?? [],
      dependencies,
      sources,
      fields,
    };
  });
}
