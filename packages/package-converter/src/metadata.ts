// SPDX-License-Identifier: MIT
import { basename, resolve } from "node:path";
import { ar } from "./ar.ts";
import { abi } from "./abi.ts";
import { deb822, debianRecords } from "./deb822.ts";
import { pkginfo, srcinfo } from "./alpm.ts";
import { cygwin } from "./cygwin.ts";
import { decompress } from "./compression.ts";
import { tar } from "./tar.ts";
import {
  decoder,
  LIMITS,
  sha256,
  type Ecosystem,
  type InputFormat,
  type Inspection,
  type PackageRecord,
  type PayloadEntry,
} from "./types.ts";

export interface InputOptions {
  format: InputFormat;
  ecosystem: Ecosystem;
  decoder?: string;
  metadataFile?: string;
  metadataFormat?: InputFormat;
}

export async function readBounded(
  path: string,
  limit = LIMITS.packed,
): Promise<Uint8Array> {
  const file = Bun.file(path);
  if (!(await file.exists()) || file.size > limit)
    throw new Error(`Missing or oversized input: ${path}`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > limit) throw new Error("Input grew beyond byte limit");
  return bytes;
}

function sourceMetadata(
  entries: PayloadEntry[],
  ecosystem: Ecosystem,
): PackageRecord[] {
  const files = entries.filter((entry) => entry.kind === "file");
  const srcinfos = files.filter((entry) => basename(entry.path) === ".SRCINFO");
  if (srcinfos.length)
    return srcinfos.flatMap((entry) => srcinfo(entry.data, ecosystem));
  const pkginfos = files.filter((entry) => basename(entry.path) === ".PKGINFO");
  if (pkginfos.length)
    return pkginfos.flatMap((entry) => pkginfo(entry.data, ecosystem));
  const descriptors = files.filter((entry) => entry.path.endsWith(".dsc"));
  if (descriptors.length)
    return descriptors.flatMap((entry) =>
      debianRecords(deb822(entry.data), ecosystem),
    );
  const controls = files.filter((entry) =>
    /(^|\/)debian\/control$/.test(entry.path),
  );
  return controls.flatMap((entry) => {
    const prefix = entry.path.slice(0, -"debian/control".length);
    const changelog = files.find(
      (file) => file.path === `${prefix}debian/changelog`,
    );
    if (!changelog)
      throw new Error(
        "Debian source archive needs its changelog to preserve the source version",
      );
    const first = decoder.decode(changelog.data).split(/\r?\n/, 1)[0]!;
    const version = /^[^\s]+\s+\(([^)]+)\)/.exec(first)?.[1];
    if (!version) throw new Error("Invalid Debian source changelog header");
    const rows = deb822(entry.data);
    return debianRecords(
      rows.map((row, index) => ({
        ...row,
        version: [version],
        ...(index === 0
          ? { binary: rows.slice(1).map((binary) => binary.package?.[0] ?? "") }
          : {}),
      })),
      ecosystem,
    );
  });
}

