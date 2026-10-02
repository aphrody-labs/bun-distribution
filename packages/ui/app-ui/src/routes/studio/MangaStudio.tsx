// SPDX-License-Identifier: Apache-2.0
// Manga studio: Koharu projects, page import, OCR/translation/inpainting pipeline and export,
// all through the in-process Koharu service (no second engine in the app).
import { useCallback, useEffect, useState } from "react";
import { Button, Card, toast } from "@aphrody/m3-primitives";
import { isTauri, saveFileDialog } from "../../tauri-bridge";
import {
  koharu,
  type KoharuOperation,
  type KoharuPageSummary,
  type KoharuProjectInfo,
  type KoharuProjectSummary,
  type KoharuStage,
} from "../../studio-bridge";

const STAGES: Array<{ id: KoharuStage; label: string }> = [
  { id: "detection", label: "Détection" },
  { id: "ocr", label: "OCR" },
  { id: "translation", label: "Traduction" },
  { id: "inpainting", label: "Nettoyage" },
];

const buttonClass = "min-h-12 px-5 text-[18px]";
const fieldClass =
  "min-h-12 w-full rounded-xl border border-outline bg-surface-container px-4 text-[18px] text-on-surface";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function pickImages(): Promise<string[]> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const result = await open({
    title: "Importer des planches",
    multiple: true,
    directory: false,
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "avif"] }],
  });
  if (Array.isArray(result)) return result;
  return typeof result === "string" ? [result] : [];
}

export function MangaStudio() {
  const [projects, setProjects] = useState<KoharuProjectSummary[]>([]);
  const [project, setProject] = useState<KoharuProjectInfo | null>(null);
  const [pages, setPages] = useState<KoharuPageSummary[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (label: string, task: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await task();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(null);
    }
  }, []);

  const refreshPages = useCallback(async () => setPages(await koharu.pages()), []);

  useEffect(() => {
    if (!isTauri()) return;
    void run("Chargement", async () => setProjects(await koharu.listProjects()));
  }, [run]);

  if (!isTauri()) {
    return <p className="text-[18px] text-on-surface-variant">Le studio manga nécessite l’application Aphrody.</p>;
  }

  const open = (name: string) =>
    run("Ouverture", async () => {
      if (project) await koharu.closeProject();
      setProject(await koharu.openProject(name));
      setSelected([]);
      await refreshPages();
    });

  const create = () =>
    run("Création", async () => {
      const name = newName.trim();
      if (!name) throw new Error("Nom de projet requis.");
      if (project) await koharu.closeProject();
      setProject(await koharu.createProject(name));
      setProjects(await koharu.listProjects());
      setNewName("");
      setPages([]);
    });

  const importPages = () =>
    run("Import", async () => {
      const paths = await pickImages();
      if (paths.length === 0) return;
      await koharu.importPaths(paths);
      await refreshPages();
    });

  const process = (operation: KoharuOperation, label: string) =>
    run(label, async () => {
      const report = await koharu.runPipeline(operation, selected);
      toast.success(`${label} : ${report.completed}/${report.total} en ${Math.round(report.elapsedMs / 1000)} s`);
      setProject(report.project);
      await refreshPages();
    });

  const exportPage = (page: KoharuPageSummary, format: "png" | "psd") =>
    run("Export", async () => {
      const path = await saveFileDialog({
        title: `Exporter ${page.label}`,
        defaultPath: `${page.label}.${format}`,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });
      if (!path) return;
      const result = format === "png" ? await koharu.exportPng(page.id, path) : await koharu.exportPsd(page.id, path);
      toast.success(`Exporté : ${result.path}`);
    });

  const toggle = (id: string) =>
    setSelected((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <p role="alert" className="rounded-xl border border-error p-4 text-[18px] text-error">
          {error}
        </p>
      ) : null}
      {busy ? <p className="text-[18px] text-on-surface-variant">{busy}…</p> : null}

      <Card className="flex flex-col gap-4 p-6">
        <h2 className="text-title-large">Projets Koharu</h2>
        <div className="flex flex-wrap gap-3">
          {projects.map((entry) => (
            <Button
              key={entry.name}
              className={buttonClass}
              variant={project?.name === entry.name ? "filled" : "tonal"}
              disabled={busy !== null}
              onClick={() => open(entry.name)}
            >
              {entry.name}
            </Button>
          ))}
          {projects.length === 0 ? <span className="text-[18px] text-on-surface-variant">Aucun projet.</span> : null}
        </div>
        <div className="flex gap-3">
          <input
            aria-label="Nom du nouveau projet"
            className={fieldClass}
            value={newName}
            placeholder="Nouveau projet (ex. dragon-ball-t01)"
            onChange={(event) => setNewName(event.target.value)}
          />
          <Button className={buttonClass} disabled={busy !== null} onClick={create}>
            Créer
          </Button>
        </div>
      </Card>

      {project ? (
        <Card className="flex flex-col gap-4 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-title-large">{project.name}</h2>
            <Button className={buttonClass} disabled={busy !== null} onClick={importPages}>
              Importer des planches
            </Button>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button className={buttonClass} disabled={busy !== null || pages.length === 0} onClick={() => process({ operation: "full" }, "Pipeline complet")}>
              Pipeline complet
            </Button>
            {STAGES.map((stage) => (
              <Button
                key={stage.id}
                className={buttonClass}
                variant="tonal"
                disabled={busy !== null || pages.length === 0}
                onClick={() => process({ operation: "only", stage: stage.id }, stage.label)}
              >
                {stage.label}
              </Button>
            ))}
          </div>
          <p className="text-[16px] text-on-surface-variant">
            {selected.length > 0 ? `${selected.length} planche(s) sélectionnée(s)` : "Sans sélection, le traitement porte sur tout le projet."}
          </p>
          <ul className="flex flex-col gap-2">
            {pages.map((page) => (
              <li key={page.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-container p-3">
                <input
                  type="checkbox"
                  aria-label={`Sélectionner ${page.label}`}
                  className="size-6"
                  checked={selected.includes(page.id)}
                  onChange={() => toggle(page.id)}
                />
                <span className="flex-1 text-[18px]">
                  {page.label} · {Math.round(page.size.width)}×{Math.round(page.size.height)} · {page.layer_count} calque(s)
                </span>
                <Button className={buttonClass} variant="tonal" disabled={busy !== null} onClick={() => exportPage(page, "png")}>
                  PNG
                </Button>
                <Button className={buttonClass} variant="tonal" disabled={busy !== null} onClick={() => exportPage(page, "psd")}>
                  PSD
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
