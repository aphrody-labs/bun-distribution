// SPDX-License-Identifier: Apache-2.0
import { studioSection, studioSections } from "../../routes/studio/navigation";

const titles: Record<string, string> = {
  "/": "Chat",
  "/chat": "Chat",
  "/codex": "Chat",
  "/explorer": "Fichiers",
  "/models": "Modèles & IA",
  "/settings": "Paramètres",
  "/favorites": "Favoris",
  "/recents": "Récents",
  "/file-kinds": "Types de fichiers",
  "/sources": "Sources",
  "/sources/adapters": "Adaptateurs",
  "/search": "Recherche",
  "/daemon": "Démon",
  "/jobs": "Tâches",
  "/redundancy": "Redondance",
  "/redundancy/at-risk": "Fichiers à risque",
  "/redundancy/compare": "Comparer les volumes",
};

/** Null preserves titles supplied by a loaded source detail. */
export function deriveTitleFromPath(pathname: string, search: string): string | null {
  const params = new URLSearchParams(search);
  if (pathname === "/studio") {
    const section = studioSection(params.get("section"));
    return studioSections.find((entry) => entry.id === section)?.label ?? "Studio";
  }
  if (pathname === "/explorer" && search) {
    if (params.get("view") === "device") return "Cet appareil";
    const path = params.get("path");
    if (path) {
      try {
        const value: unknown = JSON.parse(path);
        if (value && typeof value === "object" && "Physical" in value) {
          const physical = value.Physical;
          if (
            physical &&
            typeof physical === "object" &&
            "path" in physical &&
            typeof physical.path === "string"
          )
            return physical.path.split(/[\\/]/).filter(Boolean).at(-1) ?? "Fichiers";
        }
      } catch {
        /* A malformed legacy URL keeps the generic title. */
      }
    }
    return "Fichiers";
  }
  if (titles[pathname]) return titles[pathname];
  if (pathname.startsWith("/tag/")) return `Tag : ${pathname.split("/")[2]?.slice(0, 8) ?? ""}`;
  if (pathname.startsWith("/file-kinds/"))
    return `Fichiers : ${pathname.slice(12).replaceAll("_", " ")}`;
  if (pathname.startsWith("/sources/")) return null;
  return "Aphrody";
}
