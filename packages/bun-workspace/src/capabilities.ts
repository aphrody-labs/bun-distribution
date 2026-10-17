import type { Config } from "./index.ts";

export interface AppCapability {
  id: string;
  libraryId: string;
  title: string;
  description: string;
}

const capabilities: readonly AppCapability[] = [
  {
    id: "video",
    libraryId: "filmcraft",
    title: "Video",
    description: "Video editing and timeline processing.",
  },
  {
    id: "generation",
    libraryId: "artcraft",
    title: "Generation",
    description: "Generation and creative processing.",
  },
  {
    id: "images",
    libraryId: "photocraft",
    title: "Images",
    description: "Image editing and processing.",
  },
  {
    id: "vectors",
    libraryId: "vectorcraft",
    title: "Vectors",
    description: "Vector drawing and geometry.",
  },
  {
    id: "compositing",
    libraryId: "effectcraft",
    title: "Compositing",
    description: "Motion graphics and compositing.",
  },
  {
    id: "photo-processing",
    libraryId: "lightcraft",
    title: "Photo processing",
    description: "Non-destructive photo processing.",
  },
  {
    id: "pdf",
    libraryId: "pdfcraft",
    title: "PDF",
    description: "PDF reading and processing.",
  },
  {
    id: "documents",
    libraryId: "wordcraft",
    title: "Documents",
    description: "Document editing and processing.",
  },
  {
    id: "audio",
    libraryId: "soundcraft",
    title: "Audio",
    description: "Audio editing and processing.",
  },
  {
    id: "layout",
    libraryId: "designcraft",
    title: "Layout",
    description: "Page composition and layout.",
  },
  {
    id: "cad",
    libraryId: "cadcraft",
    title: "CAD",
    description: "Drafting and technical geometry.",
  },
  {
    id: "slides",
    libraryId: "deckcraft",
    title: "Slides",
    description: "Presentation composition.",
  },
  {
    id: "tables",
    libraryId: "gridcraft",
    title: "Tables",
    description: "Spreadsheet processing.",
  },
  {
    id: "interface-layouts",
    libraryId: "figcraft",
    title: "Interface layouts",
    description: "Interface composition and prototyping.",
  },
];

/** Presentation and application IDs have one owner; source pins remain in the config. */
export function capabilityFor(libraryId: string): {
  title: string;
  description: string;
} {
  const capability = capabilities.find(entry => entry.libraryId === libraryId);
  if (capability) return { title: capability.title, description: capability.description };
  if (libraryId === "craft-libs")
    return {
      title: "Shared libraries",
      description: "Shared Rust processing libraries.",
    };
  if (libraryId === "craft-fonts")
    return {
      title: "Fonts",
      description: "Font resources for native processing.",
    };
  return { title: "Library", description: "Native processing library." };
}

export function appCapabilityFor(appId: string): AppCapability | undefined {
  const entry = capabilities.find(capability => capability.id === appId);
  return entry ? { ...entry } : undefined;
}

export function appCapabilityForLibrary(libraryId: string): AppCapability | undefined {
  const capability = capabilities.find(entry => entry.libraryId === libraryId);
  return capability ? { ...capability } : undefined;
}

export function appCapabilities(config: Pick<Config, "modules" | "priorities">): AppCapability[] {
  const engines = new Set(config.modules.filter(module => module.role === "engine").map(module => module.id));
  for (const id of engines) {
    if (!capabilities.some(entry => entry.libraryId === id)) throw new Error(`Application capability missing: ${id}`);
  }
  const selected = capabilities.filter(entry => engines.has(entry.libraryId));
  const priorities = config.priorities ?? [];
  return selected
    .map(entry => ({ ...entry }))
    .sort((a, b) => Number(priorities.includes(b.libraryId)) - Number(priorities.includes(a.libraryId)));
}

export function appHostname(
  capabilityId: string,
  config: Pick<Config, "modules" | "priorities" | "deployment">,
): string {
  if (!appCapabilities(config).some(entry => entry.id === capabilityId))
    throw new Error(`Unknown application: ${capabilityId}`);
  if (!config.deployment) throw new Error("Application deployment settings are required.");
  const label = `${config.deployment.appPrefix}${capabilityId}`;
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    throw new Error(`Invalid application hostname: ${capabilityId}`);
  return `${label}.${config.deployment.domain}`;
}

/** Canonical app host plus the library-name DNS alias already used by clients. */
export function appHostnamesForLibrary(
  libraryId: string,
  config: Pick<Config, "modules" | "priorities" | "deployment">,
): string[] {
  const capability = appCapabilityForLibrary(libraryId);
  if (!capability) throw new Error(`Unknown application library: ${libraryId}`);
  const primary = appHostname(capability.id, config);
  const alias = `${libraryId}.${config.deployment!.domain}`;
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.[a-z0-9.-]+$/.test(alias))
    throw new Error(`Invalid application hostname alias: ${libraryId}`);
  return [...new Set([primary, alias])];
}
