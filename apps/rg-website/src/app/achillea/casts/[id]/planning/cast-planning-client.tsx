"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAchilleaAuth, createAchilleaClient } from "@/lib/achillea";

import type { CastEventDetail } from "@rosegriffon/achillea-types/domain/cast";
import { Tv, ArrowLeft, Calendar, Loader2, Clock } from "lucide-react";
import { signalerException } from "@/lib/achillea/signaler";

export default function CastPlanningPage({ id }: { id: string }) {
  const eventId = id;
  const { isAuthenticated, login, isLoading: authLoading } = useAchilleaAuth();

  const [detail, setDetail] = useState<CastEventDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(isAuthenticated && !authLoading);
  const [error, setError] = useState<string | null>(null);

  const [requestIdentity1, setRequestIdentity1] = useState<readonly unknown[]>([authLoading, eventId, isAuthenticated]);
  if (
    [authLoading, eventId, isAuthenticated].some((value, position) => !Object.is(value, requestIdentity1[position]))
  ) {
    setRequestIdentity1([authLoading, eventId, isAuthenticated]);
    (() => {
      if (authLoading || !isAuthenticated) {
        setDetail(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
    })();
  }
  useEffect(() => {
    if (authLoading || !isAuthenticated) {
      return;
    }

    let cancelled = false;

    const client = createAchilleaClient({ credentials: "include" });

    client.casts
      .getEvent(eventId)
      .then(res => {
        if (cancelled) return;
        if (res.ok && res.value) {
          setDetail(res.value);
        } else if (!res.ok) {
          setError(
            res.kind === "http" && res.status === 404
              ? "Évènement de cast introuvable."
              : "Impossible de charger le planning. Réessaie dans quelques instants.",
          );
        }
      })
      .catch(cause => {
        if (!cancelled) setError("Une erreur inattendue est survenue lors du chargement.");
        signalerException("casts/[id]/planning", cause);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authLoading, eventId, isAuthenticated]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      {/* Breadcrumb */}
      <div className="space-y-1 border-b border-border pb-6">
        <Link
          href="/achillea/casts"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Retour aux casters
        </Link>
        <div className="flex items-center gap-2">
          <span className="p-2 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20">
            <Tv className="w-5 h-5" />
          </span>
          <h1 className="text-3xl font-bold tracking-tight">Planning de Régie</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Organisation des créneaux de diffusion et répartition des commentateurs.
        </p>
      </div>

      {authLoading ? (
        <div className="py-20 text-center text-sm text-muted-foreground">Vérification de la session…</div>
      ) : !isAuthenticated ? (
        <div className="max-w-md mx-auto py-20 text-center space-y-4">
          <p className="text-sm text-muted-foreground">Connectez-vous pour consulter le planning de régie.</p>
          <button
            type="button"
            onClick={() => login(`/achillea/casts/${encodeURIComponent(eventId)}/planning`)}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary/90 transition shadow-sm text-xs"
          >
            Se connecter
          </button>
        </div>
      ) : loading ? (
        <div className="py-20 text-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Chargement du planning...</p>
        </div>
      ) : error ? (
        <div
          role="alert"
          className="border border-dashed border-border rounded-2xl p-12 text-center text-sm text-muted-foreground"
        >
          {error}
        </div>
      ) : !detail ? (
        <div className="border border-dashed border-border rounded-2xl p-12 text-center text-xs text-muted-foreground">
          Évènement de cast introuvable.
        </div>
      ) : (
        <div className="space-y-6">
          <div className="border border-border bg-card rounded-2xl p-6 space-y-2">
            <h2 className="text-xl font-bold">{detail.event.name}</h2>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" />
                {new Date(detail.event.scheduledAt).toLocaleDateString("fr-FR", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              <span>·</span>
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {detail.event.duration} minutes
              </span>
            </div>
          </div>

          {/* Slots and Attributions */}
          <div className="border border-border bg-card rounded-2xl overflow-hidden">
            <div className="p-4 border-b border-border bg-muted/20">
              <h3 className="font-bold text-xs uppercase text-muted-foreground">Postes attribués</h3>
            </div>

            {detail.attributions.length === 0 ? (
              <div className="py-12 text-center text-xs text-muted-foreground">
                Aucun poste attribué pour le moment.
              </div>
            ) : (
              <div className="divide-y divide-border/60">
                {detail.attributions.map(att => (
                  <div key={att.id} className="p-4 flex items-center justify-between gap-4">
                    <div>
                      <div className="font-semibold text-xs text-foreground">
                        Caster ID: {att.userId || "Non assigné"}
                      </div>
                      <div className="text-[10px] text-muted-foreground">Créneau #{att.slotId}</div>
                    </div>

                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20">
                      Assigné
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
