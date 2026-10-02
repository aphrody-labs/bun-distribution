// SPDX-License-Identifier: Apache-2.0
// Training: Shenron embedding / reranker candidates trained through aphrody-command's
// `train_candidate` (Python aphrody-train), with live state from the `studio://train` event.
import { useEffect, useState } from "react";
import { Button, Card } from "@aphrody/m3-primitives";
import { PageHeader } from "@shenron/ui/layout/PageHeader";
import { isTauri } from "../../tauri-bridge";
import { shenron, training, type ShenronTraining, type TrainEvent, type TrainKind } from "../../studio-bridge";

const buttonClass = "min-h-12 px-5 text-[18px]";
const fieldClass = "min-h-12 rounded-xl border border-outline bg-surface-container px-4 text-[18px]";

export function TrainingStudio() {
  const [env, setEnv] = useState<ShenronTraining | null>(null);
  const [kind, setKind] = useState<TrainKind>("embed");
  const [steps, setSteps] = useState(10);
  const [allowCpu, setAllowCpu] = useState(false);
  const [baseModel, setBaseModel] = useState("");
  const [events, setEvents] = useState<TrainEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    shenron.training().then(setEnv, (cause: unknown) => setError(String(cause)));
    let unlisten: (() => void) | undefined;
    void training.onEvent((event) => setEvents((current) => [event, ...current].slice(0, 20))).then((stop) => {
      unlisten = stop;
    });
    return () => unlisten?.();
  }, []);

  if (!isTauri()) {
    return <p className="text-[18px] text-on-surface-variant">L’entraînement nécessite l’application Aphrody.</p>;
  }

  const running = events[0]?.state === "started";

  const start = async () => {
    setError(null);
    try {
      await training.start(kind, steps, allowCpu, baseModel.trim() || undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Shenron" title="Entraînement" subtitle="Candidats embeddings et reranker sur les triplets dbfr" />
      {env ? (
        <Card className="flex flex-col gap-2 p-6 text-[18px]">
          <p>GPU détectés : {env.gpu_count}</p>
          <p>Candidats : {env.candidate_root}</p>
          <p>Projet Python : {env.python_project ?? "introuvable"}</p>
          <p className="text-on-surface-variant">{env.rag_promotion}</p>
        </Card>
      ) : null}
      <Card className="flex flex-col gap-4 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <select aria-label="Type de modèle" className={fieldClass} value={kind} onChange={(event) => setKind(event.target.value as TrainKind)}>
            <option value="embed">Embeddings</option>
            <option value="rerank">Reranker</option>
          </select>
          <label className="flex items-center gap-2 text-[18px]">
            Pas
            <input
              type="number"
              min={1}
              className={`${fieldClass} w-28`}
              value={steps}
              onChange={(event) => setSteps(Math.max(1, Number(event.target.value) || 1))}
            />
          </label>
          <label className="flex items-center gap-2 text-[18px]">
            <input type="checkbox" className="size-6" checked={allowCpu} onChange={(event) => setAllowCpu(event.target.checked)} />
            Autoriser le CPU
          </label>
        </div>
        <input
          aria-label="Modèle de base"
          className={fieldClass}
          placeholder={kind === "embed" ? "intfloat/multilingual-e5-small" : "BAAI/bge-reranker-base"}
          value={baseModel}
          onChange={(event) => setBaseModel(event.target.value)}
        />
        <Button className={buttonClass} disabled={running} onClick={() => void start()}>
          {running ? "Entraînement en cours…" : "Lancer l’entraînement"}
        </Button>
        {error ? (
          <p role="alert" className="text-[18px] text-error">
            {error}
          </p>
        ) : null}
      </Card>
      {events.length > 0 ? (
        <ol className="flex flex-col gap-2">
          {events.map((event, index) => (
            <li key={index} className="rounded-xl bg-surface-container p-3 text-[16px]">
              {event.state === "started"
                ? `Démarré : ${event.kind}, ${event.steps} pas, ${event.baseModel}`
                : event.state === "finished"
                  ? `Terminé : ${event.kind} → ${event.output}`
                  : `Échec : ${event.kind} — ${event.error}`}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
