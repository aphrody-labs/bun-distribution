// SPDX-License-Identifier: Apache-2.0
// Studio: the Shenron × Koharu workspace of the desktop app (docs/plans/ui/aphrody-app-studio.md).
// Each section calls an existing native owner through typed Studio commands.
import { useState } from "react";
import { MangaStudio } from "./MangaStudio";
import { ShenronStudio } from "./ShenronStudio";
import { AdminStudio } from "./AdminStudio";
import { TrainingStudio } from "./TrainingStudio";
import { DatabooksStudio } from "./DatabooksStudio";
import { DriveStudio } from "./DriveStudio";
import { A2AStudio } from "./A2AStudio";

export type StudioSection =
  | "shenron"
  | "manga"
  | "admin"
  | "training"
  | "databooks"
  | "drive"
  | "a2a";

export const studioSections: Array<{ id: StudioSection; label: string; icon: string }> = [
  { id: "shenron", label: "Shenron", icon: "monitoring" },
  { id: "a2a", label: "Outils des agents", icon: "hub" },
  { id: "manga", label: "Manga & traduction", icon: "translate" },
  { id: "admin", label: "Administration Shenron", icon: "admin_panel_settings" },
  { id: "training", label: "Entraînement", icon: "model_training" },
  { id: "databooks", label: "Databooks", icon: "menu_book" },
  { id: "drive", label: "Drive dbfr", icon: "cloud_sync" },
];

export function StudioRoute() {
  const [section, setSection] = useState<StudioSection>("shenron");

  return (
    <div className="flex h-full flex-col gap-6 overflow-auto p-6">
      <header className="flex flex-col gap-4">
        <h1 className="text-headline-medium">Studio</h1>
        <div role="tablist" aria-label="Sections du studio" className="flex flex-wrap gap-2">
          {studioSections.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={section === entry.id}
              onClick={() => setSection(entry.id)}
              className={
                section === entry.id
                  ? "flex min-h-12 items-center gap-2 rounded-full bg-secondary-container px-4 text-[18px] font-semibold text-on-secondary-container"
                  : "flex min-h-12 items-center gap-2 rounded-full px-4 text-[18px] text-on-surface-variant hover:bg-secondary-container/20"
              }
            >
              <span className="material-symbol text-title-medium" aria-hidden="true">
                {entry.icon}
              </span>
              {entry.label}
            </button>
          ))}
        </div>
      </header>

      <section
        role="tabpanel"
        aria-label={studioSections.find((entry) => entry.id === section)?.label}
      >
        {section === "shenron" ? (
          <ShenronStudio />
        ) : section === "a2a" ? (
          <A2AStudio />
        ) : section === "databooks" ? (
          <DatabooksStudio />
        ) : section === "training" ? (
          <TrainingStudio />
        ) : section === "admin" ? (
          <AdminStudio />
        ) : section === "manga" ? (
          <MangaStudio />
        ) : (
          <DriveStudio />
        )}
      </section>
    </div>
  );
}
