#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
// pacman2apt: Arch-family binary packages (CachyOS, Arch, Omarchy) to Ubuntu .deb packages
// and a flat APT repository. Formats: deb(5), deb-control(5), deb-triggers(5), alpm-repo-db(5),
// PKGINFO(5), mtree(5).
import type { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { lstat, mkdir, readdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { runProcess } from "@aphrody/bun-workspace/process";
import {
  pacmanRepositories,
  repositoryUrls,
} from "../../../factory/arch/index.ts";
import { verifyPacmanSignature } from "../../../factory/arch/signatures.ts";
import curated from "../data/pacman2apt.json";
import { decompress } from "./compression.ts";
import {
  compareDotted,
  elfDynamic,
  highestVersions,
  isElf,
  type ElfDynamic,
} from "./elf.ts";
import { pkginfo } from "./alpm.ts";
import {
  openIndex,
  PacmanIndex,
  parseDependency,
  sonameProvide,
  syncRepository,
  type PacmanPackage,
  type PacmanRepository,
} from "./pacman-db.ts";
import { decodedFile, download } from "./remote.ts";
import { tar, tarStream, TarWriter, type TarWriteEntry } from "./tar.ts";
import {
  hostSeries,
  syncUbuntu,
  UbuntuIndex,
  usrMerged,
} from "./ubuntu-index.ts";

type Relation = string;

export interface Policy {
  target: { abi: Record<string, string>; series: string };
  nameSuffix: Record<string, string>;
  protected: string[];
  override: Record<string, string | null>;
  map: Record<string, string | null>;
}

export interface ConvertOptions {
  state: string;
  out: string;
  withDeps: boolean;
  /** Relocation root for the requested packages; `{name}` expands to the pacman name. */
  prefix?: string;
  allowUnresolved: boolean;
  skip: Set<string>;
  elfDeps: "depends" | "recommends" | "none";
  policy: Policy;
  log: (line: string) => void;
}

export interface ConvertedPackage {
  pacman: { repo?: string; name: string; version: string; sha256: string };
  debian: { name: string; version: string; architecture: string };
  deb: string;
  report: string;
  depends: Relation[];
  recommends: Relation[];
  conflicts: Array<{ path: string; owners: string[] }>;
  warnings: string[];
}

interface Mapping {
  dependency: string;
  result: "ubuntu" | "drop" | "pacman" | "unresolved";
  via: string;
  relations?: Relation[];
  pkg?: PacmanPackage;
}

const METADATA = new Set([
  ".PKGINFO",
  ".BUILDINFO",
  ".MTREE",
  ".INSTALL",
  ".CHANGELOG",
]);

export function defaultState(): string {
  return (
    process.env.PACMAN2APT_STATE ??
    join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "pacman2apt")
  );
}

export function loadPolicy(extra?: Partial<Policy>): Policy {
  const base = curated as unknown as Policy;
  return {
    ...base,
    override: { ...base.override, ...extra?.override },
    map: { ...base.map, ...extra?.map },
  };
}

const glob = (pattern: string) =>
  new RegExp(
    `^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")}$`,
  );

export function isProtected(policy: Policy, name: string): boolean {
  return policy.protected.some((pattern) => glob(pattern).test(name));
}

/** `[epoch:]pkgver-pkgrel` to a Debian version marked as a pacman2apt build. */
export function debianVersion(version: string): string {
  const match = /^(?:(\d+):)?(.+)-([^-]+)$/.exec(version);
  if (!match) throw new Error(`Invalid pacman version: ${version}`);
  let upstream = match[2]!.replace(/[^A-Za-z0-9.+~]/g, ".");
  if (!/^\d/.test(upstream)) upstream = `0.${upstream}`;
  const revision = match[3]!.replace(/[^A-Za-z0-9.+~]/g, ".");
  return `${match[1] ? `${match[1]}:` : ""}${upstream}-${revision}+pacman2apt`;
}

const sanitizeName = (name: string) =>
  name
    .toLowerCase()
    .replaceAll("@", "-at-")
    .replace(/[^a-z0-9+.-]/g, "-")
    .replace(/^[^a-z0-9]+/, "");

/** Debian name; a collision with an Ubuntu package gets the repository-family suffix. */
export function debianName(
  pkg: Pick<PacmanPackage, "name" | "family">,
  ubuntu: UbuntuIndex,
  policy: Policy,
): string {
  const name = sanitizeName(pkg.name);
  return ubuntu.has(name)
    ? `${name}${policy.nameSuffix[pkg.family] ?? "-pacman"}`
    : name;
}

function relationFrom(value: string): Relation[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Probe the running Ubuntu host for its real glibc/libstdc++ symbol versions. */
export async function targetAbi(
  policy: Policy,
  series: string | undefined,
): Promise<Record<string, string>> {
  const abi = { ...policy.target.abi };
  if (!series || series !== (await hostSeries())) return abi;
  for (const path of [
    "/usr/lib/x86_64-linux-gnu/libc.so.6",
    "/usr/lib/x86_64-linux-gnu/libstdc++.so.6",
  ]) {
    const file = Bun.file(path);
    if (!(await file.exists())) continue;
    const dynamic = elfDynamic(new Uint8Array(await file.arrayBuffer()));
    Object.assign(abi, highestVersions(dynamic?.versionDefinitions ?? []));
  }
  return abi;
}

interface InstalledOwners {
  owners(path: string): string[];
}

/** dpkg's installed file lists, loaded only for the paths a package ships. */
async function installedOwners(
  paths: Set<string>,
): Promise<InstalledOwners | undefined> {
  const info = "/var/lib/dpkg/info";
  if (process.platform !== "linux") return undefined;
  let names: string[];
  try {
    names = (await readdir(info)).filter((name) => name.endsWith(".list"));
  } catch {
    return undefined;
  }
  const found = new Map<string, string[]>();
  for (const name of names) {
    const owner = name.slice(0, -5).replace(/:.*$/, "");
    for (const line of (await Bun.file(join(info, name)).text()).split("\n")) {
      const path = usrMerged(line);
      if (paths.has(path)) found.set(path, [...(found.get(path) ?? []), owner]);
    }
  }
  return { owners: (path) => found.get(path) ?? [] };
}

function mtreeDigests(data: Uint8Array): Map<string, string> {
  const digests = new Map<string, string>();
  let defaults: Record<string, string> = Object.create(null);
  const unescape = (value: string) => {
    const bytes: number[] = [];
    for (let index = 0; index < value.length; index++) {
      const octal = /^\\([0-7]{3})/.exec(value.slice(index));
      if (octal) {
        bytes.push(Number.parseInt(octal[1]!, 8));
        index += 3;
      } else bytes.push(...new TextEncoder().encode(value[index]!));
    }
    return new TextDecoder().decode(new Uint8Array(bytes));
  };
  for (const line of new TextDecoder().decode(data).split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const [first, ...tokens] = line.trim().split(/\s+/);
    const fields: Record<string, string> = Object.create(null);
    for (const token of tokens) {
      const equal = token.indexOf("=");
      if (equal > 0) fields[token.slice(0, equal)] = token.slice(equal + 1);
    }
    if (first === "/set") defaults = { ...defaults, ...fields };
    else if (first && !first.startsWith("/")) {
      const merged = { ...defaults, ...fields };
      if ((merged.type ?? "file") === "file" && merged.sha256digest)
        digests.set(
          unescape(first).replace(/^\.\//, ""),
          merged.sha256digest.toLowerCase(),
        );
    }
  }
  return digests;
}

const FORBIDDEN_SCRIPT =
  /\b(pacman|pacman-key|pacman-conf|makepkg|mkinitcpio|arch-chroot|paccache|pacdiff|repo-add|vercmp|dracut-rebuild|limine-update)\b/;

interface ScriptPlan {
  scripts: Record<string, string>;
  triggers: string[];
  notes: string[];
}

/** .INSTALL functions and libalpm hook effects as dpkg maintainer scripts and triggers. */
function maintainerScripts(
  install: string | undefined,
  paths: string[],
  pacmanVersion: string,
  relocated: boolean,
): ScriptPlan {
  const plan: ScriptPlan = { scripts: {}, triggers: [], notes: [] };
  if (relocated) {
    if (install)
      plan.notes.push(".INSTALL not translated: payload is relocated");
    plan.notes.push("pacman hooks not mapped: payload is relocated");
    return plan;
  }
  const has = (pattern: RegExp) => paths.some((path) => pattern.test(path));
  const triggers = new Set<string>();
  const post: string[] = [];
  const postrm: string[] = [];
  if (has(/^usr\/lib(32)?\/[^/]+\.so(\.|$)/)) triggers.add("ldconfig");
  for (const [pattern, trigger] of [
    [/^usr\/share\/icons\/hicolor\//, "/usr/share/icons/hicolor"],
    [/^usr\/share\/applications\/.+\.desktop$/, "/usr/share/applications"],
    [/^usr\/share\/glib-2\.0\/schemas\//, "/usr/share/glib-2.0/schemas"],
    [/^usr\/share\/mime\/packages\//, "/usr/share/mime/packages"],
    [/^usr\/share\/fonts\//, "/usr/share/fonts"],
    [/^usr\/share\/info\//, "/usr/share/info"],
    [/^usr\/lib\/udev\/hwdb\.d\//, "/usr/lib/udev/hwdb.d"],
    [/^usr\/lib\/sysctl\.d\//, "/usr/lib/sysctl.d"],
    [/^usr\/lib\/binfmt\.d\//, "/usr/lib/binfmt.d"],
    [/^usr\/share\/dbus-1\/system\.d\//, "/usr/share/dbus-1/system.d"],
  ] as const)
    if (has(pattern)) triggers.add(trigger);
  const units = has(/^usr\/lib\/systemd\/(system|user)\//);
  if (units) {
    const reload =
      "if [ -d /run/systemd/system ]; then systemctl daemon-reload >/dev/null 2>&1 || true; fi";
    post.push(reload);
    postrm.push(reload);
    plan.notes.push("systemd units: daemon-reload only; units are not enabled");
  }
  const sysusers = paths.filter((path) =>
    /^usr\/lib\/sysusers\.d\/.+\.conf$/.test(path),
  );
  if (sysusers.length)
    post.push(
      `if command -v systemd-sysusers >/dev/null; then systemd-sysusers ${sysusers.map((path) => `/${path}`).join(" ")} || true; fi`,
    );
  const tmpfiles = paths.filter((path) =>
    /^usr\/lib\/tmpfiles\.d\/.+\.conf$/.test(path),
  );
  if (tmpfiles.length)
    post.push(
      `if command -v systemd-tmpfiles >/dev/null; then systemd-tmpfiles --create ${tmpfiles.map((path) => `/${path}`).join(" ")} || true; fi`,
    );
  if (has(/^usr\/lib\/udev\/rules\.d\//))
    post.push(
      "if [ -d /run/udev ]; then udevadm control --reload >/dev/null 2>&1 || true; fi",
    );
  if (has(/^usr\/lib\/modules\//))
    plan.notes.push("kernel modules shipped: depmod is not run");
  plan.triggers = [...triggers].map((name) => `activate-noawait ${name}`);
  let body = "";
  const functions = new Set<string>();
  if (install) {
    if (FORBIDDEN_SCRIPT.test(install))
      plan.notes.push(
        `.INSTALL not translated: uses pacman-specific tooling (${FORBIDDEN_SCRIPT.exec(install)![1]})`,
      );
    else {
      body = install;
      const services =
        /systemctl\s+(?:--\S+\s+)*(enable|restart|start|reload)\b/.exec(
          install,
        );
      if (services)
        plan.notes.push(
          `.INSTALL calls systemctl ${services[1]}: services change on install/upgrade, as with pacman`,
        );
      for (const match of install.matchAll(
        /^\s*(?:function\s+)?((?:pre|post)_(?:install|upgrade|remove))\s*\(\s*\)/gm,
      ))
        functions.add(match[1]!);
      plan.notes.push(
        `.INSTALL translated: ${[...functions].join(", ") || "no functions"}`,
      );
    }
  }
  const call = (name: string, args: string) =>
    functions.has(name)
      ? `${name} ${args} || echo "pacman2apt: ${name} failed (ignored like pacman)" >&2`
      : "";
  const old = 'old="${2%+pacman2apt}"';
  const script = (cases: string, extra: string[] = []) =>
    `#!/bin/bash\nset -e\n# Generated by pacman2apt from .INSTALL and libalpm hook effects.\n${body ? `${body}\n` : ""}case "$1" in\n${cases}\nesac\n${extra.join("\n")}\nexit 0\n`;
  const version = JSON.stringify(pacmanVersion);
  if (functions.has("pre_install") || functions.has("pre_upgrade"))
    plan.scripts.preinst = script(
      `  install) ${call("pre_install", version) || ":"} ;;\n  upgrade) ${old}; ${call("pre_upgrade", `${version} "$old"`) || ":"} ;;`,
    );
  if (
    functions.has("post_install") ||
    functions.has("post_upgrade") ||
    post.length
  )
    plan.scripts.postinst = script(
      `  configure)\n    if [ -z "$2" ]; then ${call("post_install", version) || ":"}; else ${old}; ${call("post_upgrade", `${version} "$old"`) || ":"}; fi\n    ${post.join("\n    ")}\n    ;;`,
    );
  if (functions.has("pre_remove"))
    plan.scripts.prerm = script(`  remove) ${call("pre_remove", version)} ;;`);
  if (functions.has("post_remove") || postrm.length)
    plan.scripts.postrm = script(
      `  remove) ${call("post_remove", version) || ":"}; ${postrm.join("; ") || ":"} ;;`,
    );
  return plan;
}

interface PayloadSummary {
  pkginfo?: Uint8Array;
  install?: string;
  mtree?: Map<string, string>;
  entries: Array<{
    path: string;
    source: string;
    kind: TarWriteEntry["kind"];
    size: number;
    md5?: string;
  }>;
  sha256: Map<string, string>;
  elf: Array<{ path: string; dynamic: ElfDynamic }>;
  warnings: string[];
  installedKiB: number;
}

/** One streaming pass: pacman payload to a root-owned, optionally relocated data.tar.zst. */
async function transcodePayload(
  input: string,
  output: string,
  prefix: string | undefined,
  limit: number,
): Promise<PayloadSummary> {
  const summary: PayloadSummary = {
    entries: [],
    sha256: new Map(),
    elf: [],
    warnings: [],
    installedKiB: 0,
  };
  const compressor = new CompressionStream("zstd" as CompressionFormat);
  const writer = compressor.writable.getWriter();
  const sink = Bun.file(output).writer();
  const pump = (async () => {
    let count = 0;
    for await (const chunk of compressor.readable) {
      sink.write(chunk);
      if (++count % 64 === 0) await sink.flush();
    }
    await sink.end();
  })();
  const tarWriter = new TarWriter(async (chunk) => {
    await writer.ready;
    await writer.write(chunk as Uint8Array<ArrayBuffer>);
  });
  const owners = new Set<string>();
  const relocate = (path: string) => (prefix ? `${prefix}/${path}` : path);
  try {
    let mtime = 0;
    await tarWriter.add({ path: "", kind: "directory", mode: 0o755, mtime });
    if (prefix) {
      const parts = prefix.split("/");
      for (let index = 1; index <= parts.length; index++)
        await tarWriter.add({
          path: parts.slice(0, index).join("/"),
          kind: "directory",
          mode: 0o755,
          mtime,
        });
    }
    const sources = new Set<string>();
    const deferred: TarWriteEntry[] = [];
    for await (const entry of tarStream(await decodedFile(input), {
      entry: 2 ** 30,
      total: limit,
      entries: 1_000_000,
    })) {
      mtime = Math.max(mtime, entry.mtime);
      if (METADATA.has(entry.path)) {
        if (entry.path === ".PKGINFO") summary.pkginfo = entry.data.slice();
        else if (entry.path === ".INSTALL")
          summary.install = new TextDecoder().decode(entry.data);
        else if (entry.path === ".MTREE")
          summary.mtree = mtreeDigests(
            Bun.gunzipSync(entry.data as Uint8Array<ArrayBuffer>),
          );
        continue;
      }
      if (entry.path.startsWith(".")) {
        summary.warnings.push(`skipped root metadata ${entry.path}`);
        continue;
      }
      for (const user of [entry.uname, entry.gname])
        if (user && user !== "root") owners.add(user);
      if (entry.xattrs.length)
        summary.warnings.push(
          `${entry.path}: extended attributes dropped (${entry.xattrs.join(", ")}); dpkg does not apply them`,
        );
      const path = relocate(entry.path);
      let link = entry.link;
      if (entry.kind === "hardlink" && link) link = `./${relocate(link)}`;
      const record: PayloadSummary["entries"][number] = {
        path,
        source: entry.path,
        kind: entry.kind,
        size: entry.size,
      };
      if (entry.kind === "file") {
        record.md5 = new Bun.CryptoHasher("md5")
          .update(entry.data)
          .digest("hex");
        summary.sha256.set(
          entry.path,
          new Bun.CryptoHasher("sha256").update(entry.data).digest("hex"),
        );
        if (isElf(entry.data)) {
          try {
            const dynamic = elfDynamic(entry.data);
            if (dynamic && [3, 62].includes(dynamic.machine))
              summary.elf.push({ path: entry.path, dynamic });
          } catch (error) {
            summary.warnings.push(
              `${entry.path}: ELF not analysed (${error instanceof Error ? error.message : error})`,
            );
          }
        }
        summary.installedKiB += Math.ceil(entry.size / 1024);
      } else summary.installedKiB += 1;
      summary.entries.push(record);
      sources.add(entry.path);
      const item: TarWriteEntry = {
        path,
        kind: entry.kind,
        mode: entry.kind === "symlink" ? 0o777 : entry.mode,
        mtime: entry.mtime,
        link,
        data: entry.data,
      };
      // Absolute links are decided once every relocated path is known.
      if (prefix && entry.kind === "symlink" && link?.startsWith("/"))
        deferred.push(item);
      else await tarWriter.add(item);
    }
    for (const item of deferred) {
      const target = item.link!.slice(1).replace(/\/+$/, "");
      if (sources.has(target)) item.link = `/${prefix}/${target}`;
      else
        summary.warnings.push(
          `/${item.path} keeps its absolute target ${item.link} outside the relocated tree`,
        );
      await tarWriter.add(item);
    }
    await tarWriter.end();
    await writer.close();
    await pump;
    if (owners.size)
      summary.warnings.push(
        `non-root owners ${[...owners].join(", ")} mapped to root:root`,
      );
  } catch (error) {
    await writer.abort(error).catch(() => {});
    await pump.catch(() => {});
    throw error;
  }
  return summary;
}

function arHeader(name: string, size: number): Uint8Array {
  const field = (value: string, width: number) => value.padEnd(width, " ");
  return new TextEncoder().encode(
    `${field(name, 16)}${field("0", 12)}${field("0", 6)}${field("0", 6)}${field("100644", 8)}${field(String(size), 10)}\`\n`,
  );
}

async function memoryTar(entries: TarWriteEntry[]): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const writer = new TarWriter((chunk) => {
    chunks.push(chunk.slice());
  });
  for (const entry of entries) await writer.add(entry);
  await writer.end();
  return Buffer.concat(chunks);
}

/** ar(5) archive with debian-binary, control.tar.zst and the streamed data.tar.zst. */
async function writeDeb(
  path: string,
  control: Uint8Array,
  dataTar: string,
): Promise<void> {
  const partial = `${path}.part`;
  const sink = Bun.file(partial).writer();
  const dataSize = Bun.file(dataTar).size;
  const version = new TextEncoder().encode("2.0\n");
  sink.write(new TextEncoder().encode("!<arch>\n"));
  sink.write(arHeader("debian-binary", version.length));
  sink.write(version);
  sink.write(arHeader("control.tar.zst", control.length));
  sink.write(control);
  if (control.length % 2) sink.write(new Uint8Array([10]));
  sink.write(arHeader("data.tar.zst", dataSize));
  let count = 0;
  for await (const chunk of Bun.file(dataTar).stream()) {
    sink.write(chunk);
    if (++count % 64 === 0) await sink.flush();
  }
  if (dataSize % 2) sink.write(new Uint8Array([10]));
  await sink.end();
  await rename(partial, path);
}

export class Converter {
  readonly pacman: PacmanIndex;
  readonly ubuntu: UbuntuIndex;
  private abi: Record<string, string> = {};
  private converted = new Map<string, ConvertedPackage>();
  private planned = new Set<string>();

  constructor(
    db: Database,
    private options: ConvertOptions,
  ) {
    this.pacman = new PacmanIndex(db);
    this.ubuntu = new UbuntuIndex(db);
  }

  private debName(pkg: Pick<PacmanPackage, "name" | "family">): string {
    return debianName(pkg, this.ubuntu, this.options.policy);
  }

  /** Best Ubuntu owner per soname: real package first, then multiarch order. */
  private sonameRelation(soname: string, bits: 32 | 64): Relation | undefined {
    const owners = this.ubuntu
      .libraryOwners(soname, bits)
      .filter((owner) => this.ubuntu.has(owner.package))
      .filter((owner) => !/-(dbg|dev)(:|$)/.test(owner.package));
    if (!owners.length) return undefined;
    return owners
      .slice(0, 3)
      .map((owner) => owner.package)
      .join(" | ");
  }

  private curated(
    name: string,
    table: "override" | "map",
  ): Mapping | undefined {
    const policy = this.options.policy[table];
    if (!Object.hasOwn(policy, name)) return undefined;
    const value = policy[name];
    if (value === null)
      return {
        dependency: name,
        result: "drop",
        via: `${table} (base system)`,
      };
    const relations = relationFrom(value!);
    const missing = relations.filter(
      (relation) =>
        !relation.split("|").some((atom) => {
          const bare = atom.trim();
          return (
            this.ubuntu.has(bare) ||
            this.ubuntu.virtualProviders(bare.split(":")[0]!).length > 0
          );
        }),
    );
    if (missing.length)
      return {
        dependency: name,
        result: "unresolved",
        via: `${table}: ${missing.join(", ")} not in the Ubuntu index`,
      };
    return { dependency: name, result: "ubuntu", via: table, relations };
  }

  /** Arch dependency to Ubuntu relations, a pacman conversion, or unresolved. */
  /** `linked` holds `bits:soname` needs of the payload ELF objects, when known. */
  map(dependency: string, linked?: Set<string>): Mapping {
    const parsed = parseDependency(dependency);
    if (this.options.skip.has(parsed.name))
      return { dependency, result: "drop", via: "--skip-dep" };
    const override = this.curated(parsed.name, "override");
    if (override) return { ...override, dependency };
    const soname = sonameProvide(parsed);
    if (soname) {
      const relation = this.sonameRelation(soname.soname, soname.bits);
      if (relation)
        return {
          dependency,
          result: "ubuntu",
          via: `soname ${soname.soname}`,
          relations: [relation],
        };
    }
    // Curated entries are explicit owner decisions for non-library and virtual names.
    const mapped = this.curated(parsed.name, "map");
    if (mapped) return { ...mapped, dependency };
    const pkg =
      this.pacman.get(parsed.name) ?? this.pacman.providers(parsed.name)[0];
    if (pkg) {
      const relationsOf = (items: Array<{ soname: string; bits: 32 | 64 }>) => [
        ...new Set(
          items
            .map((item) => this.sonameRelation(item.soname, item.bits))
            .filter((relation): relation is string => !!relation),
        ),
      ];
      const sonames = this.pacman.sonames(pkg);
      // Libraries the payload links name the exact Ubuntu runtime packages.
      const used = linked
        ? sonames.filter((item) => linked.has(`${item.bits}:${item.soname}`))
        : [];
      const precise = relationsOf(used);
      if (precise.length)
        return {
          dependency,
          result: "ubuntu",
          via: `linked sonames of ${pkg.repo}/${pkg.name} (${used.length})`,
          relations: precise,
        };
      // Otherwise (dlopen, tools, scripts) keep both its libraries and its executables.
      const libraries = relationsOf(sonames);
      const votes = new Map<string, number>();
      for (const path of this.pacman.binaries(pkg))
        for (const owner of this.ubuntu.executableOwners(basename(path)))
          if (this.ubuntu.has(owner) && !/-(dev|dbg)$/.test(owner))
            votes.set(owner, (votes.get(owner) ?? 0) + 1);
      const executable = [...votes].sort(
        (a, b) => b[1] - a[1] || a[0].length - b[0].length,
      )[0]?.[0];
      const relations = [
        ...new Set([...libraries, ...(executable ? [executable] : [])]),
      ];
      if (relations.length)
        return {
          dependency,
          result: "ubuntu",
          via: `${libraries.length ? `${sonames.length} sonames` : ""}${libraries.length && executable ? " + " : ""}${executable ? "executables" : ""} of ${pkg.repo}/${pkg.name}`,
          relations,
        };
    }
    const bare = sanitizeName(parsed.name);
    if (this.ubuntu.has(bare))
      return {
        dependency,
        result: "ubuntu",
        via: "same name",
        relations: [bare],
      };
    if (this.ubuntu.virtualProviders(bare).length)
      return {
        dependency,
        result: "ubuntu",
        via: "virtual package",
        relations: [bare],
      };
    if (pkg && !isProtected(this.options.policy, pkg.name))
      return {
        dependency,
        result: "pacman",
        via: `${pkg.repo}/${pkg.name}`,
        pkg,
      };
    return {
      dependency,
      result: "unresolved",
      via: pkg ? `${pkg.name} is protected and has no Ubuntu owner` : "unknown",
    };
  }

  async init(): Promise<void> {
    this.abi = await targetAbi(
      this.options.policy,
      this.ubuntu.series().find((suite) => !suite.includes("-")),
    );
    if (!this.ubuntu.series().length)
      throw new Error("Ubuntu index is empty: run `pacman2apt sync` first");
  }

  /** Fetch a package from its repository and verify the database SHA-256. */
  private async verifyArchive(
    pkg: PacmanPackage,
    path: string,
    repository: PacmanRepository,
  ): Promise<string[]> {
    const signatureDirectory = join(
      this.options.state,
      "signatures",
      repository.name,
    );
    await mkdir(signatureDirectory, { recursive: true });
    const signaturePath = join(
      signatureDirectory,
      `${pkg.filename.replaceAll(":", "%3A")}.sig`,
    );
    if (!(await Bun.file(signaturePath).exists()))
      await download(
        repositoryUrls(repository, `${pkg.filename}.sig`),
        signaturePath,
        { maxBytes: 1 << 20, timeoutMs: 60_000 },
      );
    const evidence = await verifyPacmanSignature(
      signaturePath,
      path,
      repository,
    );
    return evidence.primaryFingerprints;
  }

  private async fetch(
    pkg: PacmanPackage,
  ): Promise<{ path: string; signer: string[] }> {
    const directory = join(this.options.state, "packages");
    await mkdir(directory, { recursive: true });
    const repository = this.pacman
      .repositories()
      .find((repo) => repo.name === pkg.repo);
    if (!repository) throw new Error(`${pkg.repo}: repository not synced`);
    // Epoch colons are valid pacman file names but not Windows file names.
    const path = join(directory, pkg.filename.replaceAll(":", "%3A"));
    const file = Bun.file(path);
    if ((await file.exists()) && file.size === pkg.csize) {
      const hasher = new Bun.CryptoHasher("sha256");
      for await (const chunk of file.stream()) hasher.update(chunk);
      if (hasher.digest("hex") === pkg.sha256)
        return {
          path,
          signer: await this.verifyArchive(pkg, path, repository),
        };
    }
    this.options.log(
      `fetch ${pkg.repo}/${pkg.filename} (${(pkg.csize / 1048576).toFixed(1)} MiB)`,
    );
    const urls = repository.servers.map(
      (server) =>
        `${server.replaceAll("$repo", repository.name).replaceAll("$arch", repository.arch)}/${encodeURIComponent(pkg.filename)}`,
    );
    await download(urls, path, {
      maxBytes: Math.max(pkg.csize, 1) + 1024,
      timeoutMs: 3_600_000,
      sha256: pkg.sha256,
      size: pkg.csize || undefined,
    });
    return { path, signer: await this.verifyArchive(pkg, path, repository) };
  }

  /** Convert requested packages, then (with --with-deps) their pacman-only dependencies. */
  async convert(targets: string[]): Promise<ConvertedPackage[]> {
    await this.init();
    await mkdir(this.options.out, { recursive: true });
    const queue = targets.map((target) => ({ target, top: true }));
    const results: ConvertedPackage[] = [];
    const failures: string[] = [];
    while (queue.length) {
      const { target, top } = queue.shift()!;
      try {
        const result = await this.convertOne(target, top);
        if (!result) continue;
        results.push(result.converted);
        for (const pkg of result.pending)
          if (!this.planned.has(`${pkg.repo}/${pkg.name}`)) {
            this.planned.add(`${pkg.repo}/${pkg.name}`);
            queue.push({ target: `${pkg.repo}/${pkg.name}`, top: false });
          }
      } catch (error) {
        failures.push(
          `${target}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (failures.length) throw new Error(failures.join("\n\n"));
    return results;
  }

  private async convertOne(
    target: string,
    top: boolean,
  ): Promise<
    { converted: ConvertedPackage; pending: PacmanPackage[] } | undefined
  > {
    const policy = this.options.policy;
    let input: string;
    let pkg: PacmanPackage | undefined;
    let verified: string;
    let signer: string[] = [];
    if (
      /\.pkg\.tar\.(zst|gz)$/.test(target) &&
      (await Bun.file(target).exists())
    ) {
      input = resolve(target);
      pkg = this.pacman.byFilename(basename(target));
      if (!pkg)
        throw new Error(
          `${target}: package is absent from the authenticated pacman index`,
        );
      const indexedPackage = pkg;
      const hasher = new Bun.CryptoHasher("sha256");
      for await (const chunk of Bun.file(input).stream()) hasher.update(chunk);
      const digest = hasher.digest("hex");
      if (indexedPackage.sha256 !== digest)
        throw new Error(
          `${target}: SHA-256 ${digest} differs from ${indexedPackage.repo} database ${indexedPackage.sha256}`,
        );
      const repository = this.pacman
        .repositories()
        .find((repo) => repo.name === indexedPackage.repo);
      if (!repository)
        throw new Error(`${indexedPackage.repo}: repository not synced`);
      signer = await this.verifyArchive(indexedPackage, input, repository);
      verified = `sha256 matches authenticated ${indexedPackage.repo}.db; signer ${signer.join(",")}`;
    } else {
      pkg = this.pacman.resolve(target);
      if (isProtected(policy, pkg.name))
        throw new Error(
          `${pkg.name} is protected: it would replace an Ubuntu system component`,
        );
      if (this.converted.has(`${pkg.repo}/${pkg.name}`)) return undefined;
      const fetched = await this.fetch(pkg);
      input = fetched.path;
      signer = fetched.signer;
      verified = `sha256 from authenticated ${pkg.repo}.db; signer ${signer.join(",")}`;
    }
    const work = join(this.options.state, "work");
    await mkdir(work, { recursive: true });
    const dataTar = join(
      work,
      `${basename(input)}.${process.pid}.data.tar.zst`,
    );
    const prefix =
      top && this.options.prefix
        ? this.options.prefix
            .replace(/^\/+|\/+$/g, "")
            .replaceAll(
              "{name}",
              pkg?.name ??
                basename(input).replace(
                  /-[^-]+-[^-]+-[^-]+\.pkg\.tar\..*$/,
                  "",
                ),
            )
        : undefined;
    if (prefix && !/^[A-Za-z0-9._+/-]+$/.test(prefix))
      throw new Error(`Invalid relocation prefix: ${prefix}`);
    this.options.log(
      `transcode ${basename(input)}${prefix ? ` -> /${prefix}` : ""}`,
    );
    try {
      const payload = await transcodePayload(
        input,
        dataTar,
        prefix,
        Math.max((pkg?.isize ?? 0) * 2, 64 << 20) + (64 << 20),
      );
      if (!payload.pkginfo) throw new Error("package has no .PKGINFO");
      const info = pkginfo(payload.pkginfo, "alpm")[0]!;
      const fields = info.fields;
      const name = info.name;
      const version = info.version;
      if (pkg && (pkg.name !== name || pkg.version !== version))
        throw new Error(
          `.PKGINFO ${name} ${version} differs from database ${pkg.name} ${pkg.version}`,
        );
      const family: PacmanPackage["family"] = pkg?.family ?? "archlinux";
      const warnings = [...payload.warnings];
      // Integrity: every regular file must match the package's own .MTREE digest.
      if (payload.mtree) {
        for (const [path, digest] of payload.sha256) {
          const expected = payload.mtree.get(path);
          if (expected && expected !== digest)
            throw new Error(`${path}: SHA-256 differs from .MTREE`);
        }
      } else
        warnings.push("package has no .MTREE; payload digests not verified");
      // ABI: internal sonames, external needs and symbol-version ceilings.
      const internal = new Set<string>();
      for (const entry of payload.entries)
        if (entry.kind !== "directory") internal.add(basename(entry.source));
      for (const { dynamic } of payload.elf)
        if (dynamic.soname) internal.add(dynamic.soname);
      const needed = new Set<string>();
      const violations: string[] = [];
      for (const { path, dynamic } of payload.elf) {
        for (const soname of dynamic.needed)
          if (!internal.has(soname)) needed.add(`${dynamic.bits}:${soname}`);
        for (const need of dynamic.versionNeeds) {
          if (internal.has(need.file)) continue;
          for (const versionName of need.versions) {
            const match = /^(GLIBC|GLIBCXX|CXXABI)_(\d+(?:\.\d+)*)$/.exec(
              versionName,
            );
            if (!match) continue;
            const ceiling = this.abi[match[1]!];
            if (ceiling && compareDotted(match[2]!, ceiling) > 0)
              violations.push(
                `${path} needs ${versionName} from ${need.file} (target ${match[1]}_${ceiling})`,
              );
          }
        }
      }
      if (violations.length)
        throw new Error(
          `target ABI is too old for this build:\n  ${[...new Set(violations)].slice(0, 20).join("\n  ")}`,
        );
      // Dependencies.
      const mappings: Mapping[] = [];
      const depends: Relation[] = [];
      const recommends: Relation[] = [];
      const suggests: Relation[] = [];
      const pending: PacmanPackage[] = [];
      const unresolved: string[] = [];
      const add = (list: Relation[], relation: Relation) => {
        if (!list.includes(relation)) list.push(relation);
      };
      for (const dependency of fields.depend ?? []) {
        const mapping = this.map(dependency, needed);
        mappings.push(mapping);
        if (mapping.result === "ubuntu")
          for (const relation of mapping.relations!) add(depends, relation);
        else if (mapping.result === "pacman") {
          const target = mapping.pkg!;
          if (!this.options.withDeps) {
            unresolved.push(
              `${dependency} (pacman-only: ${target.repo}/${target.name}; use --with-deps)`,
            );
            continue;
          }
          add(
            depends,
            `${this.debName(target)} (>= ${debianVersion(target.version)})`,
          );
          pending.push(target);
        } else if (mapping.result === "unresolved")
          unresolved.push(`${dependency} (${mapping.via})`);
      }
      for (const dependency of fields.optdepend ?? []) {
        const mapping = this.map(dependency.split(": ")[0]!);
        if (mapping.result === "ubuntu")
          for (const relation of mapping.relations!) add(suggests, relation);
      }
      const covered = new Set(
        depends.flatMap((relation) =>
          relation.split("|").map((atom) => atom.trim().split(" ")[0]!),
        ),
      );
      const unresolvedSonames: string[] = [];
      if (this.options.elfDeps !== "none")
        for (const key of [...needed].sort()) {
          const bits = Number(key.slice(0, 2)) as 32 | 64;
          const soname = key.slice(3);
          const owners = this.ubuntu
            .libraryOwners(soname, bits)
            .map((owner) => owner.package);
          if (owners.some((owner) => covered.has(owner))) continue;
          const relation = this.sonameRelation(soname, bits);
          if (relation)
            add(
              this.options.elfDeps === "depends" ? depends : recommends,
              relation,
            );
          else if (!soname.startsWith("ld-linux"))
            unresolvedSonames.push(`${soname} (${bits}-bit)`);
        }
      if (unresolvedSonames.length)
        warnings.push(
          `ELF sonames without an Ubuntu owner: ${unresolvedSonames.join(", ")}`,
        );
      if (unresolved.length && !this.options.allowUnresolved)
        throw new Error(
          `unresolved dependencies (map them in data/pacman2apt.json, pass --skip-dep NAME, --with-deps or --allow-unresolved):\n  ${unresolved.join("\n  ")}`,
        );
      if (unresolved.length)
        warnings.push(
          `dropped unresolved dependencies: ${unresolved.join("; ")}`,
        );
      // Identity.
      const debName = this.debName({ name, family });
      const debVersion = debianVersion(version);
      const architecture = fields.arch?.[0] === "any" ? "all" : "amd64";
      if (!["any", "x86_64"].includes(fields.arch?.[0] ?? ""))
        throw new Error(`unsupported pacman architecture ${fields.arch?.[0]}`);
      // File conflicts with Ubuntu archive owners and the installed dpkg database.
      const shipped = new Set(
        payload.entries.map((entry) => usrMerged(entry.path)),
      );
      const installed = await installedOwners(shipped);
      const conflicts: ConvertedPackage["conflicts"] = [];
      for (const entry of payload.entries) {
        const path = usrMerged(entry.path);
        const archive = this.ubuntu.owners(path);
        const local =
          entry.kind === "directory" ? [] : (installed?.owners(path) ?? []);
        let owners = [...new Set([...archive, ...local])].filter(
          (owner) => owner !== debName,
        );
        if (
          !owners.length &&
          entry.kind !== "directory" &&
          process.platform === "linux"
        ) {
          const state = await lstat(`/${entry.path}`).catch(() => undefined);
          if (
            state &&
            !state.isDirectory() &&
            !installed?.owners(path).includes(debName)
          )
            owners = ["(unowned file on this host)"];
        }
        if (owners.length) conflicts.push({ path: entry.path, owners });
      }
      const debFile = join(
        this.options.out,
        `${debName}_${debVersion.replace(/^\d+:/, "")}_${architecture}.deb`,
      );
      const reportFile = debFile.replace(/\.deb$/, ".pacman2apt.json");
      const shadows = payload.entries
        .filter((entry) => /^usr\/lib(32)?\/[^/]+\.so\.\d/.test(entry.path))
        .filter(
          (entry) =>
            this.ubuntu.libraryOwners(
              basename(entry.path),
              entry.path.startsWith("usr/lib32") ? 32 : 64,
            ).length,
        )
        .map((entry) => entry.path);
      if (shadows.length)
        warnings.push(
          `libraries also provided by Ubuntu (ld.so prefers the multiarch copy): ${shadows.slice(0, 10).join(", ")}`,
        );
      const report = {
        schemaVersion: 1,
        tool: "pacman2apt",
        source: {
          repo: pkg?.repo,
          name,
          version,
          filename: basename(input),
          verified,
          packager: fields.packager?.[0],
        },
        debian: { name: debName, version: debVersion, architecture },
        relocated: prefix ? `/${prefix}` : undefined,
        target: { series: this.ubuntu.series(), abi: this.abi },
        mappings: mappings.map(({ pkg: _pkg, ...rest }) => rest),
        depends,
        recommends,
        suggests,
        conflicts,
        warnings,
      };
      if (conflicts.length) {
        await Bun.write(reportFile, `${JSON.stringify(report, null, 2)}\n`);
        throw new Error(
          `${conflicts.length} path(s) conflict with Ubuntu-owned files; relocate with --prefix /opt/pacman2apt/{name} (report: ${reportFile}):\n  ${conflicts
            .slice(0, 25)
            .map(
              (conflict) =>
                `/${conflict.path} <- ${conflict.owners.join(", ")}`,
            )
            .join("\n  ")}`,
        );
      }
      // Maintainer scripts and triggers.
      const scripts = maintainerScripts(
        payload.install,
        payload.entries.map((entry) => entry.path),
        version,
        !!prefix,
      );
      warnings.push(...scripts.notes);
      // Provides/Conflicts/Replaces only within the converted namespace.
      const namespace = (values: string[] | undefined) => [
        ...new Set(
          (values ?? [])
            .map((value) => parseDependency(value))
            .filter((value) => !sonameProvide(value))
            .map((value) => sanitizeName(value.name))
            .filter(
              (value) => value && value !== debName && !this.ubuntu.has(value),
            ),
        ),
      ];
      const provides = namespace(fields.provides);
      const conflictsWith = namespace(fields.conflict);
      const replaces = namespace(fields.replaces);
      const description = (info.description ?? name)
        .replace(/\s+/g, " ")
        .trim();
      const field = (key: string, value: string | undefined) =>
        value ? `${key}: ${value.replace(/\s*\n\s*/g, " ")}\n` : "";
      const maintainer = /<[^>]+@[^>]+>/.test(fields.packager?.[0] ?? "")
        ? fields.packager![0]
        : "pacman2apt <root@localhost>";
      const control =
        field("Package", debName) +
        field("Version", debVersion) +
        field("Architecture", architecture) +
        field("Maintainer", maintainer) +
        field("Installed-Size", String(payload.installedKiB)) +
        field("Depends", depends.join(", ")) +
        field("Recommends", recommends.join(", ")) +
        field("Suggests", suggests.join(", ")) +
        field("Provides", provides.join(", ")) +
        field("Conflicts", conflictsWith.join(", ")) +
        field("Replaces", replaces.join(", ")) +
        field("Section", "misc") +
        field("Priority", "optional") +
        field("Homepage", info.homepage) +
        field("Pacman-Repository", pkg?.repo) +
        field("Pacman-Package", `${name} ${version}`) +
        field("Pacman-Sha256", pkg?.sha256) +
        field("Pacman-Signer", signer.join(",")) +
        `Description: ${description.slice(0, 200)}\n Converted by pacman2apt from ${pkg?.repo ?? "a local file"}/${name} ${version}.\n${prefix ? ` Relocated under /${prefix}.\n` : ""}`;
      const md5sums = payload.entries
        .filter((entry) => entry.md5)
        .map((entry) => `${entry.md5}  ${entry.path}`)
        .join("\n");
      const conffiles = payload.entries
        .filter(
          (entry) => entry.kind === "file" && entry.path.startsWith("etc/"),
        )
        .map((entry) => `/${entry.path}`);
      const now = Math.floor(Date.now() / 1000);
      const members: TarWriteEntry[] = [
        { path: "", kind: "directory", mode: 0o755, mtime: now },
        {
          path: "control",
          kind: "file",
          mode: 0o644,
          mtime: now,
          data: new TextEncoder().encode(control),
        },
        {
          path: "md5sums",
          kind: "file",
          mode: 0o644,
          mtime: now,
          data: new TextEncoder().encode(md5sums ? `${md5sums}\n` : ""),
        },
      ];
      if (conffiles.length)
        members.push({
          path: "conffiles",
          kind: "file",
          mode: 0o644,
          mtime: now,
          data: new TextEncoder().encode(`${conffiles.join("\n")}\n`),
        });
      if (scripts.triggers.length)
        members.push({
          path: "triggers",
          kind: "file",
          mode: 0o644,
          mtime: now,
          data: new TextEncoder().encode(`${scripts.triggers.join("\n")}\n`),
        });
      for (const [script, text] of Object.entries(scripts.scripts))
        members.push({
          path: script,
          kind: "file",
          mode: 0o755,
          mtime: now,
          data: new TextEncoder().encode(text),
        });
      const controlTar = Bun.zstdCompressSync(await memoryTar(members), {
        level: 19,
      });
      await writeDeb(debFile, controlTar, dataTar);
      await Bun.write(
        reportFile,
        `${JSON.stringify({ ...report, scripts: Object.keys(scripts.scripts), triggers: scripts.triggers }, null, 2)}\n`,
      );
      const converted: ConvertedPackage = {
        pacman: { repo: pkg?.repo, name, version, sha256: pkg?.sha256 ?? "" },
        debian: { name: debName, version: debVersion, architecture },
        deb: debFile,
        report: reportFile,
        depends,
        recommends,
        conflicts,
        warnings,
      };
      this.converted.set(`${pkg?.repo}/${name}`, converted);
      this.options.log(
        `wrote ${basename(debFile)} (${(Bun.file(debFile).size / 1048576).toFixed(1)} MiB, ${depends.length} depends, ${warnings.length} notes)`,
      );
      return { converted, pending };
    } finally {
      await rm(dataTar, { force: true });
    }
  }
}

/** Read the control file of a .deb without loading its data member. */
export async function debControl(path: string): Promise<string> {
  const file = Bun.file(path);
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (new TextDecoder().decode(head) !== "!<arch>\n")
    throw new Error(`${path}: not an ar archive`);
  for (let offset = 8; offset + 60 <= file.size;) {
    const header = new TextDecoder().decode(
      await file.slice(offset, offset + 60).arrayBuffer(),
    );
    const name = header.slice(0, 16).trim().replace(/\/$/, "");
    const size = Number(header.slice(48, 58).trim());
    const start = offset + 60;
    if (name.startsWith("control.tar")) {
      const member = new Uint8Array(
        await file.slice(start, start + size).arrayBuffer(),
      );
      const control = tar(await decompress(member)).find(
        (entry) => entry.path === "control" && entry.kind === "file",
      );
      if (!control)
        throw new Error(`${path}: control member has no control file`);
      return new TextDecoder().decode(control.data);
    }
    offset = start + size + (size % 2);
  }
  throw new Error(`${path}: no control member`);
}

/** Flat APT repository: Packages, Packages.zst and Release beside the .deb files. */
export async function buildRepository(directory: string): Promise<number> {
  const cachePath = join(directory, ".pacman2apt-hashes.json");
  const cache: Record<
    string,
    { size: number; mtime: number; md5: string; sha256: string }
  > = (await Bun.file(cachePath).exists())
    ? await Bun.file(cachePath).json()
    : {};
  const fresh: typeof cache = {};
  const stanzas: string[] = [];
  const names = (await readdir(directory))
    .filter((name) => name.endsWith(".deb"))
    .sort();
  for (const name of names) {
    const path = join(directory, name);
    const state = await lstat(path);
    let hashes = cache[name];
    if (
      !hashes ||
      hashes.size !== state.size ||
      hashes.mtime !== state.mtimeMs
    ) {
      const md5 = new Bun.CryptoHasher("md5");
      const sha256 = new Bun.CryptoHasher("sha256");
      for await (const chunk of Bun.file(path).stream()) {
        md5.update(chunk);
        sha256.update(chunk);
      }
      hashes = {
        size: state.size,
        mtime: state.mtimeMs,
        md5: md5.digest("hex"),
        sha256: sha256.digest("hex"),
      };
    }
    fresh[name] = hashes;
    const control = (await debControl(path)).trimEnd();
    stanzas.push(
      `${control}\nFilename: ./${name}\nSize: ${hashes.size}\nMD5sum: ${hashes.md5}\nSHA256: ${hashes.sha256}\n`,
    );
  }
  const packages = new TextEncoder().encode(stanzas.join("\n"));
  const zst = Bun.zstdCompressSync(packages, { level: 19 });
  await Bun.write(join(directory, "Packages"), packages);
  await Bun.write(join(directory, "Packages.zst"), zst);
  const sum = (algorithm: "md5" | "sha256", data: Uint8Array) =>
    new Bun.CryptoHasher(algorithm).update(data).digest("hex");
  const files = [
    ["Packages", packages],
    ["Packages.zst", zst],
  ] as const;
  const release =
    `Origin: pacman2apt\nLabel: pacman2apt\nDate: ${new Date().toUTCString()}\nArchitectures: amd64 all\n` +
    `Description: Arch-family packages converted by pacman2apt\n` +
    `MD5Sum:\n${files.map(([file, data]) => ` ${sum("md5", data)} ${data.length} ${file}`).join("\n")}\n` +
    `SHA256:\n${files.map(([file, data]) => ` ${sum("sha256", data)} ${data.length} ${file}`).join("\n")}\n`;
  await Bun.write(join(directory, "Release"), release);
  await Bun.write(cachePath, `${JSON.stringify(fresh, null, 2)}\n`);
  return names.length;
}

const PROTECTED_DEBIAN =
  /^(libc6|libc6-i386|libc-bin|libgl1-mesa-dri|mesa-.*|libegl-mesa0|libglx-mesa0|systemd|systemd-sysv|libsystemd0|udev|libudev1)(:.*)?$/;

async function privileged(
  command: string[],
  timeoutMs: number,
  env?: Record<string, string>,
) {
  const root = process.getuid?.() === 0;
  const argv = root
    ? command
    : [
        "sudo",
        "-n",
        ...(env
          ? [
              "env",
              ...Object.entries(env).map(([key, value]) => `${key}=${value}`),
            ]
          : []),
        ...command,
      ];
  const result = await runProcess(argv, process.cwd(), {
    timeoutMs,
    maxOutputBytes: 32 << 20,
    env: root ? { ...process.env, ...env } : undefined,
  });
  if (result.code !== 0)
    throw new Error(
      `${command.join(" ")} failed (${result.code}):\n${result.stderr || result.stdout}`,
    );
  return result.stdout;
}

export const SOURCES_FILE = "/etc/apt/sources.list.d/pacman2apt.sources";

/** Convert, publish into the local repository and install with apt-get (never removing packages). */
export async function install(
  db: Database,
  targets: string[],
  options: ConvertOptions & { repository: string; dryRun: boolean },
): Promise<string> {
  if (process.platform !== "linux")
    throw new Error("install runs on the Ubuntu target");
  const converter = new Converter(db, { ...options, out: options.repository });
  const converted = await converter.convert(targets);
  await buildRepository(options.repository);
  const sources = `# Generated by pacman2apt\nTypes: deb\nURIs: file:${resolve(options.repository)}\nSuites: ./\nTrusted: yes\n`;
  const current = (await Bun.file(SOURCES_FILE).exists())
    ? await Bun.file(SOURCES_FILE).text()
    : "";
  if (current !== sources) {
    const temporary = join(options.state, "pacman2apt.sources");
    await Bun.write(temporary, sources);
    await privileged(
      ["install", "-m", "0644", temporary, SOURCES_FILE],
      30_000,
    );
  }
  await privileged(
    [
      "apt-get",
      "update",
      "-o",
      `Dir::Etc::SourceList=${SOURCES_FILE}`,
      "-o",
      "Dir::Etc::SourceParts=-",
      "-o",
      "APT::Get::List-Cleanup=0",
    ],
    300_000,
  );
  const names = [...new Set(converted.map((item) => item.debian.name))];
  const env = { DEBIAN_FRONTEND: "noninteractive" };
  const simulation = await privileged(
    ["apt-get", "install", "-s", "--no-remove", ...names],
    300_000,
    env,
  );
  const removals = simulation
    .split("\n")
    .filter((line) => line.startsWith("Remv "));
  const upgrades = simulation
    .split("\n")
    .filter((line) => /^Inst \S+ \[/.test(line))
    .map((line) => line.split(" ")[1]!)
    .filter((name) => PROTECTED_DEBIAN.test(name));
  if (removals.length || upgrades.length)
    throw new Error(
      `apt plan touches protected or installed packages:\n${[...removals, ...upgrades].join("\n")}`,
    );
  if (options.dryRun) return simulation;
  return privileged(
    ["apt-get", "install", "-y", "--no-remove", ...names],
    3_600_000,
    env,
  );
}

function cpuSupportsV3(): boolean {
  try {
    const flags = readFileSync("/proc/cpuinfo", "utf8");
    return ["avx2", "bmi2", "fma", "movbe"].every((flag) =>
      new RegExp(`\\b${flag}\\b`).test(flags),
    );
  } catch {
    return true;
  }
}

const USAGE = `pacman2apt: Arch-family (CachyOS, Arch, Omarchy) packages to Ubuntu .deb + flat APT repository

pacman2apt sync [--repos a,b] [--no-files] [--no-ubuntu] [--series NAME] [--ubuntu-mirror URL]
                [--components main,restricted,universe,multiverse] [--no-i386] [--isa auto|x86-64|x86-64-v3]
pacman2apt resolve NAME...                    show the dependency mapping without converting
pacman2apt convert NAME|FILE.pkg.tar.zst... [--out DIR] [--with-deps] [--prefix /opt/pacman2apt/{name}]
                [--allow-unresolved] [--skip-dep NAME]... [--elf-deps depends|recommends|none] [--map FILE.json]
pacman2apt repo DIR                           write Packages, Packages.zst and Release
pacman2apt install NAME... [--repo /var/lib/aphrody-apt/pacman2apt] [--dry-run] [convert options]
Common: --state DIR (default $PACMAN2APT_STATE or ~/.cache/pacman2apt)`;

export async function runPacman2AptCLI(
  argv: string[] = Bun.argv.slice(2),
): Promise<void> {
  const args = [...argv];
  const command = args.shift();
  if (!command || command === "--help" || command === "help") {
    console.log(USAGE);
    return;
  }
  const values: Record<string, string> = Object.create(null);
  const repeated: Record<string, string[]> = { "skip-dep": [] };
  const flags = new Set<string>();
  const positional: string[] = [];
  const booleans = new Set([
    "with-deps",
    "allow-unresolved",
    "no-files",
    "no-ubuntu",
    "no-i386",
    "dry-run",
  ]);
  while (args.length) {
    const arg = args.shift()!;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (booleans.has(key)) flags.add(key);
    else {
      const value = args.shift();
      if (value === undefined) throw new Error(`${arg} needs a value`);
      if (key in repeated) repeated[key]!.push(value);
      else values[key] = value;
    }
  }
  const state = resolve(values.state ?? defaultState());
  const log = (line: string) => console.error(`pacman2apt: ${line}`);
  const db = await openIndex(state);
  try {
    if (command === "sync") {
      const wanted = values.repos?.split(",");
      const isa = values.isa ?? "auto";
      const v3 =
        isa === "x86-64-v3" ||
        (isa === "auto" && (process.platform !== "linux" || cpuSupportsV3()));
      const repositories = pacmanRepositories().filter(
        (repository: PacmanRepository) =>
          (!wanted || wanted.includes(repository.name)) &&
          (repository.isa !== "x86-64-v3" || v3),
      );
      for (const [index, repository] of repositories.entries()) {
        const result = await syncRepository(
          db,
          repository,
          index,
          state,
          !flags.has("no-files"),
        );
        log(
          `${result.repo}: ${result.packages} packages, ${result.files} indexed paths from ${result.url}`,
        );
      }
      if (!flags.has("no-ubuntu")) {
        const series = values.series ?? (await hostSeries());
        if (!series)
          throw new Error(
            "--series is required when this host is not the Ubuntu target",
          );
        const results = await syncUbuntu(
          db,
          {
            mirror: (
              values["ubuntu-mirror"] ?? "http://archive.ubuntu.com/ubuntu"
            ).replace(/\/$/, ""),
            series,
            suites: [series, `${series}-updates`, `${series}-security`],
            components: (
              values.components ?? "main,restricted,universe,multiverse"
            ).split(","),
            architectures: flags.has("no-i386") ? ["amd64"] : ["amd64", "i386"],
          },
          state,
          log,
        );
        for (const result of results)
          log(
            `ubuntu ${result.suite}: ${result.packages} packages, ${result.files} paths, ${result.libraries} libraries, InRelease ${result.signature}`,
          );
      }
      return;
    }
    if (command === "repo") {
      const directory = resolve(positional[0] ?? "");
      if (!positional[0]) throw new Error("repo needs a directory");
      log(
        `${await buildRepository(directory)} packages indexed in ${directory}`,
      );
      return;
    }
    const extra = values.map
      ? ((await Bun.file(values.map).json()) as Partial<Policy>)
      : undefined;
    const options: ConvertOptions = {
      state,
      out: resolve(values.out ?? join(state, "debs")),
      withDeps: flags.has("with-deps"),
      prefix: values.prefix,
      allowUnresolved: flags.has("allow-unresolved"),
      skip: new Set(repeated["skip-dep"]),
      elfDeps: (values["elf-deps"] ?? "depends") as ConvertOptions["elfDeps"],
      policy: loadPolicy(extra),
      log,
    };
    if (!["depends", "recommends", "none"].includes(options.elfDeps))
      throw new Error("--elf-deps must be depends, recommends or none");
    if (!positional.length) throw new Error(USAGE);
    if (command === "resolve") {
      const converter = new Converter(db, options);
      await converter.init();
      for (const target of positional) {
        const pkg = converter.pacman.resolve(target);
        console.log(
          `${pkg.repo}/${pkg.name} ${pkg.version} -> ${debianName(pkg, converter.ubuntu, options.policy)} ${debianVersion(pkg.version)}`,
        );
        for (const dependency of pkg.depends) {
          const mapping = converter.map(dependency);
          console.log(
            `  ${dependency.padEnd(28)} ${mapping.result.padEnd(10)} ${(mapping.relations ?? []).join(", ") || (mapping.pkg ? `${mapping.pkg.repo}/${mapping.pkg.name}` : "")}  [${mapping.via}]`,
          );
        }
      }
      return;
    }
    if (command === "convert") {
      const results = await new Converter(db, options).convert(positional);
      console.log(
        JSON.stringify(
          results.map(({ deb, report, debian, warnings }) => ({
            deb,
            report,
            debian,
            warnings,
          })),
          null,
          2,
        ),
      );
      return;
    }
    if (command === "install") {
      const output = await install(db, positional, {
        ...options,
        repository: resolve(values.repo ?? "/var/lib/aphrody-apt/pacman2apt"),
        dryRun: flags.has("dry-run"),
      });
      console.log(output);
      return;
    }
    throw new Error(USAGE);
  } finally {
    db.close();
  }
}

if (import.meta.main)
  runPacman2AptCLI().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
