import { fetchFirmwareCatalog } from "./firmware/catalog";
import { importFirmware, listFirmware } from "./firmware/import";
import { loadConsoleCatalog } from "./console/catalog";
import { runNative } from "./nds/cli";
import * as pm from "./pm";
import { probeMedia, probeNativeCapabilities } from "./native-capabilities";
import { NintendoDsFirmware } from "./nds/loader";

const usage = [
  "bep init",
  "bep install [--frozen-lockfile] [--sources]",
  "bep add <core...> | add firmware <console> <dump> | add rom <console> <image> [name]",
  "bep remove <name...>",
  "bep ls | why <core> | info <core|console> | search [term] | outdated [core...] | update [core...]",
  "bep cache [prune [project-dir...]]",
  "bep consoles | firmware:index | firmware:list [console] | run <system> <image> [options]",
  "bep ds:load [dir] | system:probe [path] | media:probe <file> | bun <bun-arguments>",
].join("\n  ");

function print(value: unknown): number {
  console.log(JSON.stringify(value, null, 2));
  return 0;
}

export async function runEnginePackageManager(args: string[]): Promise<number> {
  if (args[0] === "system:probe") {
    console.log(JSON.stringify(await probeNativeCapabilities(args[1]), null, 2));
    return 0;
  }
  if (args[0] === "media:probe") {
    if (!args[1]) throw new Error("usage: bep media:probe <local-file>");
    console.log(JSON.stringify(await probeMedia(args[1]), null, 2));
    return 0;
  }
  if (args[0] === "ds:load") {
    const directory = args[1] ?? `${process.cwd()}/bin`;
    const firmware = await NintendoDsFirmware.load(directory);
    firmware.readArm7(0, 4);
    firmware.readArm9(0xffff0000, 4);
    firmware.readFirmwareSpi(0, 4);
    firmware.readGbaBios(0, 4);
    console.log(JSON.stringify(firmware.summary(), null, 2));
    return 0;
  }
  if (args[0] === "consoles") {
    const catalog = await loadConsoleCatalog();
    const firmware = await listFirmware().catch(() => []);
    const consoles = new Map<string, { cores: string[]; firmwarePolicy: Set<string>; firmware: number }>();
    for (const component of catalog.components) {
      const entry = consoles.get(component.console) ?? { cores: [], firmwarePolicy: new Set(), firmware: 0 };
      entry.cores.push(component.id);
      entry.firmwarePolicy.add(component.firmwarePolicy);
      consoles.set(component.console, entry);
    }
    for (const manifest of firmware) {
      const entry = consoles.get(manifest.console);
      if (entry) entry.firmware++;
    }
    const rows = [...consoles].map(([name, entry]) => ({
      console: name,
      cores: entry.cores,
      firmwarePolicy: [...entry.firmwarePolicy],
      importedFirmware: entry.firmware,
    }));
    console.log(JSON.stringify(rows, null, 2));
    return 0;
  }
  if (args[0] === "firmware:list") {
    console.log(JSON.stringify(await listFirmware(args[1]), null, 2));
    return 0;
  }
  if (args[0] === "run" && args[2]) return runNative(["run", args[1]!, await pm.resolveImage(args[2]), ...args.slice(3)]);
  if (args[0] === "firmware:index") {
    console.log(JSON.stringify(await fetchFirmwareCatalog(), null, 2));
    return 0;
  }
  if (args[0] === "firmware:import") {
    const [, consoleName, sourcePath, ...options] = args;
    if (!consoleName || !sourcePath) {
      throw new Error("usage: bep firmware:import <console> <local-dump> [--store <directory>]");
    }
    const known = new Set((await loadConsoleCatalog()).components.map(component => component.console));
    if (!known.has(consoleName)) throw new Error(`unknown console ${consoleName}; see bep consoles`);
    const storeAt = options.indexOf("--store");
    const store = storeAt >= 0 ? options[storeAt + 1] : undefined;
    if (storeAt >= 0 && !store) throw new Error("--store requires a directory");
    console.log(JSON.stringify(await importFirmware(consoleName, sourcePath, store), null, 2));
    return 0;
  }
  const [command, ...rest] = args;
  switch (command) {
    case "init":
      return print({ manifest: await pm.init() });
    case "install":
    case "i":
      return print(await pm.install({ frozen: rest.includes("--frozen-lockfile"), sources: rest.includes("--sources") }));
    case "add":
    case "a":
      if (!rest.length) throw new Error(`usage:
  ${usage}`);
      await pm.add(rest);
      return print(await pm.list());
    case "remove":
    case "rm":
      await pm.remove(rest);
      return print(await pm.list());
    case "ls":
    case "list":
      return print(await pm.list());
    case "why":
      return print(await pm.why(rest[0] ?? ""));
    case "info":
      return print(await pm.info(rest[0] ?? ""));
    case "search":
      return print(await pm.search(rest[0]));
    case "outdated":
      return print(await pm.outdated(rest));
    case "update":
      return print(await pm.update(rest));
    case "cache":
      return print(rest[0] === "prune" ? await pm.pruneCache(rest.slice(1)) : pm.cacheDirectories());
    case "bun":
      break;
    default:
      throw new Error(`usage:
  ${usage}`);
  }
  const child = Bun.spawn([process.execPath, ...rest], {
    cwd: process.cwd(),
    env: { ...process.env, BUN_BE_BUN: "1" },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return child.exited;
}
