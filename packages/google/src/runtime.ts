export type GoogleProject = "aphrody" | "rgfr";

export interface GoogleRuntime {
  project: GoogleProject;
  location: string;
  home: string;
  auth: string;
}

/** Resolve public configuration through the canonical Bun builtin. */
export { googleRuntime } from "bun:google";
