// `bep test owned`: every owned title runs headless on its launch route for N frames (the native
// Bun Engine machine, else the bep release emulator or RetroArch in check mode), and every owned
// BIOS boots its native machine in place of the free replacement. Frame hashes, PNG screenshots,
// thumbnails and statuses go to a private report under usr/var/lib/bep/owned-tests/<run>/ and the
// owned_tests table of library.db; nothing is committed.
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { listFirmware, defaultFirmwareStore } from "../firmware/import";
import { nativeEngine } from "../formats/tools";
import { chooseRoute, launchGame } from "../frontend/launch";
import { findGame } from "../frontend/library";
import { loadSystems, type SystemDefinition } from "../frontend/systems";
import * as pm from "../pm";
import { repoRoot } from "../usr";
import { type OwnedDump, listOwned, ownedDb, ownedPaths, storePath } from "./store";

export interface OwnedTestOptions {
  system?: string;
  frames?: number;
  only?: string[];
  timeoutMs?: number;
  /** Skip the ROM runs or the BIOS boots. */
  roms?: boolean;
  bios?: boolean;
}

export interface OwnedTestResult {
  sha256: string;
  name: string;
  mode: "rom" | "bios" | "bios-free";
  system: string | null;
  route: string | null;
  status: "pass" | "blank" | "fail" | "timeout" | "skipped";
  frames?: number;
  frameHash?: string;
  screenshot?: string;
  thumbnail?: string;
  bios?: string;
  ms: number;
  detail?: string;
}

// ---- PNG --------------------------------------------------------------------------------------

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, Bun.hash.crc32(out.subarray(4, 8 + data.length)) >>> 0);
  return out;
}

/** P6 PPM (what `bun-engine run --out` writes) to an 8-bit RGB PNG; `blank` when every pixel matches. */
export function ppmToPng(ppm: Uint8Array): { png: Uint8Array; width: number; height: number; blank: boolean } {
  const head = new TextDecoder("latin1").decode(ppm.subarray(0, 64));
  const match = /^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(head);
  if (!match) throw new Error("not a P6 PPM");
  const width = Number(match[1]);
  const height = Number(match[2]);
  const rgb = ppm.subarray(match[0].length, match[0].length + width * height * 3);
  const raw = new Uint8Array(height * (1 + width * 3));
  let blank = true;
  for (let y = 0; y < height; y++) {
    const row = rgb.subarray(y * width * 3, (y + 1) * width * 3);
    raw.set(row, y * (1 + width * 3) + 1);
    if (blank)
      for (let i = 3; i < row.length; i++)
        if (row[i] !== rgb[i % 3]) {
          blank = false;
          break;
        }
  }
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, width);
  new DataView(ihdr.buffer).setUint32(4, height);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", Bun.deflateSync(raw, { windowBits: 15, level: 6 })),
    chunk("IEND", new Uint8Array()),
  ];
  const png = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    png.set(part, at);
    at += part.length;
  }
  return { png, width, height, blank };
}

// ---- native runs ------------------------------------------------------------------------------

interface NativeRun {
  status: OwnedTestResult["status"];
  frames?: number;
  frameHash?: string;
  screenshot?: string;
  thumbnail?: string;
  detail?: string;
  ms: number;
}

async function runNative(
  machine: string,
  image: string,
  bios: string | undefined,
  frames: number,
  timeoutMs: number,
  out: string,
  stem: string,
): Promise<NativeRun> {
  const engine = nativeEngine();
  if (!engine) return { status: "skipped", detail: "native bun-engine is not built", ms: 0 };
  const screens = join(out, `${stem}.screens`);
  const command = [engine, "run", machine, image, "--headless", "--frames", String(frames), "--out", screens];
  if (bios) command.push("--bios", bios);
  const started = performance.now();
  const child = Bun.spawn(command, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, timeoutMs);
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  clearTimeout(timer);
  const ms = Math.round(performance.now() - started);
  // "<machine>: N frames" ends a headless run; the frame hash is the SHA-256 of the final screens.
  const ran = /: (\d+) frames\s*$/m.exec(stdout);
  const hasher = new Bun.CryptoHasher("sha256");
  let screenCount = 0;
  for (let index = 0; existsSync(join(screens, `screen${index}.ppm`)); index++, screenCount++)
    hasher.update(await Bun.file(join(screens, `screen${index}.ppm`)).bytes());
  const result: NativeRun = {
    status: timedOut ? "timeout" : code === 0 ? "pass" : "fail",
    frames: ran ? Number(ran[1]) : 0,
    ...(screenCount ? { frameHash: hasher.digest("hex") } : {}),
    ms,
    detail: `${stdout}\n${stderr}`.split(/\r?\n/).filter(Boolean).slice(-4).join(" | ") || undefined,
  };
  const ppm = join(screens, "screen0.ppm");
  if (existsSync(ppm)) {
    const { png, blank } = ppmToPng(await Bun.file(ppm).bytes());
    result.screenshot = join(out, `${stem}.png`);
    result.thumbnail = join(out, `${stem}.thumb.png`);
    await Bun.write(result.screenshot, png);
    await new Bun.Image(png).resize(160, 160, { fit: "inside", filter: "nearest" }).png().write(result.thumbnail);
    if (blank && result.status === "pass") result.status = "blank";
  }
  await rm(screens, { recursive: true, force: true });
  return result;
}

