// SPDX-License-Identifier: Apache-2.0
// Shenron studio: health, RAG corpus and training environment rendered natively with @shenron/ui
// layout components over the typed Studio commands (logic owned by aphrody-command::shenron_cmd).
import { useCallback, useEffect, useState } from "react";
import { Button, Card } from "@aphrody/m3-primitives";
import { StudioHeader } from "./StudioHeader";
import { SectionHeading } from "@shenron/ui/layout/SectionHeading";
import { isTauri } from "../../tauri-bridge";
import {
  shenron,
  type ShenronHealth,
  type ShenronProbe,
  type ShenronRagHit,
  type ShenronRagStats,
  type ShenronTraining,
} from "../../studio-bridge";

const buttonClass = "min-h-12 px-5 text-[18px]";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={
        ok
          ? "rounded-full bg-primary-container px-3 py-1 text-[16px] text-on-primary-container"
          : "rounded-full bg-error-container px-3 py-1 text-[16px] text-on-error-container"
      }
    >
      {label}
    </span>
  );
}

function ProbeRow({ name, probe }: { name: string; probe: ShenronProbe }) {
  const ok = probe.reachable === true;
  return (
    <li className="flex items-center justify-between gap-3 rounded-xl bg-surface-container p-3 text-[18px]">
      <span>{name}</span>
      <StatusPill
        ok={ok}
        label={probe.configured === false ? "non configuré" : ok ? "joignable" : "injoignable"}
      />
    </li>
  );
}

export function ShenronStudio() {
  const [health, setHealth] = useState<ShenronHealth | null>(null);
  const [stats, setStats] = useState<ShenronRagStats | null>(null);
  const [training, setTraining] = useState<ShenronTraining | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ShenronRagHit[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const capture = useCallback(
    async <T,>(key: string, task: () => Promise<T>, apply: (value: T) => void) => {
      try {
        apply(await task());
        setErrors((current) => {
          const { [key]: _removed, ...rest } = current;
          return rest;
        });
      } catch (cause) {
        setErrors((current) => ({ ...current, [key]: message(cause) }));
      }
    },
    [],
  );

  const refresh = useCallback(async () => {
    setBusy(true);
    await Promise.all([
      capture("health", shenron.health, setHealth),
      capture("stats", shenron.ragStats, setStats),
      capture("training", shenron.training, setTraining),
    ]);
    setBusy(false);
  }, [capture]);

  useEffect(() => {
    if (isTauri()) void refresh();
  }, [refresh]);

  if (!isTauri()) {
    return (
      <p className="text-[18px] text-on-surface-variant">
        Shenron nécessite l’application Aphrody.
      </p>
    );
  }

  const search = async () => {
    setBusy(true);
    await capture(
      "search",
      () => shenron.ragSearch(query.trim(), 10),
      (response) => setHits(response.results),
    );
    setBusy(false);
  };

  return (
    <div className="flex flex-col gap-8">
      <StudioHeader
        eyebrow="Shenron"
        title="Pilotage"
        subtitle={
          health ? (health.status === "operational" ? "Opérationnel" : "Dégradé") : "Chargement…"
        }
      />

      <section className="flex flex-col gap-4">
        <SectionHeading
          level={2}
          title="Santé"
          actions={
            <Button
              className={buttonClass}
              variant="tonal"
              disabled={busy}
              onClick={() => void refresh()}
            >
              Actualiser
            </Button>
          }
        />
        {errors.health ? (
          <p role="alert" className="text-[18px] text-error">
            {errors.health}
          </p>
        ) : null}
        {health ? (
          <ul className="grid gap-3 md:grid-cols-2">
            <ProbeRow name="Site" probe={health.site} />
            <ProbeRow name="Bot" probe={health.bot} />
            <ProbeRow name="IA Aphrody" probe={health.aphrody_ai_http} />
            <li className="flex items-center justify-between gap-3 rounded-xl bg-surface-container p-3 text-[18px]">
              <span>Agent Home dbfr</span>
              <StatusPill
                ok={health.agent_home.valid}
                label={
                  health.agent_home.valid ? `${health.agent_home.files ?? 0} fichiers` : "invalide"
                }
              />
            </li>
          </ul>
        ) : null}
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading
          level={2}
          title="Corpus RAG"
          standfirst={health ? `Moteur : ${health.rag_backend}` : undefined}
        />
        {errors.stats ? (
          <p role="alert" className="text-[18px] text-error">
            {errors.stats}
          </p>
        ) : null}
        {stats ? (
          <Card className="flex flex-col gap-3 p-6 text-[18px]">
            <p>
              {stats.chunks} passages · {stats.vectors} vecteurs
            </p>
            {stats.sources?.length ? (
              <ul className="grid gap-2 md:grid-cols-2">
                {stats.sources.map((source) => (
                  <li
                    key={`${source.kind}:${source.sourceId}`}
                    className="rounded-xl bg-surface-container p-3"
                  >
                    [{source.kind}] {source.sourceId} : {source.count}
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        ) : null}
        <form
          className="flex gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void search();
          }}
        >
          <input
            aria-label="Recherche dans le corpus Shenron"
            className="min-h-12 flex-1 rounded-xl border border-outline bg-surface-container px-4 text-[18px]"
            placeholder="Rechercher (ex. Goku Super Saiyan)"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button className={buttonClass} type="submit" disabled={busy || query.trim().length < 2}>
            Rechercher
          </Button>
        </form>
        {errors.search ? (
          <p role="alert" className="text-[18px] text-error">
            {errors.search}
          </p>
        ) : null}
        <ol className="flex flex-col gap-3">
          {hits.map((hit, index) => (
            <li
              key={`${hit.url ?? hit.title}-${index}`}
              className="rounded-xl bg-surface-container p-4"
            >
              <p className="text-[18px] font-semibold">
                [{hit.kind ?? "document"}] {hit.title ?? "Sans titre"}
              </p>
              {hit.snippet ? (
                <p className="mt-1 text-[16px] text-on-surface-variant">{hit.snippet}</p>
              ) : null}
              {hit.url ? (
                <p className="mt-1 text-[14px] text-on-surface-variant">{hit.url}</p>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading level={2} title="Entraînement" />
        {errors.training ? (
          <p role="alert" className="text-[18px] text-error">
            {errors.training}
          </p>
        ) : null}
        {training ? (
          <Card className="flex flex-col gap-2 p-6 text-[18px]">
            <p>GPU détectés : {training.gpu_count}</p>
            <p>Candidats : {training.candidate_root}</p>
            <p>Projet Python : {training.python_project ?? "introuvable"}</p>
            <p className="text-on-surface-variant">{training.rag_promotion}</p>
          </Card>
        ) : null}
      </section>
    </div>
  );
}
