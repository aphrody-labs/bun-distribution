// `bun-engine formats ...` and the standalone `bun-engine-formats` executable.
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { archIds, type Arch } from "./types.js";
import { backends, type Backend } from "./disasm/index.js";
import { BinaryImage } from "./image.js";
import { workspaceRoot } from "./tools.js";

export const formatsUsage = `usage: bun-engine-formats <command> <file> [options]
  identify <file> [--magika] [--json]   detected format, platform and detector
  header <file>                          parsed header (JSON)
  sections <file> [--json]               sections with file offsets and load addresses
  files <file> [--json]                  embedded filesystem entries (NitroFS, FST, ISO9660, ExeFS, PFS0/HFS0)
  disasm <file> [--arch ${archIds.join("|")}] [--at ADDR] [--offset OFF] [--count N] [--backend ${backends.join("|")}] [--json]
  stream <file> [--start OFF] [--end OFF]  streaming CRC-32/MD5/SHA-1/SHA-256
  compile [outfile] [--target bun-<os>-<arch>]  build the single-file executable`;

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function number(args: string[], name: string): number | undefined {
  const value = option(args, name);
  if (value === undefined) return undefined;
  const parsed = /^(0x|\$)/i.test(value) ? Number.parseInt(value.replace(/^(0x|\$)/i, ""), 16) : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new TypeError(`${name} expects a non-negative integer, got ${value}`);
  return parsed;
}

const hex = (value: number | undefined, digits = 8) =>
  value === undefined ? "-" : `0x${value.toString(16).padStart(digits, "0")}`;

function print(value: unknown): void {
  console.log(JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item), 2));
}

/** Builds `bun-engine-formats` with Bun.build({ compile }). */
export async function compileFormats(outfile?: string, target?: string): Promise<number> {
  const root = workspaceRoot() ?? process.cwd();
  const windows = target ? target.startsWith("bun-windows-") : process.platform === "win32";
  const output = resolve(root, outfile ?? join("build", "bin", `bun-engine-formats${windows ? ".exe" : ""}`));
  await mkdir(dirname(output), { recursive: true });
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, "main.ts")],
    compile: {
      outfile: output,
      ...(target ? { target: target as never } : {}),
      autoloadDotenv: false,
      autoloadBunfig: false,
      autoloadTsconfig: false,
      autoloadPackageJson: false,
    },
    minify: true,
    sourcemap: "linked",
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    return 1;
  }
  console.log(result.outputs[0]?.path ?? output);
  return 0;
}

export async function runFormats(args: string[]): Promise<number> {
  const [command, file] = args;
  const json = args.includes("--json");
  if (command === "compile") return compileFormats(file?.startsWith("--") ? undefined : file, option(args, "--target"));
  if (!command || !file || command === "help" || command === "--help") {
    console.log(formatsUsage);
    return command ? 0 : 2;
  }
  const image = await BinaryImage.open(file, {
    magika: args.includes("--magika"),
  });
  switch (command) {
    case "identify": {
      if (json)
        print({
          path: image.path,
          size: image.size,
          ...image.detection,
          arch: image.arch,
          entry: image.entry,
        });
      else
        console.log(
          `${image.name}: ${image.format} (${image.platform}) by ${image.detection.by}, confidence ${image.detection.confidence}, ${image.size} bytes${image.arch ? `, ${image.arch}` : ""}${image.entry !== undefined ? `, entry ${hex(image.entry)}` : ""}`,
        );
      return image.format === "unknown" ? 1 : 0;
    }
    case "header":
      print({
        format: image.format,
        platform: image.platform,
        arch: image.arch,
        entry: image.entry === undefined ? undefined : hex(image.entry),
        header: image.header,
        owners: image.owners,
      });
      return 0;
    case "sections":
      if (json) print(image.sections);
      else
        for (const section of image.sections)
          console.log(
            `${section.name.padEnd(28)} off ${hex(section.offset)} size ${hex(section.size)} addr ${hex(section.address)} ${(section.arch ?? "").padEnd(7)} ${section.kind}${section.swap ? ` swap${section.swap}` : ""}`,
          );
      return 0;
    case "files": {
      const files = await image.files();
      if (json) print(files);
      else
        for (const entry of files) console.log(`${hex(entry.offset)} ${String(entry.size).padStart(10)} ${entry.path}`);
      return 0;
    }
    case "disasm": {
      const arch = option(args, "--arch");
      if (arch && !archIds.includes(arch as Arch)) throw new TypeError(`--arch must be one of ${archIds.join(", ")}`);
      const backend = option(args, "--backend");
      if (backend && !backends.includes(backend as Backend))
        throw new TypeError(`--backend must be one of ${backends.join(", ")}`);
      const result = await image.disasm({
        arch: arch as Arch | undefined,
        at: number(args, "--at"),
        offset: number(args, "--offset"),
        count: number(args, "--count"),
        backend: backend as Backend | undefined,
      });
      if (json) print(result);
      else {
        console.log(
          `; ${image.name} ${result.arch} via ${result.backend}, ${result.section ?? "raw"} @ file ${hex(result.offset)}`,
        );
        const width = Math.max(...result.lines.map(line => line.bytes.length), 0);
        for (const line of result.lines) console.log(`${hex(line.address)}: ${line.bytes.padEnd(width)}  ${line.text}`);
      }
      return 0;
    }
    case "stream":
      print(await image.digest(number(args, "--start") ?? 0, number(args, "--end") ?? image.size));
      return 0;
    default:
      console.error(formatsUsage);
      return 2;
  }
}
