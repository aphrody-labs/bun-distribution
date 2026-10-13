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

export { capabilityFor } from "@aphrody/bun-workspace";
