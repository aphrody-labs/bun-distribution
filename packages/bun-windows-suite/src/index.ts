export const capabilityNames = ["windows", "winrt", "winui", "dotnet"] as const;
export type WindowsCapability = (typeof capabilityNames)[number];

const specifiers: Record<WindowsCapability, string> = {
  windows: "bun:windows",
  winrt: "bun:winrt",
  winui: "bun:winui",
  dotnet: "bun:dotnet",
};

export function parseCapabilities(value = process.env.BUN_WINDOWS_CAPABILITIES ?? ""): WindowsCapability[] {
  if (!value.trim()) return [];
  const requested = value.split(",").map(name => name.trim().toLowerCase());
  if (requested.includes("all")) return [...capabilityNames];
  const unknown = requested.filter(name => name && !capabilityNames.includes(name as WindowsCapability));
  if (unknown.length) throw new TypeError(`Unknown Bun Windows capability: ${unknown.join(", ")}`);
  return capabilityNames.filter(name => requested.includes(name));
}

export async function activate(
  requested: readonly WindowsCapability[] = parseCapabilities(),
): Promise<Partial<Record<WindowsCapability, unknown>>> {
  const active: Partial<Record<WindowsCapability, unknown>> = {};
  for (const name of requested) active[name] = await import(specifiers[name]);
  return active;
}

export function sourceCheckouts(root = new URL("../../../", import.meta.url)): Record<string, URL> {
  return {
    powershell: new URL("vendor/powershell/", root),
    roslyn: new URL("vendor/roslyn/", root),
    terminal: new URL("vendor/windows-terminal/", root),
    vcpkg: new URL("vendor/vcpkg/", root),
    fluentui: new URL("vendor/fluentui/", root),
  };
}

export {
  buildJevTriageRequest,
  JEV_MODEL,
  triageWindowsFinding,
  WINDOWS_FINDING_QUESTIONS,
  type JevTriageResult,
  type WindowsFinding,
} from "./jev-triage";
