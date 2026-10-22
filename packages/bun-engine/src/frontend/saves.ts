// Per-profile saves: the save states and screenshots of the in-process RetroArch player live in
// `<home>/profiles/<profile>/{states,screenshots}`. The folders older builds shared between every
// profile (`<home>/states`, `<home>/screenshots`) are never moved or modified: the first time a profile
// plays, its folders start as a copy of them (reflink where the file system has it), so every old save
// stays loadable from every profile and the shared copy stays readable. Battery saves (SRAM) are not
// split: they stay under `<home>/saves`.
import { constants, copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { usrRoot } from "../usr";

export const defaultProfile = "default";

/** The folder name of a profile: its own letters and digits, anything else as `_`. Never empty, never hidden. */
export function profileSlug(name: string | undefined | null): string {
  const slug = (name ?? "").trim().replace(/[^\p{L}\p{N}._-]/gu, "_").replace(/^[._]+/, "").slice(0, 48);
  return slug || defaultProfile;
}

export function retroarchHome(): string {
  return join(usrRoot(), "var", "lib", "bep", "libretroarch");
}

export interface SaveDirs {
  profile: string;
  states: string;
  screenshots: string;
  /** Files copied from the shared folders on this call (0 once the profile has been set up). */
  imported: number;
}

const marker = ".imported-from-shared";

function copyTree(from: string, to: string): number {
  if (!existsSync(from)) return 0;
  let copied = 0;
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.isDirectory()) copied += copyTree(join(from, entry.name), join(to, entry.name));
    else if (entry.isFile() && !existsSync(join(to, entry.name))) {
      copyFileSync(join(from, entry.name), join(to, entry.name), constants.COPYFILE_FICLONE);
      copied++;
    }
  }
  return copied;
}

/** Creates the profile's folders and, on first use, imports a copy of the shared states and screenshots. */
export function prepareProfileSaves(home: string, profile: string): SaveDirs {
  const slug = profileSlug(profile);
  const root = join(home, "profiles", slug);
  const states = join(root, "states");
  const screenshots = join(root, "screenshots");
  mkdirSync(states, { recursive: true });
  mkdirSync(screenshots, { recursive: true });
  let imported = 0;
  if (!existsSync(join(root, marker))) {
    imported = copyTree(join(home, "states"), states) + copyTree(join(home, "screenshots"), screenshots);
    writeFileSync(join(root, marker), `${JSON.stringify({ at: new Date().toISOString(), files: imported })}\n`);
  }
  return { profile: slug, states, screenshots, imported };
}

function filesOf(dir: string, stem: string, states: boolean): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  const walk = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) walk(full);
      else if ((entry.name.startsWith(`${stem}.`) || entry.name.startsWith(`${stem}-`)) && (states ? !entry.name.endsWith(".png") : entry.name.endsWith(".png"))) found.push(full);
    }
  };
  walk(dir);
  return found;
}

export interface SaveSummary {
  profile: string;
  states: number;
  screenshots: number;
  /** The newest state or screenshot, as an ISO time. */
  newest: string | null;
  /** The profile has not played yet: the counts are the shared saves it will start with. */
  shared: boolean;
}

/** What a profile holds for the game whose file name (without extension) is `stem`. */
export function saveSummary(profile: string, stem: string): SaveSummary {
  const slug = profileSlug(profile);
  const home = retroarchHome();
  const root = join(home, "profiles", slug);
  const shared = !existsSync(join(root, marker));
  const states = filesOf(shared ? join(home, "states") : join(root, "states"), stem, true);
  const screenshots = filesOf(shared ? join(home, "screenshots") : join(root, "screenshots"), stem, false);
  const newest = [...states, ...screenshots].reduce((best, file) => Math.max(best, statSync(file).mtimeMs), 0);
  return {
    profile: slug,
    states: states.length,
    screenshots: screenshots.length,
    newest: newest ? new Date(newest).toISOString() : null,
    shared,
  };
}
