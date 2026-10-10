// SPDX-License-Identifier: Apache-2.0
import { studioSection, studioSections } from "../../routes/studio/navigation";

const titles: Record<string, string> = {
  "/": "Aphrody",
  "/docs": "Documentation",
  "/templates": "Templates",
  "/material-3": "Material 3",
  "/showcase": "Material 3",
  "/chat": "Chat",
  "/codex": "Chat",
  "/explorer": "Fichiers",
  "/models": "Modèles & IA",
  "/settings": "Paramètres",
  "/creator": "Créateur",
  "/admin": "Administration",
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
            return physical.path.split(/[\\/]/).findLast(Boolean) ?? "Fichiers";
        }
      } catch {
        /* A malformed legacy URL keeps the generic title. */
      }
    }
    return "Fichiers";
  }
  if (titles[pathname]) return titles[pathname];
  if (pathname.startsWith("/docs/")) return "Documentation";
  if (pathname.startsWith("/templates/")) return "Templates";
  if (pathname.startsWith("/material-3/") || pathname.startsWith("/showcase/")) return "Material 3";
  if (pathname.startsWith("/tag/")) return `Tag : ${pathname.split("/")[2]?.slice(0, 8) ?? ""}`;
  if (pathname.startsWith("/file-kinds/"))
    return `Fichiers : ${pathname.slice(12).replaceAll("_", " ")}`;
  if (pathname.startsWith("/sources/")) return null;
  return "Aphrody";
}

/** Public preview titles preserve homepage SEO after hydration without changing native tabs. */
export function browserDocumentTitle(
  pathname: string,
  title: string | null,
  publicPreview: boolean,
): string {
  const route = pathname.replace(/\/+$/, "") || "/";
  if (publicPreview && (route === "/" || route === "/index.html"))
    return "Aphrody — Search, workspace and native OS";
  if (publicPreview && route === "/os") return "Aphrody OS — Browser workspace";
  if (publicPreview) {
    const context = route
      .slice(1)
      .split("/")
      .map((part) =>
        part
          .split("-")
          .map((word) => word[0]?.toUpperCase() + word.slice(1))
          .join(" "),
      )
      .join(" — ");
    return `${context} — Aphrody`;
  }
  return title ? `${title} — Aphrody OS` : "Aphrody OS";
}