export async function inspect(
  path: string,
  options: InputOptions,
): Promise<{ inspection: Inspection; entries: PayloadEntry[] }> {
  const formats =
    options.ecosystem === "cygwin"
      ? ["cygwin", "source-archive"]
      : ["alpm", "msys2", "mingw"].includes(options.ecosystem)
        ? ["pkginfo", "srcinfo", "alpm-archive", "source-archive"]
        : ["deb", "deb822", "source-archive"];
  if (!formats.includes(options.format))
    throw new Error("Input format and package ecosystem do not match");
  const data = await readBounded(path);
  let packages: PackageRecord[];
  let entries: PayloadEntry[] = [];
  let companion: Inspection["companion"];
  if (options.format === "deb") {
    const members = ar(data);
    if (
      members[0]?.name !== "debian-binary" ||
      !/^2\.\d+\n/.test(decoder.decode(members[0].data))
    )
      throw new Error("Unsupported Debian binary format");
    const controls = members.filter((member) =>
      /^control\.tar(?:\.(?:gz|xz|zst|bz2))?$/.test(member.name),
    );
    const payloads = members.filter((member) =>
      /^data\.tar(?:\.(?:gz|xz|zst|bz2))?$/.test(member.name),
    );
    if (
      controls.length !== 1 ||
      payloads.length !== 1 ||
      members.indexOf(controls[0]!) >= members.indexOf(payloads[0]!)
    )
      throw new Error("Debian archive needs ordered control/data members");
    const controlIndex = members.indexOf(controls[0]!);
    const dataIndex = members.indexOf(payloads[0]!);
    for (let index = 1; index < dataIndex; index++) {
      if (index !== controlIndex && !members[index]!.name.startsWith("_"))
        throw new Error("Unknown Debian member before its data archive");
    }
    const control = tar(
      await decompress(controls[0]!.data, options.decoder),
    ).find((entry) => entry.path === "control" && entry.kind === "file");
    if (!control) throw new Error("Debian archive has no control file");
    packages = debianRecords(deb822(control.data), options.ecosystem);
    if (packages.length !== 1)
      throw new Error("Debian binary archive must have one control stanza");
    entries = tar(await decompress(payloads[0]!.data, options.decoder));
  } else if (options.format === "deb822")
    packages = debianRecords(deb822(data), options.ecosystem);
  else if (options.format === "pkginfo")
    packages = pkginfo(data, options.ecosystem);
  else if (options.format === "srcinfo")
    packages = srcinfo(data, options.ecosystem);
  else if (options.format === "cygwin") packages = cygwin(data);
  else {
    entries = tar(await decompress(data, options.decoder));
    if (options.format === "alpm-archive") {
      const metadata = entries.find(
        (entry) => entry.path === ".PKGINFO" && entry.kind === "file",
      );
      if (!metadata) throw new Error("ALPM archive has no root .PKGINFO");
      packages = pkginfo(metadata.data, options.ecosystem);
    } else if (options.metadataFile) {
      if (
        !options.metadataFormat ||
        !["deb822", "pkginfo", "srcinfo", "cygwin"].includes(
          options.metadataFormat,
        )
      )
        throw new Error("Source companion needs a metadata format");
      const source = await inspect(options.metadataFile, {
        format: options.metadataFormat,
        ecosystem: options.ecosystem,
      });
      packages = source.inspection.packages;
      companion = source.inspection.input;
      for (const pkg of packages)
        for (const artifact of pkg.sources) {
          if (basename(artifact.path) !== basename(path)) continue;
          if (artifact.size !== undefined && artifact.size !== data.length)
            throw new Error("Source archive differs from companion size");
          if (artifact.integrity) {
            const [algorithm, expected] = artifact.integrity.split(":");
            if (!["md5", "sha1", "sha256", "sha512"].includes(algorithm!))
              throw new Error("Unsupported source checksum algorithm");
            const actual = new Bun.CryptoHasher(
              algorithm as "md5" | "sha1" | "sha256" | "sha512",
            )
              .update(data)
              .digest("hex");
            if (actual !== expected)
              throw new Error(
                "Source archive checksum differs from companion metadata",
              );
          }
        }
    } else packages = sourceMetadata(entries, options.ecosystem);
    if (!packages.length)
      throw new Error("Archive has no supported package source metadata");
  }
  const payload = entries.map((entry) => ({
    path: entry.path,
    kind: entry.kind,
    mode: entry.mode,
    link: entry.link,
    size: entry.data.length,
    sha256: entry.kind === "file" ? sha256(entry.data) : undefined,
    abi: entry.kind === "file" ? abi(entry.data) : undefined,
  }));
  return {
    inspection: {
      schema: 1,
      input: {
        path: resolve(path),
        sha256: sha256(data),
        size: data.length,
        format: options.format,
      },
      companion,
      packages,
      payload,
    },
    entries,
  };
}
