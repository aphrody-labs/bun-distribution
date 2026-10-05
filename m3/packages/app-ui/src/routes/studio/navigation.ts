// SPDX-License-Identifier: Apache-2.0
export const studioSections = [
  { id: "shenron", label: "Shenron", icon: "monitoring" },
  { id: "a2a", label: "Outils des agents", icon: "hub" },
  { id: "manga", label: "Koharu · Manga & traduction", icon: "translate" },
  { id: "admin", label: "Administration", icon: "admin_panel_settings" },
  { id: "training", label: "Entraînement", icon: "model_training" },
  { id: "databooks", label: "Databooks", icon: "menu_book" },
  { id: "drive", label: "Drive dbfr", icon: "cloud_sync" },
] as const;
export type StudioSection = (typeof studioSections)[number]["id"];
export function studioSection(value: string | null): StudioSection {
  return studioSections.find((entry) => entry.id === value)?.id ?? "shenron";
}
export function studioPath(section: StudioSection): string {
  return "/studio?section=" + section;
}
