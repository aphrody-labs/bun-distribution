// SPDX-License-Identifier: Apache-2.0
export const studioSections = [
  { id: "a2a", label: "Outils des agents", icon: "hub" },
  { id: "drive", label: "Drive", icon: "cloud_sync" },
] as const;
export type StudioSection = (typeof studioSections)[number]["id"];
export function studioSection(value: string | null): StudioSection {
  return studioSections.find((entry) => entry.id === value)?.id ?? "a2a";
}
export function studioPath(section: StudioSection): string {
  return "/studio?section=" + section;
}
