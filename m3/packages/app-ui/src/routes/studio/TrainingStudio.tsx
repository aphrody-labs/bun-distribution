// SPDX-License-Identifier: Apache-2.0
// Read-only native training environment and events. The existing start owner still invokes
// the Python training process, so this UI does not expose that launch path.
import { useEffect, useState } from "react";
import { Button, Card } from "@aphrody/m3-primitives";
import { isTauri } from "../../tauri-bridge";
import { shenron, training, type ShenronTraining, type TrainEvent } from "../../studio-bridge";

export interface TrainingStudioBackend {
  isDesktop(): boolean;
  environment(): Promise<ShenronTraining>;
  subscribe(handler: (event: TrainEvent) => void): Promise<() => void | Promise<void>>;
}
const backend: TrainingStudioBackend = {
  isDesktop: isTauri,
  environment: shenron.training,
  subscribe: training.onEvent,
};

function unsubscribe(stop: () => void | Promise<void>) {
  try {
    void Promise.resolve(stop()).catch((error: unknown) => {
      console.warn("Training event cleanup failed", error);
    });
  } catch (error) {
    console.warn("Training event cleanup failed", error);
  }
}
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function TrainingStudio({ services = backend }: { services?: TrainingStudioBackend } = {}) {
  const desktop = services.isDesktop();
  const [env, setEnv] = useState<ShenronTraining | null>(null);
  const [loading, setLoading] = useState(desktop);
  const [listening, setListening] = useState(false);
  const [environmentError, setEnvironmentError] = useState<string | null>(null);
  const [eventError, setEventError] = useState<string | null>(null);
  const [events, setEvents] = useState<TrainEvent[]>([]);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!desktop) return;
    let active = true;
    let stop: (() => void | Promise<void>) | undefined;
    setLoading(true);
    setListening(false);
    setEnvironmentError(null);
    setEventError(null);
    setEnv(null);
    void services
      .environment()
      .then((report) => {
        if (active) setEnv(report);
        return null;
      })
      .catch((error: unknown) => {
        if (active) setEnvironmentError(message(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    void services
      .subscribe((event) => {
        if (active) setEvents((current) => [event, ...current].slice(0, 20));
      })
      .then((unlisten) => {
        if (active) {
          stop = unlisten;
          setListening(true);
        } else unsubscribe(unlisten);
        return null;
      })
      .catch((error: unknown) => {
        if (active) setEventError(message(error));
      });
    return () => {
      active = false;
      if (stop) unsubscribe(stop);
    };
  }, [services, desktop, reload]);

  if (!desktop) {
    return (
      <p className="text-body-large text-on-surface-variant">
        L'état de l'entraînement est disponible dans l'application Aphrody.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-2">
        <p className="text-label-large font-medium text-primary">Shenron</p>
        <h1 className="text-headline-large font-semibold text-on-surface">Entraînement</h1>
        <p className="text-body-large text-on-surface-variant">
          Environnement et événements des candidats embeddings et reranker
        </p>
      </header>
      <Card className="flex flex-col gap-3 p-6 text-body-large">
        <h2 className="text-title-large font-medium">Environnement</h2>
        {loading && <p role="status">Lecture de l'environnement d'entraînement…</p>}
        {env && (
          <>
            <p>GPU détectés : {env.gpu_count}</p>
            <p>Candidats : {env.candidate_root}</p>
            <p>Projet d'entraînement : {env.python_project ?? "introuvable"}</p>
            <p className="text-on-surface-variant">{env.rag_promotion}</p>
          </>
        )}
        {environmentError && (
          <p role="alert" className="text-error">
            Environnement indisponible : {environmentError}
          </p>
        )}
      </Card>
      <Card className="flex flex-col gap-3 p-6 text-body-large">
        <h2 className="text-title-large font-medium">Événements reçus</h2>
        {eventError ? (
          <p role="alert" className="text-error">
            Flux d'événements indisponible : {eventError}
          </p>
        ) : !listening ? (
          <p role="status">Connexion aux événements d'entraînement…</p>
        ) : events.length === 0 ? (
          <p className="text-on-surface-variant">
            Aucun événement reçu depuis l'ouverture de cette vue.
          </p>
        ) : null}
        {events.length > 0 && (
          <ol className="flex flex-col gap-2">
            {events.map((event, index) => (
              <li key={index} className="rounded-medium bg-surface-container-high p-3">
                {event.state === "started"
                  ? `Démarré : ${event.kind}, ${event.steps} pas, ${event.baseModel}`
                  : event.state === "finished"
                    ? `Terminé : ${event.kind} → ${event.output}`
                    : `Échec : ${event.kind} — ${event.error}`}
              </li>
            ))}
          </ol>
        )}
      </Card>
      {(environmentError || eventError) && (
        <Button
          variant="tonal"
          className="self-start"
          onClick={() => setReload((value) => value + 1)}
        >
          Réessayer
        </Button>
      )}
    </div>
  );
}
