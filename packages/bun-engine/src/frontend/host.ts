// Real host state for the Settings panels (display, audio, network, storage) and the display power
// control of the power menu. Nothing here is guessed: each section is read from a tool or a kernel file
// that exists on this host, and a section whose source is missing says so with the reason, so the page
// shows a "not available" state instead of a switch that does nothing.
import { existsSync, readdirSync, readFileSync, statfsSync, statSync } from "node:fs";
import { join } from "node:path";
import { usrRoot } from "../usr";
import { listSources, projectDir, romStore } from "./library";
import { retroarchHome } from "./saves";

interface Ran {
  ok: boolean;
  out: string;
  err: string;
}

/** Runs a program with a deadline; a program that is missing, fails or hangs gives `ok: false`. */
async function run(command: string[], timeoutMs = 2500): Promise<Ran> {
  const program = Bun.which(command[0]!);
  if (!program) return { ok: false, out: "", err: `${command[0]} not found` };
  try {
    const child = Bun.spawn([program, ...command.slice(1)], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    clearTimeout(timer);
    return { ok: code === 0, out, err: err.trim() };
  } catch (error) {
    return { ok: false, out: "", err: error instanceof Error ? error.message : String(error) };
  }
}

export type Section<T> = ({ available: true; source: string } & T) | { available: false; reason: string };

// ---- display ------------------------------------------------------------------------------------

export interface Output {
  name: string;
  model: string | null;
  width: number;
  height: number;
  /** Hz, null when the source does not report it. */
  refresh: number | null;
  scale: number | null;
  /** false when the output is powered off (display sleep). */
  on: boolean | null;
}

async function swayOutputs(): Promise<Output[] | undefined> {
  if (!Bun.env.SWAYSOCK) return undefined;
  const result = await run(["swaymsg", "-t", "get_outputs", "-r"]);
  if (!result.ok) return undefined;
  const rows = JSON.parse(result.out) as Array<{
    name: string;
    make?: string;
    model?: string;
    active?: boolean;
    power?: boolean;
    scale?: number;
    current_mode?: { width: number; height: number; refresh: number };
  }>;
  return rows
    .filter(row => row.active && row.current_mode)
    .map(row => ({
      name: row.name,
      model: [row.make, row.model].filter(part => part && part !== "Unknown").join(" ") || null,
      width: row.current_mode!.width,
      height: row.current_mode!.height,
      refresh: row.current_mode!.refresh ? Math.round(row.current_mode!.refresh / 10) / 100 : null,
      scale: row.scale ?? null,
      on: row.power ?? null,
    }));
}

async function xrandrOutputs(): Promise<Output[] | undefined> {
  if (!Bun.env.DISPLAY) return undefined;
  const result = await run(["xrandr", "--current"]);
  if (!result.ok) return undefined;
  const outputs: Output[] = [];
  const lines = result.out.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const head = /^(\S+) connected (?:primary )?(\d+)x(\d+)\+\d+\+\d+/.exec(lines[i]!);
    if (!head) continue;
    let refresh: number | null = null;
    for (let j = i + 1; j < lines.length && /^\s/.test(lines[j]!); j++) {
      const active = /\s(\d+(?:\.\d+)?)\*/.exec(lines[j]!);
      if (active) refresh = Number(active[1]);
    }
    outputs.push({ name: head[1]!, model: null, width: Number(head[2]), height: Number(head[3]), refresh, scale: null, on: null });
  }
  return outputs.length ? outputs : undefined;
}

/** Connected connectors and their first (preferred) mode, straight from the kernel's DRM class. */
function drmOutputs(): Output[] | undefined {
  const base = "/sys/class/drm";
  if (!existsSync(base)) return undefined;
  const outputs: Output[] = [];
  for (const entry of readdirSync(base)) {
    if (!/^card\d+-/.test(entry)) continue;
    try {
      if (readFileSync(join(base, entry, "status"), "utf8").trim() !== "connected") continue;
      const mode = /^(\d+)x(\d+)/.exec(readFileSync(join(base, entry, "modes"), "utf8").split("\n")[0] ?? "");
      if (mode) outputs.push({ name: entry.replace(/^card\d+-/, ""), model: null, width: Number(mode[1]), height: Number(mode[2]), refresh: null, scale: null, on: null });
    } catch {
      // a connector without status or modes is not a screen
    }
  }
  return outputs.length ? outputs : undefined;
}

