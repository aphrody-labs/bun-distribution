#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
import { convert, type ConversionOptions } from "./convert.ts";
import { inspect } from "./metadata.ts";
import { runPacman2AptCLI } from "./pacman2apt.ts";
import { type Ecosystem, type InputFormat } from "./types.ts";

const USAGE = `package-converter inspect|convert INPUT --format FORMAT --ecosystem ECOSYSTEM
package-converter pacman2apt sync|resolve|convert|repo|install ... (see pacman2apt --help)
Formats: deb, deb822, pkginfo, srcinfo, cygwin, alpm-archive, source-archive
Ecosystems: debian, ubuntu, cosmic, alpm, msys2, mingw, cygwin
Convert: --package NAME --out NEW_DIRECTORY [--source-base URL] [--extract-sources]
Source archive companion: --metadata FILE --metadata-format deb822|pkginfo|srcinfo|cygwin
Windows: --windows-artifact FILE.exe [--winget-id Publisher.Package --windows-version VERSION --installer-url HTTPS_URL --publisher NAME --license SPDX]
Runtime imports: --runtime DLL=Publisher.Package or DLL=bun:package@VERSION (repeatable)
Compression: --decoder NATIVE_7ZIP_EXECUTABLE for xz or bzip2 members`;

export async function runPackageCLI(args: string[] = Bun.argv.slice(2)): Promise<void> {
  args = [...args];
  if (args[0] === "pacman2apt") return runPacman2AptCLI(args.slice(1));
  if (!args.length || args.includes("--help")) {
    console.log(USAGE);
    return;
  }
  const command = args.shift();
  const input = args.shift();
  if (!input || !["inspect", "convert"].includes(command ?? "")) throw new Error(USAGE);
  const values: Record<string, string> = Object.create(null);
  const runtimeDependencies: Record<string, string> = Object.create(null);
  let extractSources = false;
  const allowed = new Set([
    "format",
    "ecosystem",
    "out",
    "package",
    "source-base",
    "windows-artifact",
    "winget-id",
    "windows-version",
    "installer-url",
    "publisher",
    "license",
    "decoder",
    "metadata",
    "metadata-format",
  ]);
  while (args.length) {
    const flag = args.shift()!;
    if (flag === "--extract-sources") {
      extractSources = true;
      continue;
    }
    const key = flag.startsWith("--") ? flag.slice(2) : "";
    const value = args.shift();
    if (!value || value.startsWith("--") || (!allowed.has(key) && key !== "runtime"))
      throw new Error(`Invalid option ${flag}`);
    if (key === "runtime") {
      const equal = value.indexOf("=");
      const dll = value.slice(0, equal).toLowerCase();
      if (equal < 1 || !/^[a-z0-9_.+-]+\.dll$/.test(dll) || runtimeDependencies[dll])
        throw new Error("Runtime mapping must be DLL=Publisher.Package once per DLL");
      runtimeDependencies[dll] = value.slice(equal + 1);
    } else {
      if (values[key]) throw new Error(`Duplicate option ${flag}`);
      values[key] = value;
    }
  }
  const formats: InputFormat[] = ["deb", "deb822", "pkginfo", "srcinfo", "cygwin", "alpm-archive", "source-archive"];
  const ecosystems: Ecosystem[] = ["debian", "ubuntu", "cosmic", "alpm", "msys2", "mingw", "cygwin"];
  if (!formats.includes(values.format as InputFormat) || !ecosystems.includes(values.ecosystem as Ecosystem))
    throw new Error(USAGE);
  const options: ConversionOptions = {
    format: values.format as InputFormat,
    ecosystem: values.ecosystem as Ecosystem,
    out: values.out ?? "",
    package: values.package ?? "",
    sourceBase: values["source-base"],
    extractSources,
    windowsArtifact: values["windows-artifact"],
    wingetId: values["winget-id"],
    installerUrl: values["installer-url"],
    publisher: values.publisher,
    license: values.license,
    windowsVersion: values["windows-version"],
    decoder: values.decoder,
    runtimeDependencies,
    metadataFile: values.metadata,
    metadataFormat: values["metadata-format"] as InputFormat | undefined,
  };
  if (command === "inspect") console.log(JSON.stringify((await inspect(input, options)).inspection, null, 2));
  else {
    if (!options.out || !options.package) throw new Error("Conversion requires --out and --package");
    console.log(await convert(input, options));
  }
}

if (import.meta.main)
  runPackageCLI().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
