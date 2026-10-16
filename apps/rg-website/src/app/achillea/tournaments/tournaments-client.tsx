"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { createAchilleaClient } from "@/lib/achillea";
import { remainingTournamentPages } from "@/lib/achillea/tournament-pagination";
import { TournamentTable } from "@/components/achillea/TournamentTable";
import type { TournamentListItem } from "@rosegriffon/achillea-types/domain/tournament";
import { Trophy, Plus, Search, Layers, Activity, CheckCircle2, Clock } from "lucide-react";
import { signalerException } from "@/lib/achillea/signaler";

const EMPTY_TOURNAMENTS: TournamentListItem[] = [];

export default function TournamentsListPage({
  initialTournaments = EMPTY_TOURNAMENTS,
  initialLoadError = false,
}: {
  initialTournaments?: TournamentListItem[];
  initialLoadError?: boolean;
}) {
  const [tournaments, setTournaments] = useState<TournamentListItem[]>(initialTournaments);
  const [loading, setLoading] = useState<boolean>(initialTournaments.length === 0);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedTab, setSelectedTab] = useState<"all" | "open" | "ongoing" | "finished">("all");
  const [loadError, setLoadError] = useState<string | null>(
    initialLoadError ? "Impossible de charger les tournois pour le moment." : null,
  );

  useEffect(() => {
    let cancelled = false;
    const client = createAchilleaClient();

    client.tournaments
      .list({ page: 1, pageSize: 50 })
      .then(res => {
        if (cancelled) return;
        if (res.ok && res.value) {
          const first = res.value;
          return Promise.all(
            remainingTournamentPages(first.meta).map(page => client.tournaments.list({ page, pageSize: 50 })),
          ).then(pages => {
            if (cancelled) return;
            if (pages.some(page => !page.ok)) {
              setLoadError("La liste complète des tournois est momentanément indisponible.");
              return;
            }
            setTournaments([...first.data, ...pages.flatMap(page => (page.ok ? page.value.data : []))]);
            setLoadError(null);
          });
        } else if (!res.ok) {
          setLoadError("Impossible de charger les tournois pour le moment.");
        }
      })
      .catch(cause => {
        if (!cancelled) setLoadError("Le service des tournois est momentanément indisponible.");
        signalerException("tournaments", cause);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredTournaments = useMemo(() => {
    return tournaments.filter(t => {
      // Tab filtering
      if (selectedTab === "open" && t.status !== "Open") return false;
      if (selectedTab === "ongoing" && t.status !== "Ongoing") return false;
      if (selectedTab === "finished" && t.status !== "Finished") return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = t.name.toLowerCase().includes(q);
        const matchesDescription = t.description.toLowerCase().includes(q);
        if (!matchesName && !matchesDescription) return false;
      }

      return true;
    });
  }, [tournaments, selectedTab, searchQuery]);
  const hasFilters = selectedTab !== "all" || searchQuery.trim().length > 0;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Trophy className="w-5 h-5" />
            </span>
            <h1 className="text-3xl font-bold tracking-tight">Tournois Officiels & Communautaires</h1>
          </div>
          <p className="text-lg text-muted-foreground">
            Participez aux tournois Inazuma Eleven: Victory Road, gagnez des cashprizes en AP et qualifiez-vous pour le
            Circuit Achilléa.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/achillea/tournaments/circuit/ranking"
            className="inline-flex min-h-11 items-center gap-1.5 px-3.5 py-2 text-lg font-semibold rounded-xl border border-border bg-card hover:bg-muted transition focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <Layers className="w-3.5 h-3.5 text-blue-400" />
            Circuit & Classement
          </Link>
          <Link
            href="/achillea/tournaments/create"
            className="inline-flex min-h-11 items-center gap-1.5 px-4 py-2 text-lg font-semibold rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition shadow-sm focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <Plus className="w-4 h-4" />
            Créer un tournoi
          </Link>
        </div>
      </div>

      {/* Filters & Tabs */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        {/* Status tabs */}
        <fieldset
          aria-label="Filtrer les tournois par statut"
          className="m-0 min-w-0 border-0 flex items-center p-1 bg-muted rounded-xl self-start sm:self-auto overflow-x-auto max-w-full"
        >
          <button
            type="button"
            aria-pressed={selectedTab === "all"}
            onClick={() => setSelectedTab("all")}
            className={`min-h-11 shrink-0 px-3.5 py-1.5 text-lg font-semibold rounded-lg transition-all focus-visible:outline focus-visible:outline-4 focus-visible:outline-primary ${
              selectedTab === "all"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Tous ({tournaments.length})
          </button>
          <button
            type="button"
            aria-pressed={selectedTab === "open"}
            onClick={() => setSelectedTab("open")}
            className={`min-h-11 shrink-0 px-3.5 py-1.5 text-lg font-semibold rounded-lg transition-all flex items-center gap-1.5 focus-visible:outline focus-visible:outline-4 focus-visible:outline-primary ${
              selectedTab === "open"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Clock className="w-3 h-3 text-emerald-400" />
            Inscriptions ouvertes
          </button>
          <button
            type="button"
            aria-pressed={selectedTab === "ongoing"}
            onClick={() => setSelectedTab("ongoing")}
            className={`min-h-11 shrink-0 px-3.5 py-1.5 text-lg font-semibold rounded-lg transition-all flex items-center gap-1.5 focus-visible:outline focus-visible:outline-4 focus-visible:outline-primary ${
              selectedTab === "ongoing"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Activity className="w-3 h-3 text-amber-400" />
            En cours
          </button>
          <button
            type="button"
            aria-pressed={selectedTab === "finished"}
            onClick={() => setSelectedTab("finished")}
            className={`min-h-11 shrink-0 px-3.5 py-1.5 text-lg font-semibold rounded-lg transition-all flex items-center gap-1.5 focus-visible:outline focus-visible:outline-4 focus-visible:outline-primary ${
              selectedTab === "finished"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <CheckCircle2 className="w-3 h-3 text-blue-400" />
            Terminés
          </button>
        </fieldset>

        {/* Search bar */}
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            aria-label="Rechercher un tournoi"
            type="text"
            placeholder="Rechercher un tournoi..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="min-h-11 w-full pl-9 pr-3 py-2 text-lg bg-card border border-border rounded-xl placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-primary"
          />
        </div>
      </div>
      <output className="flex flex-wrap items-center gap-3 text-lg text-muted-foreground">
        <span>
          {loading
            ? "Chargement des tournois…"
            : `${filteredTournaments.length} tournoi${filteredTournaments.length > 1 ? "s" : ""} affiché${filteredTournaments.length > 1 ? "s" : ""} sur ${tournaments.length}`}
        </span>
        {hasFilters && (
          <button
            type="button"
            onClick={() => {
              setSelectedTab("all");
              setSearchQuery("");
            }}
            className="min-h-11 rounded-xl border border-border px-4 font-semibold text-foreground focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Effacer les filtres
          </button>
        )}
      </output>

      {/* Tournaments Table */}
      {loadError && !loading ? (
        <div
          role="alert"
          className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center text-lg text-destructive"
        >
          {loadError}
        </div>
      ) : (
        <TournamentTable tournaments={filteredTournaments} loading={loading} />
      )}
    </div>
  );
}