async function displaySection(): Promise<Section<{ outputs: Output[] }>> {
  for (const [source, read] of [
    ["sway", swayOutputs],
    ["xrandr", xrandrOutputs],
    ["drm", async () => drmOutputs()],
  ] as const) {
    const outputs = await read();
    if (outputs) return { available: true, source, outputs };
  }
  return {
    available: false,
    reason: "No display server answered (no Sway socket, no X11 display) and the kernel lists no connected screen. The page still shows what the browser reports.",
  };
}

// ---- audio --------------------------------------------------------------------------------------

export interface Sink {
  id: string;
  name: string;
  default: boolean;
  /** 0..1 or more (over-amplified); null when unknown. */
  volume: number | null;
  muted: boolean | null;
}

async function pactlSinks(): Promise<Sink[] | { error: string } | undefined> {
  if (!Bun.which("pactl")) return undefined;
  const [list, defaultSink] = await Promise.all([run(["pactl", "--format=json", "list", "sinks"]), run(["pactl", "get-default-sink"])]);
  if (!list.ok) return { error: list.err || "pactl could not reach the sound server" };
  const rows = JSON.parse(list.out) as Array<{ name: string; description?: string; mute?: boolean; volume?: Record<string, { value_percent?: string }> }>;
  const fallback = defaultSink.out.trim();
  return rows.map(row => {
    const percent = Object.values(row.volume ?? {})[0]?.value_percent;
    return {
      id: row.name,
      name: row.description ?? row.name,
      default: row.name === fallback,
      volume: percent ? Number.parseFloat(percent) / 100 : null,
      muted: row.mute ?? null,
    };
  });
}

async function wpctlSinks(): Promise<Sink[] | { error: string } | undefined> {
  if (!Bun.which("wpctl")) return undefined;
  const status = await run(["wpctl", "status"]);
  if (!status.ok) return { error: status.err || "wpctl could not reach PipeWire" };
  const sinks: Sink[] = [];
  let inSinks = false;
  for (const line of status.out.split("\n")) {
    if (/Sinks:\s*$/.test(line)) {
      inSinks = true;
      continue;
    }
    if (inSinks && /(Sink endpoints|Sources|Source endpoints|Filters|Streams|Video|Settings):?\s*$/.test(line)) break;
    if (!inSinks) continue;
    const row = /^[\s│├└─]*(\*)?\s*(\d+)\.\s+(.+?)(?:\s+\[vol:\s*([\d.]+)(\s+MUTED)?\])?\s*$/.exec(line);
    if (row) sinks.push({ id: row[2]!, name: row[3]!, default: Boolean(row[1]), volume: row[4] ? Number(row[4]) : null, muted: row[4] ? Boolean(row[5]) : null });
  }
  return sinks;
}

async function audioSection(): Promise<Section<{ sinks: Sink[] }>> {
  const tried: string[] = [];
  for (const [source, read] of [
    ["pactl", pactlSinks],
    ["wpctl", wpctlSinks],
  ] as const) {
    const sinks = await read();
    if (!sinks) {
      tried.push(`${source} is not installed`);
      continue;
    }
    if ("error" in sinks) {
      tried.push(`${source}: ${sinks.error}`);
      continue;
    }
    return { available: true, source, sinks };
  }
  return { available: false, reason: `No sound server answered (${tried.join("; ")}). Game audio still plays through the browser.` };
}

// ---- network ------------------------------------------------------------------------------------

export interface Interface {
  name: string;
  state: string;
  kind: string | null;
  connection: string | null;
  addresses: string[];
  gateway: boolean;
  /** No hardware behind it (bridge, tunnel, container link): /sys/class/net/<name>/device is absent. */
  virtual: boolean;
}

