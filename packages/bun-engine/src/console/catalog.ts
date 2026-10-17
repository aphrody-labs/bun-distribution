export const sourceKinds = ["rust-crate", "c-source-tree", "cpp-source-tree", "free-sdk"] as const;
export const firmwarePolicies = ["not-required", "caller-supplied-only", "redistributable-only"] as const;
export const publicationGates = ["deferred-review", "approved"] as const;
export const integrations = ["local-plugin", "submodule"] as const;

type SourceKind = (typeof sourceKinds)[number];
type FirmwarePolicy = (typeof firmwarePolicies)[number];
type PublicationGate = (typeof publicationGates)[number];
type Integration = (typeof integrations)[number];

export interface ConsoleCatalogSource {
  kind: SourceKind;
  path: string;
}
export interface ConsoleCatalogComponent {
  id: string;
  console: string;
  cpu: string[];
  runtime: string;
  firmwarePolicy: FirmwarePolicy;
  license: string;
  publicationGate: PublicationGate;
  integration: Integration;
  sourceRev: string;
  buildOwner: string;
  sources: ConsoleCatalogSource[];
}
export interface ConsoleCatalog {
  schemaVersion: 1;
  kernelIntegration: "unified";
  components: ConsoleCatalogComponent[];
}

const token = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const revision = /^[0-9a-f]{40}$/;

function safeSourcePath(path: unknown): path is string {
  if (typeof path !== "string") return false;
  return (
    (path.startsWith("crates/") || path.startsWith("vendor/")) &&
    !path.includes("..") &&
    !path.includes("\\") &&
    !path.startsWith("/")
  );
}

async function sourceExists(path: string, root: string): Promise<boolean> {
  if (await Bun.file(`${root}/${path}`).exists()) return true;
  for await (const _entry of new Bun.Glob("*").scan({ cwd: `${root}/${path}` })) return true;
  return false;
}

export async function loadConsoleCatalog(): Promise<ConsoleCatalog> {
  return Bun.file(new URL("../../plugins/consoles/manifest.json", import.meta.url)).json();
}

export async function validateConsoleCatalog(
  catalog: ConsoleCatalog,
  root = new URL("../../../../", import.meta.url).pathname.slice(1).replaceAll("/", "\\"),
): Promise<string[]> {
  const errors: string[] = [];
  if (catalog.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (catalog.kernelIntegration !== "unified") errors.push("kernelIntegration must be unified");
  if (!Array.isArray(catalog.components) || catalog.components.length === 0) {
    errors.push("components must be a non-empty array");
    return errors;
  }
  const ids = new Set<string>();
  for (const [index, component] of catalog.components.entries()) {
    const at = `components[${index}]`;
    if (!token.test(component.id)) errors.push(`${at}.id must be a token`);
    if (ids.has(component.id)) errors.push(`${at}.id must be unique`);
    ids.add(component.id);
    if (!token.test(component.console)) errors.push(`${at}.console must be a token`);
    if (!Array.isArray(component.cpu) || component.cpu.some(cpu => !token.test(cpu)))
      errors.push(`${at}.cpu must contain tokens`);
    if (!token.test(component.runtime)) errors.push(`${at}.runtime must be a token`);
    if (!firmwarePolicies.includes(component.firmwarePolicy)) errors.push(`${at}.firmwarePolicy is invalid`);
    if (typeof component.license !== "string" || component.license.length < 3) errors.push(`${at}.license is required`);
    if (!publicationGates.includes(component.publicationGate)) errors.push(`${at}.publicationGate is invalid`);
    if (!integrations.includes(component.integration)) errors.push(`${at}.integration is invalid`);
    if (!revision.test(component.sourceRev)) errors.push(`${at}.sourceRev must be a full git SHA`);
    if (typeof component.buildOwner !== "string" || !component.buildOwner.includes("#"))
      errors.push(`${at}.buildOwner must identify an owner`);
    if (!Array.isArray(component.sources) || component.sources.length === 0) {
      errors.push(`${at}.sources must be non-empty`);
      continue;
    }
    for (const [sourceIndex, source] of component.sources.entries()) {
      const sourceAt = `${at}.sources[${sourceIndex}]`;
      if (!sourceKinds.includes(source.kind)) errors.push(`${sourceAt}.kind is invalid`);
      if (!safeSourcePath(source.path)) errors.push(`${sourceAt}.path escapes owned source roots`);
      else if (component.integration === "submodule") {
        // The pinned gitlink is the source of truth; the submodule need not be checked out.
        const pinned = Bun.spawnSync(["git", "-C", root, "ls-files", "-s", "--", source.path]).stdout.toString();
        const [mode, sha] = pinned.split(/\s+/);
        if (mode !== "160000") errors.push(`${sourceAt}.path is not a pinned submodule: ${source.path}`);
        else if (sha !== component.sourceRev) errors.push(`${sourceAt}.revision does not match sourceRev`);
      } else if (!(await sourceExists(source.path, root)))
        errors.push(`${sourceAt}.path does not exist: ${source.path}`);
    }
  }
  return errors;
}
