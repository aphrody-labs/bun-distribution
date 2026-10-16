"use client";

import { Button, Skeleton } from "@rosegriffon/ui";
import { ArrowUpDown, Plus, Search, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ClanCard } from "@/components/achillea/ClanCard";
import { listPublicClans, type PublicClan } from "@/lib/achillea/unified-clans";

export default function ClansPage({ initialQuery = "" }: { initialQuery?: string }) {
  const [clans, setClans] = useState<PublicClan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Filtres
  const [query, setQuery] = useState(initialQuery);
  const [onlyRecruiting, setOnlyRecruiting] = useState(false);
  const [sortBy, setSortBy] = useState<"fame" | "name">("fame");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [previousQuery, setPreviousQuery] = useState(initialQuery);
  if (previousQuery !== initialQuery) {
    setPreviousQuery(initialQuery);
    setQuery(initialQuery);
  }

  useEffect(() => {
    let isMounted = true;
    async function fetchClans() {
      setLoading(true);
      try {
        const results = await listPublicClans();
        if (isMounted) setClans(results);
      } catch {
        if (isMounted) setError(true);
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    void fetchClans();
    return () => {
      isMounted = false;
    };
  }, []);

  const filteredClans = useMemo(() => {
    const q = query.trim().toLowerCase();
    return clans
      .filter((c) => {
        if (q && !c.name.toLowerCase().includes(q) && !c.shortName.toLowerCase().includes(q)) {
          return false;
        }
        if (onlyRecruiting && !c.isRecruiting) return false;
        return true;
      })
      .sort((a, b) => {
        const diff = sortBy === "fame" ? a.fame - b.fame : a.name.localeCompare(b.name);
        return sortOrder === "asc" ? diff : -diff;
      });
  }, [clans, query, onlyRecruiting, sortBy, sortOrder]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-outline/15 pb-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Users className="size-6 text-primary" />
            <h1 className="text-2xl sm:text-3xl font-black text-on-surface">Clans Achilléa</h1>
          </div>
          <p className="text-sm text-on-surface-variant">
            Rejoins une équipe compétitive, progresse ensemble et gagne des points de clan.
          </p>
        </div>

        <Button
          asChild
          className="rounded-xl font-bold text-xs gap-1.5 shadow-md self-start md:self-auto"
        >
          <Link href="/achillea/clans/create">
            <Plus className="size-4" />
            Créer mon clan
          </Link>
        </Button>
      </div>

      {/* Filters toolbar */}
      <div className="p-4 rounded-2xl border border-outline/20 bg-surface/80 backdrop-blur-md space-y-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {/* Search input */}
          <div className="relative sm:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-on-surface-variant" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher par nom ou tag (ex. RG, Inazuma)..."
              className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-outline/25 bg-surface-variant/30 text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus:border-primary"
            />
          </div>

          {/* Tri */}
          <div className="flex gap-2">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value === "name" ? "name" : "fame")}
              className="flex-1 px-3 py-2 text-sm rounded-xl border border-outline/25 bg-surface-variant/30 text-on-surface focus:outline-none focus:border-primary"
            >
              <option value="fame">Notoriété</option>
              <option value="name">Nom</option>
            </select>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
              className="shrink-0 rounded-xl"
              title={sortOrder === "asc" ? "Croissant" : "Décroissant"}
            >
              <ArrowUpDown className="size-4" />
            </Button>
          </div>
        </div>

        {/* Checkbox filters */}
        <div className="flex flex-wrap items-center gap-4 pt-1 text-xs text-on-surface-variant">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={onlyRecruiting}
              onChange={(e) => setOnlyRecruiting(e.target.checked)}
              className="rounded text-primary focus:ring-primary size-4"
            />
            <span>Recrutement ouvert uniquement</span>
          </label>

          <span className="ml-auto font-mono text-xs opacity-70">
            {filteredClans.length} clan{filteredClans.length > 1 ? "s" : ""} trouvé
            {filteredClans.length > 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Clans grid */}
      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-36 rounded-2xl w-full" />
          ))}
        </div>
      ) : error ? (
        <div role="alert" className="text-center py-16 border border-outline/30 rounded-3xl p-8">
          <p className="text-lg font-bold text-on-surface">
            L’annuaire des clans est indisponible.
          </p>
          <p className="text-sm text-on-surface-variant">Réessaie dans quelques instants.</p>
        </div>
      ) : filteredClans.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-outline/30 rounded-3xl p-8 space-y-3">
          <Users className="size-12 mx-auto text-on-surface-variant opacity-40" />
          <h3 className="text-lg font-bold text-on-surface">Aucun clan ne correspond</h3>
          <p className="text-sm text-on-surface-variant max-w-sm mx-auto">
            Modifie tes critères de recherche ou sois le premier à fonder ton clan !
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setQuery("");
              setOnlyRecruiting(false);
            }}
          >
            Réinitialiser les filtres
          </Button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredClans.map((clan) => (
            <ClanCard key={clan.id} clan={clan} />
          ))}
        </div>
      )}
    </div>
  );
}