async function networkSection(): Promise<Section<{ interfaces: Interface[]; gateway: string | null }>> {
  let source = "ip";
  let interfaces: Interface[] = [];
  let gateway: string | null = null;
  const addr = await run(["ip", "-j", "addr"]);
  if (addr.ok) {
    const rows = JSON.parse(addr.out) as Array<{
      ifname: string;
      operstate: string;
      link_type: string;
      addr_info?: Array<{ local: string; prefixlen: number; scope: string }>;
    }>;
    interfaces = rows
      .filter(row => row.link_type !== "loopback")
      .map(row => ({
        name: row.ifname,
        state: row.operstate.toLowerCase(),
        kind: null,
        connection: null,
        addresses: (row.addr_info ?? []).filter(info => info.scope === "global").map(info => `${info.local}/${info.prefixlen}`),
        gateway: false,
        virtual: !existsSync(join("/sys/class/net", row.ifname, "device")),
      }));
    const route = await run(["ip", "-j", "route", "show", "default"]);
    if (route.ok) {
      const first = (JSON.parse(route.out || "[]") as Array<{ gateway?: string; dev?: string }>)[0];
      gateway = first?.gateway ?? null;
      for (const item of interfaces) item.gateway = item.name === first?.dev;
    }
  } else if (existsSync("/sys/class/net")) {
    source = "sysfs";
    interfaces = readdirSync("/sys/class/net")
      .filter(name => name !== "lo")
      .map(name => {
        let state = "unknown";
        try {
          state = readFileSync(join("/sys/class/net", name, "operstate"), "utf8").trim();
        } catch {
          // keep unknown
        }
        return { name, state, kind: null, connection: null, addresses: [], gateway: false, virtual: !existsSync(join("/sys/class/net", name, "device")) };
      });
  } else {
    return { available: false, reason: "Neither the ip tool nor /sys/class/net is available on this device." };
  }
  // NetworkManager adds the device type and the connection profile name when it runs here
  const manager = await run(["nmcli", "-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device", "status"]);
  if (manager.ok) {
    source += "+nmcli";
    for (const line of manager.out.trim().split("\n")) {
      const [device, kind, , connection] = line.split(":");
      const item = interfaces.find(candidate => candidate.name === device);
      if (item) {
        item.kind = kind || null;
        item.connection = connection && connection !== "--" ? connection : null;
      }
    }
  }
  return { available: true, source, interfaces, gateway };
}

// ---- storage ------------------------------------------------------------------------------------

export interface Volume {
  /** What lives here: library, game folders, saves. */
  labels: string[];
  paths: string[];
  totalBytes: number;
  freeBytes: number;
}

function walkBytes(path: string, budget = { files: 50_000 }): { bytes: number; files: number } {
  let bytes = 0;
  let files = 0;
  try {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) {
        const inner = walkBytes(full, budget);
        bytes += inner.bytes;
        files += inner.files;
      } else if (entry.isFile() && budget.files-- > 0) {
        bytes += statSync(full).size;
        files++;
      }
    }
  } catch {
    // an unreadable folder counts as empty
  }
  return { bytes, files };
}

