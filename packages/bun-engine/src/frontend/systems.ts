// The frontend system list (plugins/consoles/systems.json): which consoles, extensions, native
// machine, release binaries and libretro cores make up each system, in launch-priority order.
import { extname, join } from "node:path";

export interface NativeMachine {
  machine: string;
  extensions: string[];
  bios?: { console: string; freeFirmware: string; required: boolean };
}

export interface SystemDefinition {
  id: string;
  name: string;
  manufacturer: string;
  year: number;
  consoles: string[];
  extensions: string[];
  native?: NativeMachine;
  binaries: string[];
  libretro: string[];
  dats: string[];
  headerBytes?: Record<string, number>;
}

export interface EmulatorLaunch {
  args: string[];
  probe: string[];
  /** Exit codes of `probe` that mean the emulator runs (DuckStation's `-help` exits 1). */
  probeExit?: number[];
  check?: string[];
}

export interface SystemRegistry {
  schemaVersion: 1;
  autoDetect: { exclude: string[] };
  emulators: Record<string, EmulatorLaunch>;
  systems: SystemDefinition[];
}

let registry: SystemRegistry | undefined;

export async function loadSystems(): Promise<SystemRegistry> {
  registry ??= (await Bun.file(
    join(import.meta.dir, "..", "..", "plugins", "consoles", "systems.json"),
  ).json()) as SystemRegistry;
  return registry;
}

export async function systemById(id: string): Promise<SystemDefinition> {
  const system = (await loadSystems()).systems.find((item) => item.id === id);
  if (!system) throw new Error(`unknown system ${id}`);
  return system;
}

export function extensionOf(path: string): string {
  return extname(path).slice(1).toLowerCase();
}

/** Systems whose catalog consoles include `console` (bep store and free ROM packs). */
export async function systemsForConsole(
  console: string,
): Promise<SystemDefinition[]> {
  return (await loadSystems()).systems.filter((system) =>
    system.consoles.includes(console),
  );
}

/**
 * The system of a file: the declared system when its extensions match, a Recalbox-style
 * `<system>/` directory, otherwise the first system claiming an unambiguous extension.
 */
export async function detectSystem(
  relativePath: string,
  declared?: string | null,
): Promise<SystemDefinition | undefined> {
  const { systems, autoDetect } = await loadSystems();
  const ext = extensionOf(relativePath);
  if (!ext) return undefined;
  const accepts = (system: SystemDefinition) =>
    system.extensions.includes(ext) || system.native?.extensions.includes(ext);
  if (declared) {
    const system = systems.find((item) => item.id === declared);
    return system && accepts(system) ? system : undefined;
  }
  for (const segment of relativePath.split(/[\\/]/).slice(0, -1).reverse()) {
    const system = systems.find((item) => item.id === segment.toLowerCase());
    if (system && accepts(system)) return system;
  }
  if (autoDetect.exclude.includes(ext)) return undefined;
  return systems.find(accepts);
}
