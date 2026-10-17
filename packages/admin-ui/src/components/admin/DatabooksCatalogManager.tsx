"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Search, Sparkles, RefreshCw, AlertCircle, CheckCircle, ArrowUpDown, ExternalLink, Pencil } from "lucide-react";
import type { ProgressionFiche } from "@/lib/databooks-transcription";
import type { CampagneStats } from "@/lib/databooks-campagne";
import { assetUrl } from "@/lib/assets";

export function DatabooksCatalogManager({
  initialFiches,
  initialCampagne,
}: {
  initialFiches: ProgressionFiche[];
  initialCampagne: CampagneStats;
}) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "in-progress" | "completed" | "empty" | "completed-fr" | "in-progress-fr" | "empty-fr"
  >("all");
  const [sortKey, setSortKey] = useState<"id" | "title" | "progress" | "traduites" | "fautives">("progress");
  const [sortAsc, setSortAsc] = useState(false);

  // Campaign data query
  const { data: campagne } = useQuery<CampagneStats>({
    queryKey: ["admin", "databooks", "campagne"],
    queryFn: async () => {
      const res = await fetch("/api/admin/databooks/campagne");
      if (!res.ok) throw new Error("Erreur de chargement de la campagne");
      return res.json();
    },
    initialData: initialCampagne,
    refetchInterval: 15_000,
  });

  // Redis reindex mutation
  const reindexMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/databooks/campagne", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reindex-redis" }),
      });
      if (!res.ok) throw new Error("Échec de la réindexation");
      return res.json();
    },
    onSuccess: data => {
      alert(`Index Redis synchronisé : ${data.indexed} fiches indexées.`);
    },
  });

  // Unique categories
  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const f of initialFiches) {
      if (f.categorie) cats.add(f.categorie);
    }
    return Array.from(cats).toSorted();
  }, [initialFiches]);

  // Filtered & sorted fiches
  const filteredFiches = useMemo(() => {
    let list = initialFiches;

    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter(
        f =>
          f.titre.toLowerCase().includes(q) ||
          (f.titreJa && f.titreJa.toLowerCase().includes(q)) ||
          String(f.id).includes(q),
      );
    }

    if (categoryFilter !== "all") {
      list = list.filter(f => f.categorie === categoryFilter);
    }

    if (statusFilter !== "all") {
      if (statusFilter === "completed") {
        list = list.filter(f => f.planches > 0 && f.transcrites >= f.planches);
      } else if (statusFilter === "in-progress") {
        list = list.filter(f => f.transcrites > 0 && f.transcrites < f.planches);
      } else if (statusFilter === "empty") {
        list = list.filter(f => f.transcrites === 0);
      } else if (statusFilter === "completed-fr") {
        list = list.filter(f => f.planches > 0 && (f.traduites ?? 0) >= f.planches);
      } else if (statusFilter === "in-progress-fr") {
        list = list.filter(f => (f.traduites ?? 0) > 0 && (f.traduites ?? 0) < f.planches);
      } else if (statusFilter === "empty-fr") {
        list = list.filter(f => (f.traduites ?? 0) === 0);
      }
    }

    return [...list].toSorted((a, b) => {
      let comp = 0;
      if (sortKey === "id") comp = a.id - b.id;
      else if (sortKey === "title") comp = a.titre.localeCompare(b.titre);
      else if (sortKey === "fautives") comp = a.fautives - b.fautives;
      else if (sortKey === "progress") {
        const pctA = a.planches > 0 ? a.transcrites / a.planches : 0;
        const pctB = b.planches > 0 ? b.transcrites / b.planches : 0;
        comp = pctA - pctB;
      } else if (sortKey === "traduites") {
        const pctA = a.planches > 0 ? (a.traduites ?? 0) / a.planches : 0;
        const pctB = b.planches > 0 ? (b.traduites ?? 0) / b.planches : 0;
        comp = pctA - pctB;
      }
      return sortAsc ? comp : -comp;
    });
  }, [initialFiches, search, categoryFilter, statusFilter, sortKey, sortAsc]);

  return (
    <div className="space-y-6">
      {/* Translation Campaign Cockpit Banner */}
      <div className="dbz-panel p-6 border-l-4 border-l-dbz-orange">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-dbz-orange" />
              <h2 className="font-saiyan text-xl uppercase tracking-wider text-white">
                Poste de Commande · Campagne de Traduction FR
              </h2>
            </div>
            <p className="mt-1 text-xs text-white/50">
              Suivi de la file de traduction en temps réel et ordonnancement des vagues par agents
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => reindexMutation.mutate()}
              disabled={reindexMutation.isPending}
              className="btn btn-ghost btn-sm flex items-center gap-1.5 text-xs text-white/70 hover:text-white"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${reindexMutation.isPending ? "animate-spin" : ""}`} />
              {reindexMutation.isPending ? "Réindexation..." : "Réindexer Redis"}
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg bg-white/[0.02] p-3 border border-white/5">
            <div className="text-xs text-white/40">Ouvrages en Attente</div>
            <div className="mt-1 text-2xl font-bold text-white">
              {campagne.ouvragesEnAttente} / {campagne.totalOuvrages}
            </div>
            <div className="mt-1 text-[11px] text-white/40">
              {campagne.resteATraduire.toLocaleString("fr-FR")} planches à traduire
            </div>
          </div>

          <div className="rounded-lg bg-white/[0.02] p-3 border border-white/5">
            <div className="text-xs text-white/40">Volume Japonais Restant</div>
            <div className="mt-1 text-2xl font-bold text-dbz-orange">
              {Math.round(campagne.signesJaRestants / 1000).toLocaleString("fr-FR")} k
            </div>
            <div className="mt-1 text-[11px] text-white/40">signes japonais sains</div>
          </div>

          <div className="rounded-lg bg-white/[0.02] p-3 border border-white/5">
            <div className="text-xs text-white/40">Planches Déjà Traduites</div>
            <div className="mt-1 text-2xl font-bold text-emerald-400">
              {campagne.planchesTraduites.toLocaleString("fr-FR")}
            </div>
            <div className="mt-1 text-[11px] text-emerald-400/60">
              {campagne.planchesTranscrites > 0
                ? Math.round((campagne.planchesTraduites / campagne.planchesTranscrites) * 100)
                : 0}
              % du corpus transcrit
            </div>
          </div>

          <div className="rounded-lg bg-white/[0.02] p-3 border border-white/5">
            <div className="text-xs text-white/40">Protocole de Sécurité</div>
            <div className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-green-300">
              <CheckCircle className="h-4 w-4" />
              Juge Double Défaut
            </div>
            <div className="mt-1 text-[11px] text-white/40">Zero hallucination · Lexique canonique</div>
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="dbz-panel p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-1 items-center gap-2 min-w-[280px]">
          <Search className="h-4 w-4 text-white/40" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher par titre, titre japonais ou #ID..."
            className="input input-sm w-full bg-white/5 text-xs text-white placeholder-white/30 border-white/10"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            aria-label="Filtrer par catégorie"
            className="select select-sm bg-white/5 text-xs text-white border-white/10"
          >
            <option value="all">Toutes les catégories</option>
            {categories.map(c => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as any)}
            aria-label="Filtrer par statut"
            className="select select-sm bg-white/5 text-xs text-white border-white/10"
          >
            <option value="all">Tous les états</option>
            <option value="in-progress">OCR en cours</option>
            <option value="completed">OCR complet (100%)</option>
            <option value="empty">OCR non démarré</option>
            <option value="completed-fr">Traductions FR terminées (100%)</option>
            <option value="in-progress-fr">Traductions FR en cours</option>
            <option value="empty-fr">Traductions FR non démarrées</option>
          </select>

          <select
            value={sortKey}
            onChange={e => setSortKey(e.target.value as any)}
            aria-label="Trier par critère"
            className="select select-sm bg-white/5 text-xs text-white border-white/10"
          >
            <option value="progress">Tri : Progression OCR</option>
            <option value="traduites">Tri : Traduction FR</option>
            <option value="title">Tri : Titre</option>
            <option value="id">Tri : #ID</option>
            <option value="fautives">Tri : Anomalies</option>
          </select>

          <button
            type="button"
            onClick={() => setSortAsc(!sortAsc)}
            className="btn btn-ghost btn-sm flex items-center gap-1 text-xs text-white/70"
            title="Inverser le tri"
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
            {sortAsc ? "Croissant" : "Décroissant"}
          </button>
        </div>
      </div>

      {/* Books Table */}
      <div className="dbz-panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table table-sm w-full text-left">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.02] text-[11px] uppercase tracking-wider text-white/50">
                <th className="py-3 px-4">#ID</th>
                <th className="py-3 px-4">Ouvrage</th>
                <th className="py-3 px-4">Catégorie</th>
                <th className="py-3 px-4">Transcription</th>
                <th className="py-3 px-4">Traduction FR</th>
                <th className="py-3 px-4">Anomalies</th>
                <th className="py-3 px-4">Signes</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-xs">
              {filteredFiches.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-white/40">
                    Aucun databook ne correspond aux critères.
                  </td>
                </tr>
              ) : (
                filteredFiches.map(fiche => {
                  const pct = fiche.planches > 0 ? Math.round((fiche.transcrites / fiche.planches) * 100) : 0;
                  const pctFr = fiche.planches > 0 ? Math.round(((fiche.traduites ?? 0) / fiche.planches) * 100) : 0;

                  return (
                    <tr key={fiche.id} className="hover:bg-white/[0.02] transition">
                      <td className="py-3 px-4 font-mono font-bold text-dbz-orange">#{fiche.id}</td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          {fiche.cover && (
                            <div className="relative h-10 w-8 flex-shrink-0 overflow-hidden rounded bg-black/40">
                              <Image src={assetUrl(fiche.cover)} alt="" fill className="object-cover" unoptimized />
                            </div>
                          )}
                          <div>
                            <Link
                              href={`/admin/databooks/${fiche.id}`}
                              className="font-bold text-white hover:text-dbz-orange transition"
                            >
                              {fiche.titre}
                            </Link>
                            {fiche.titreJa && (
                              <div className="text-[10px] text-white/40 font-mono">{fiche.titreJa}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="rounded bg-white/5 px-2 py-0.5 text-[10px] text-white/70">
                          {fiche.categorie || "—"}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="w-36 space-y-1">
                          <div className="flex justify-between text-[10px]">
                            <span className="font-semibold text-white">
                              {fiche.transcrites} / {fiche.planches}
                            </span>
                            <span className={pct >= 100 ? "text-green-400 font-bold" : "text-white/50"}>{pct}%</span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                            <div
                              className={`h-full transition-all ${
                                pct >= 100 ? "bg-green-400" : pct >= 50 ? "bg-dbz-orange" : "bg-amber-400"
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="w-36 space-y-1">
                          <div className="flex justify-between text-[10px]">
                            <span className="font-semibold text-white">
                              {fiche.traduites ?? 0} / {fiche.planches}
                            </span>
                            <span
                              className={
                                pctFr >= 100
                                  ? "text-emerald-400 font-bold"
                                  : (fiche.traduites ?? 0) > 0
                                    ? "text-dbz-orange font-semibold"
                                    : "text-white/30"
                              }
                            >
                              {pctFr}%
                            </span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                            <div
                              className={`h-full transition-all ${
                                pctFr >= 100
                                  ? "bg-emerald-400"
                                  : pctFr >= 50
                                    ? "bg-dbz-orange"
                                    : (fiche.traduites ?? 0) > 0
                                      ? "bg-amber-400"
                                      : "bg-transparent"
                              }`}
                              style={{ width: `${pctFr}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {fiche.fautives > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                            <AlertCircle className="h-3 w-3" />
                            {fiche.fautives}
                          </span>
                        ) : (
                          <span className="text-[10px] text-green-400/60 font-semibold">✓ Sain</span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-white/60">{Math.round(fiche.signes / 1000)} k</td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Link
                            href={`/admin/databooks/${fiche.id}`}
                            className="btn btn-ghost btn-xs text-dbz-orange hover:bg-dbz-orange/10"
                            title="Ouvrir le relecteur planche par planche"
                          >
                            Relecteur &rarr;
                          </Link>
                          <Link
                            href={`/admin/wiki/studio/db_databooks/${fiche.id}`}
                            className="btn btn-ghost btn-xs text-white/40 hover:text-white"
                            title="Éditer la fiche dans le studio"
                          >
                            <Pencil className="h-3 w-3" />
                          </Link>
                          <a
                            href={`/wiki/databooks/${fiche.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-ghost btn-xs text-white/40 hover:text-white"
                            title="Voir la page publique"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