function storageSection(): Section<{
  volumes: Volume[];
  saves: { path: string; bytes: number; files: number; profiles: Array<{ profile: string; bytes: number }> };
}> {
  const places: Array<[string, string]> = [
    ["Library", projectDir()],
    ["ROM store", romStore()],
    ["Engine data", usrRoot()],
    ["Saves", retroarchHome()],
    ...listSources()
      .filter(source => source.kind === "folder")
      .map(source => ["Game folder", source.path] as [string, string]),
  ];
  const volumes = new Map<number, Volume>();
  for (const [label, path] of places) {
    if (!existsSync(path)) continue;
    try {
      const device = statSync(path).dev;
      const fs = statfsSync(path);
      const volume = volumes.get(device) ?? { labels: [], paths: [], totalBytes: fs.blocks * fs.bsize, freeBytes: fs.bavail * fs.bsize };
      if (!volume.labels.includes(label)) volume.labels.push(label);
      volume.paths.push(path);
      volumes.set(device, volume);
    } catch {
      // a path the kernel cannot stat is left out
    }
  }
  if (!volumes.size) return { available: false, reason: "None of the library, game or save folders exists yet on this device." };
  const saves = retroarchHome();
  const total = walkBytes(saves);
  const profiles = existsSync(join(saves, "profiles"))
    ? readdirSync(join(saves, "profiles"), { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => ({ profile: entry.name, bytes: walkBytes(join(saves, "profiles", entry.name)).bytes }))
    : [];
  return { available: true, source: "statfs", volumes: [...volumes.values()], saves: { path: saves, ...total, profiles } };
}

export async function hostState() {
  const [display, audio, network] = await Promise.all([displaySection(), audioSection(), networkSection()]);
  return { display, audio, network, storage: storageSection(), sleep: await sleepSupport(), asleep };
}

// ---- display sleep ------------------------------------------------------------------------------

type SleepMechanism = "sway" | "xset";
let asleep = false;

export const displayAsleep = () => asleep;

function mechanism(): SleepMechanism | undefined {
  if (Bun.env.SWAYSOCK && Bun.which("swaymsg")) return "sway";
  if (Bun.env.DISPLAY && !Bun.env.WAYLAND_DISPLAY && Bun.which("xset")) return "xset";
  return undefined;
}

export async function sleepSupport(): Promise<{ available: boolean; mechanism?: SleepMechanism; reason?: string }> {
  const how = mechanism();
  if (how) return { available: true, mechanism: how };
  return {
    available: false,
    reason:
      Bun.env.GAMESCOPE_WAYLAND_DISPLAY || Bun.env.XDG_CURRENT_DESKTOP === "gamescope"
        ? "Gamescope has no display power control and no Sway socket or X11 display is reachable from here."
        : "Needs a Sway session (swaymsg) or an X11 display with xset; neither is reachable from this service.",
  };
}

async function displaysOn(how: SleepMechanism): Promise<boolean | undefined> {
  if (how === "sway") {
    const result = await run(["swaymsg", "-t", "get_outputs", "-r"]);
    if (!result.ok) return undefined;
    const rows = (JSON.parse(result.out) as Array<{ active?: boolean; power?: boolean }>).filter(row => row.active);
    return rows.length ? rows.some(row => row.power !== false) : undefined;
  }
  const result = await run(["xset", "q"]);
  if (!result.ok) return undefined;
  return !/Monitor is (Off|Standby|Suspend)/.test(result.out);
}

/** Powers the display off and checks with the same tool that it really is off; never reports unverified success. */
export async function sleepDisplay(): Promise<{ ok: boolean; mechanism?: SleepMechanism; error?: string }> {
  const how = mechanism();
  if (!how) return { ok: false, error: (await sleepSupport()).reason };
  const command = how === "sway" ? ["swaymsg", "output * power off"] : ["xset", "dpms", "force", "off"];
  const result = await run(command);
  if (!result.ok) return { ok: false, mechanism: how, error: result.err || `${command[0]} failed` };
  await Bun.sleep(150);
  if ((await displaysOn(how)) !== false) return { ok: false, mechanism: how, error: `${command[0]} ran but the display still reports on` };
  asleep = true;
  return { ok: true, mechanism: how };
}

export async function wakeDisplay(): Promise<{ ok: boolean; mechanism?: SleepMechanism; error?: string }> {
  const how = mechanism();
  if (!how) return { ok: false, error: (await sleepSupport()).reason };
  const command = how === "sway" ? ["swaymsg", "output * power on"] : ["xset", "dpms", "force", "on"];
  const result = await run(command);
  if (!result.ok) return { ok: false, mechanism: how, error: result.err || `${command[0]} failed` };
  await Bun.sleep(150);
  if ((await displaysOn(how)) === false) return { ok: false, mechanism: how, error: "the display still reports off" };
  asleep = false;
  return { ok: true, mechanism: how };
}
