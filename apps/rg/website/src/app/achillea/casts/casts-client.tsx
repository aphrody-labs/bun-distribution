"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createAchilleaClient } from "@/lib/achillea";
import { CastCard } from "@/components/achillea/CastCard";
import type { CasterPublic } from "@rosegriffon/achillea-types/domain/cast";
import { Tv, ArrowLeft, Loader2 } from "lucide-react";
import { FaTwitch } from "react-icons/fa6";
import { signalerException } from "@/lib/achillea/signaler";

export default function CastsPublicPage() {
  const [casters, setCasters] = useState<CasterPublic[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const client = createAchilleaClient();

    client.casts
      .listCasters()
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setCasters(res.value);
        } else {
          setLoadError(
            "La liste des casters est temporairement indisponible. Réessaie dans quelques instants.",
          );
          signalerException("casts", new Error(`${res.kind}: ${res.detail}`));
        }
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setLoadError(
          "La liste des casters est temporairement indisponible. Réessaie dans quelques instants.",
        );
        signalerException("casts", cause);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
      {/* Breadcrumb */}
      <div className="space-y-1 border-b border-border pb-6">
        <Link
          href="/achillea"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Retour au hub Achilléa
        </Link>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20">
              <Tv className="w-5 h-5" />
            </span>
            <h1 className="text-3xl font-bold tracking-tight">Casters & Régie Officiels</h1>
          </div>

          <a
            href="https://twitch.tv/rosegriffon"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition shadow-sm"
          >
            <FaTwitch className="w-4 h-4" />
            Chaîne Officielle
          </a>
        </div>
        <p className="text-sm text-muted-foreground">
          Découvrez l'équipe de commentateurs et streamers officiels d'Achilléa sur Inazuma Eleven:
          Victory Road.
        </p>
      </div>

      {loading ? (
        <div className="py-20 text-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Chargement des casters...</p>
        </div>
      ) : loadError ? (
        <div
          role="alert"
          className="border border-amber-500/30 bg-amber-500/5 rounded-2xl p-8 text-center space-y-3"
        >
          <p className="text-sm text-muted-foreground">{loadError}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="text-sm font-semibold text-primary underline underline-offset-4"
          >
            Réessayer
          </button>
        </div>
      ) : casters.length === 0 ? (
        <div className="border border-dashed border-border rounded-2xl p-12 text-center text-xs text-muted-foreground">
          Aucun caster répertorié pour le moment.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {casters.map((caster) => (
            <CastCard key={caster.id} caster={caster} />
          ))}
        </div>
      )}
    </div>
  );
}
