import type { Config } from "./index.ts";

export interface AppCapability {
  id: string;
  libraryId: string;
  title: string;
  description: string;
  /** Installable Web OS package when this owner has a browser build. */
  webosPackageId?: string;
}

const capabilities: readonly AppCapability[] = [
  {
    id: "video",
    libraryId: "filmcraft",
    title: "Video",
    description: "Video editing and timeline processing.",
    webosPackageId: "craft-film",
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
    webosPackageId: "craft-photo",
  },
  {
    id: "vectors",
    libraryId: "vectorcraft",
    title: "Vectors",
    description: "Vector drawing and geometry.",
    webosPackageId: "craft-vector",
  },
  {
    id: "compositing",
    libraryId: "effectcraft",
    title: "Compositing",
    description: "Motion graphics and compositing.",
    webosPackageId: "craft-effect",
  },
  {
    id: "photo-processing",
    libraryId: "lightcraft",
    title: "Photo processing",
    description: "Non-destructive photo processing.",
    webosPackageId: "craft-light",
  },
  {
    id: "pdf",
    libraryId: "pdfcraft",
    title: "PDF",
    description: "PDF reading and processing.",
    webosPackageId: "craft-pdf",
  },
  {
    id: "documents",
    libraryId: "wordcraft",
    title: "Documents",
    description: "Document editing and processing.",
    webosPackageId: "craft-word",
  },
  {
    id: "audio",
    libraryId: "soundcraft",
    title: "Audio",
    description: "Audio editing and processing.",
    webosPackageId: "craft-sound",
  },
  {
    id: "layout",
    libraryId: "designcraft",
    title: "Layout",
    description: "Page composition and layout.",
    webosPackageId: "craft-design",
  },
  {
    id: "cad",
    libraryId: "cadcraft",
    title: "CAD",
    description: "Drafting and technical geometry.",
    webosPackageId: "craft-cad",
  },
  {
    id: "slides",
    libraryId: "deckcraft",
    title: "Slides",
    description: "Presentation composition.",
    webosPackageId: "craft-deck",
  },
  {
    id: "tables",
    libraryId: "gridcraft",
    title: "Tables",
    description: "Spreadsheet processing.",
    webosPackageId: "craft-grid",
  },
  {
    id: "interface-layouts",
    libraryId: "figcraft",
    title: "Interface layouts",
    description: "Interface composition and prototyping.",
    webosPackageId: "craft-fig",
  },
];

/** Canonical product catalog for desktop, Bun packages, and browser OS surfaces. */
export function allAppCapabilities(): AppCapability[] {
  return capabilities.map((entry) => ({ ...entry }));
}

/** Presentation and application IDs have one owner; source pins remain in the config. */
export function capabilityFor(libraryId: string): {
  title: string;
  description: string;
} {
  const capability = capabilities.find(
    (entry) => entry.libraryId === libraryId,
  );
  if (capability)
    return { title: capability.title, description: capability.description };
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
  const entry = capabilities.find((capability) => capability.id === appId);
  return entry ? { ...entry } : undefined;
}

export function appCapabilityForLibrary(
  libraryId: string,
): AppCapability | undefined {
  const capability = capabilities.find(
    (entry) => entry.libraryId === libraryId,
  );
  return capability ? { ...capability } : undefined;
}

export function appCapabilities(
  config: Pick<Config, "modules" | "priorities">,
): AppCapability[] {
  const engines = new Set(
    config.modules
      .filter((module) => module.role === "engine")
      .map((module) => module.id),
  );
  for (const id of engines) {
    if (!capabilities.some((entry) => entry.libraryId === id))
      throw new Error(`Application capability missing: ${id}`);
  }
  const selected = capabilities.filter((entry) => engines.has(entry.libraryId));
  const priorities = config.priorities ?? [];
  return selected
    .map((entry) => ({ ...entry }))
    .sort(
      (a, b) =>
        Number(priorities.includes(b.libraryId)) -
        Number(priorities.includes(a.libraryId)),
    );
}

export function appHostname(
  capabilityId: string,
  config: Pick<Config, "modules" | "priorities" | "deployment">,
): string {
  if (!appCapabilities(config).some((entry) => entry.id === capabilityId))
    throw new Error(`Unknown application: ${capabilityId}`);
  if (!config.deployment)
    throw new Error("Application deployment settings are required.");
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
