export interface Library {
  id: string;
  title: string;
  description: string;
  license: string;
  initialized: boolean;
  inspectable: boolean;
  inspectReason?: string;
  priority?: boolean;
}

export interface Inspection {
  id: string;
  libraryId: string;
  state: "running" | "completed" | "failed";
  startedAt: string;
  exitCode?: number;
}

export interface Catalog {
  libraries: Library[];
  runtime: { version: string; repository: string };
  inspections: Inspection[];
  session?: string;
  video?: { nativeAvailable: boolean };
}

const capabilities: Record<string, [string, string]> = {
  artcraft: ["Generation", "Generation and creative processing."],
  photocraft: ["Images", "Image editing and processing."],
  lightcraft: ["Photo processing", "Non-destructive photo processing."],
  vectorcraft: ["Vectors", "Vector drawing and geometry."],
  designcraft: ["Layout", "Page composition and layout."],
  figcraft: ["Interface layouts", "Interface composition and prototyping."],
  filmcraft: ["Video", "Video editing and timeline processing."],
  effectcraft: ["Compositing", "Motion graphics and compositing."],
  soundcraft: ["Audio", "Audio editing and processing."],
  pdfcraft: ["PDF", "PDF reading and processing."],
  wordcraft: ["Documents", "Document editing and processing."],
  deckcraft: ["Slides", "Presentation composition."],
  gridcraft: ["Tables", "Spreadsheet processing."],
  cadcraft: ["CAD", "Drafting and technical geometry."],
  "craft-libs": ["Shared libraries", "Shared Rust processing libraries."],
  "craft-fonts": ["Fonts", "Font resources for native processing."],
};

export function capabilityFor(id: string): { title: string; description: string } {
  const [title, description] = capabilities[id] ?? ["Library", "Native processing library."];
  return { title, description };
}
