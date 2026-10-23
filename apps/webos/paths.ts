// SPDX-License-Identifier: Apache-2.0
// Search metadata for the public paths of https://aphrody.com that boot the desktop shell. The Worker
// rewrites the shell's <head> with these values (title, description, canonical, Open Graph, Twitter) and
// seo.ts lists them in sitemap.xml. Old product hosts 301 to these paths (infra/config/routes.catalog.json),
// so each page has exactly one canonical address.
export const ORIGIN = "https://aphrody.com";
export const SITE = "Aphrody Bun OS";

export interface PathMeta {
  title: string;
  description: string;
}

const craft = (name: string, what: string): PathMeta => ({
  title: `${name} in your browser · ${SITE}`,
  description: `${what} Installs from the Bun OS App Store, runs in your browser and keeps working offline.`,
});

export const PATHS: Record<string, PathMeta> = {
  "/": {
    title: "Aphrody Bun OS: a tiling desktop in your browser",
    description:
      "A tiling desktop that runs in your browser: windows and workspaces, files, terminal, browser, games and creative apps that install and work offline.",
  },
  "/os": {
    title: `The desktop · ${SITE}`,
    description:
      "Open the Bun OS desktop: ten workspaces, tiled or floating windows, a search-first launcher and keyboard shortcuts after Omarchy and Hyprland.",
  },
  "/creator": {
    title: `Creator studio · ${SITE}`,
    description:
      "Creative apps and projects in one workspace: video, images, vectors, audio, documents and slides, saved to your Aphrody Drive.",
  },
  "/apps": {
    title: `App Store · ${SITE}`,
    description:
      "Install games and creative apps into your browser. Every download is SHA-256 verified and runs offline after the first launch.",
  },
  "/art": {
    title: `Aphrody Creative · ${SITE}`,
    description:
      "Creative apps, projects and shared Drive files: generate, edit and organise your work in the browser.",
  },
  "/film": craft(
    "Video editing",
    "Cut, arrange and export video on a timeline.",
  ),
  "/photo": craft(
    "Image editing",
    "Edit photos and images with layers and filters.",
  ),
  "/vector": craft(
    "Vector drawing",
    "Draw logos, icons and illustrations as vectors.",
  ),
  "/effect": craft("Compositing", "Combine footage, titles and effects."),
  "/light": craft("Photo processing", "Develop and grade photos in batches."),
  "/pdf": craft("PDF tools", "Read, annotate, merge and sign PDF files."),
  "/word": craft("Documents", "Write and format documents."),
  "/sound": craft("Audio editing", "Record, edit and mix audio."),
  "/design": craft("Page layout", "Lay out posters, flyers and pages."),
  "/cad": craft("CAD", "Model parts and drawings in 2D and 3D."),
  "/deck": craft("Slides", "Build and present slide decks."),
  "/grid": craft("Spreadsheets", "Work with tables, formulas and charts."),
  "/fig": craft("Interface design", "Design app and web interfaces."),
};

/** Normalised lookup: "/pdf/" and "/pdf" share one entry. */
export function pathMeta(pathname: string): PathMeta | undefined {
  const key = pathname === "/" ? "/" : pathname.replace(/\/+$/, "");
  return PATHS[key];
}