/** The owner's BIOS for a native machine, else the free replacement in the firmware store. */
async function biosFor(system: SystemDefinition): Promise<{ path: string; owned: boolean } | undefined> {
  const wanted = system.native?.bios;
  if (!wanted) return undefined;
  const fits = (bytes: number) => system.native!.machine !== "psx" || bytes === 512 * 1024;
  const owned = listOwned({ kind: "firmware" }).find((dump) => dump.console === wanted.console && dump.status !== "bad-dump" && fits(dump.size));
  if (owned) return { path: storePath(owned), owned: true };
  const free = (await listFirmware(wanted.console).catch(() => [])).find(
    (image) => fits(image.bytes) && (image as { origin?: string }).origin !== "owned",
  );
  return free ? { path: join(defaultFirmwareStore(), free.console, free.file), owned: false } : undefined;
}

function label(dump: OwnedDump): string {
  return dump.title ?? dump.names[0] ?? dump.sha256.slice(0, 12);
}

/** Runs the owned titles and BIOS; returns the report path and every result. */
export async function testOwned(options: OwnedTestOptions = {}): Promise<{ run: string; report: string; results: OwnedTestResult[] }> {
  const frames = options.frames ?? 180;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const run = new Date().toISOString().replace(/[:.]/g, "-");
  const out = join(ownedPaths().reports, run);
  await mkdir(out, { recursive: true });
  const { systems } = await loadSystems();
  const systemById = new Map(systems.map((system) => [system.id, system]));
  const selected = (dump: OwnedDump) =>
    (!options.system || dump.system === options.system) &&
    (!options.only?.length || options.only.some((sha) => dump.sha256.startsWith(sha.toLowerCase())));
  const results: OwnedTestResult[] = [];

  for (const dump of options.roms === false ? [] : listOwned({ kind: "rom" }).filter(selected)) {
    const base = { sha256: dump.sha256, name: label(dump), mode: "rom" as const, system: dump.system };
    const system = dump.system ? systemById.get(dump.system) : undefined;
    if (!system) {
      results.push({ ...base, route: null, status: "skipped", ms: 0, detail: "system unknown; re-import with --system" });
      continue;
    }
    try {
      const game = await findGame(storePath(dump), system.id);
      const route = await chooseRoute(game);
      if (route.kind === "native") {
        const bios = await biosFor(system);
        const result = await runNative(system.native!.machine, storePath(dump), bios?.path, frames, timeoutMs, out, `${dump.sha256.slice(0, 12)}-rom`);
        results.push({ ...base, route: route.id, ...result, ...(bios ? { bios: bios.owned ? "owned" : "free" } : {}) });
      } else {
        const launched = await launchGame(game, { route: route.id, check: true, frames, timeoutMs });
        results.push({
          ...base,
          route: route.id,
          status: launched.ok ? "pass" : launched.alive ? "timeout" : "fail",
          ms: launched.ms,
          detail: launched.error ?? launched.output?.split("\n").slice(-3).join(" | "),
        });
      }
    } catch (error) {
      results.push({ ...base, route: null, status: "skipped", ms: 0, detail: error instanceof Error ? error.message : String(error) });
    }
  }

  for (const dump of options.bios === false ? [] : listOwned({ kind: "firmware" }).filter(selected)) {
    const system = systems.find((item) => item.native?.bios?.console === dump.console);
    const base = { sha256: dump.sha256, name: label(dump), system: system?.id ?? dump.system };
    if (!system?.native) {
      results.push({ ...base, mode: "bios", route: null, status: "skipped", ms: 0, detail: `no native machine boots ${dump.console} firmware; libretro cores read it from usr/share/bun-engine/system` });
      continue;
    }
    // The BIOS boots alone (PlayStation shell) or under a free test cartridge (GBA intro).
    let media = join(out, "empty.bin");
    if (system.native.machine === "psx") await Bun.write(media, new Uint8Array());
    else {
      const free = (await pm.freeRoms(dump.console)).find((rom) => system.native!.extensions.some((ext) => rom.path.endsWith(`.${ext}`)));
      if (!free) {
        results.push({ ...base, mode: "bios", route: null, status: "skipped", ms: 0, detail: "no free test cartridge for this machine" });
        continue;
      }
      media = join(repoRoot, free.path);
    }
    const machine = system.native.machine;
    const owned = await runNative(machine, media, storePath(dump), frames, timeoutMs, out, `${dump.sha256.slice(0, 12)}-bios`);
    results.push({ ...base, mode: "bios", route: `native:${machine}`, bios: "owned", ...owned });
    const free = (await listFirmware(dump.console).catch(() => [])).find(
      (image) => image.sha256 !== dump.sha256 && (image as { origin?: string }).origin !== "owned",
    );
    if (free) {
      const reference = await runNative(machine, media, join(defaultFirmwareStore(), free.console, free.file), frames, timeoutMs, out, `${dump.sha256.slice(0, 12)}-bios-free`);
      results.push({ ...base, mode: "bios-free", route: `native:${machine}`, bios: free.file, ...reference });
    }
  }

  const at = new Date().toISOString();
  const insert = ownedDb().query(
    "INSERT INTO owned_tests VALUES ($run, $sha256, $mode, $route, $status, $frames, $frameHash, $screenshot, $ms, $detail, $at)",
  );
  for (const result of results)
    insert.run({
      run,
      sha256: result.sha256,
      mode: result.mode,
      route: result.route,
      status: result.status,
      frames: result.frames ?? null,
      frameHash: result.frameHash ?? null,
      screenshot: result.screenshot ?? null,
      ms: result.ms,
      detail: result.detail ?? null,
      at,
    });
  const report = join(out, "report.json");
  await Bun.write(report, `${JSON.stringify({ run, frames, results }, null, 2)}\n`);
  return { run, report, results };
}
