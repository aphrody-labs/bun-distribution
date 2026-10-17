"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  ScanText,
  BookOpen,
  BookMarked,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Sparkles,
  Layers,
  Check,
  Cpu,
  Languages,
  BookA,
  Search,
} from "lucide-react";
import type {
  TranscriptionsOverview,
  DefectivePlateItem,
  GpuBatchItem,
  LexiconOverviewItem,
} from "@/lib/transcriptions-admin";

export function TranscriptionsDashboard({ initialData }: { initialData: TranscriptionsOverview }) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<
    "vue-globale" | "databooks" | "manga" | "arbitrage" | "lots-gpu" | "traduction-vps" | "lexique"
  >("vue-globale");
  const [selectedPlates, setSelectedPlates] = useState<Array<{ databookId: number; pageNumber: number }>>([]);
  const [lexiconSearch, setLexiconSearch] = useState("");
  const [lexiconKind, setLexiconKind] = useState("all");

  // Live overview query
  const { data: overview, isFetching: isFetchingOverview } = useQuery<TranscriptionsOverview>({
    queryKey: ["admin", "transcriptions", "overview"],
    queryFn: async () => {
      const res = await fetch("/api/admin/transcriptions?mode=overview");
      if (!res.ok) throw new Error("Erreur de récupération des transcriptions");
      return res.json();
    },
    initialData,
    refetchInterval: 10_000,
  });

  // Batches query (GPU & VPS)
  const { data: batchesData, isLoading: isLoadingBatches } = useQuery<{
    gpuBatches: GpuBatchItem[];
    translationBatches: Array<{
      lotId: string;
      count: number;
      path: string;
      status: "ready" | "in_progress" | "completed";
    }>;
  }>({
    queryKey: ["admin", "transcriptions", "batches"],
    queryFn: async () => {
      const res = await fetch("/api/admin/transcriptions?mode=batches");
      if (!res.ok) throw new Error("Erreur de récupération des lots");
      return res.json();
    },
    enabled: activeTab === "lots-gpu" || activeTab === "traduction-vps",
  });

  // Lexicon query
  const { data: lexiconData, isLoading: isLoadingLexicon } = useQuery<{
    items: LexiconOverviewItem[];
    total: number;
    stats: Record<string, number>;
  }>({
    queryKey: ["admin", "transcriptions", "lexicon", lexiconSearch, lexiconKind],
    queryFn: async () => {
      const params = new URLSearchParams({ mode: "lexicon", limit: "80" });
      if (lexiconSearch) params.set("query", lexiconSearch);
      if (lexiconKind !== "all") params.set("kind", lexiconKind);
      const res = await fetch(`/api/admin/transcriptions?${params.toString()}`);
      if (!res.ok) throw new Error("Erreur de récupération du lexique");
      return res.json();
    },
    enabled: activeTab === "lexique",
  });

  // Defective plates query for the arbitration queue
  const { data: defectiveData, isLoading: isLoadingDefective } = useQuery<{
    items: DefectivePlateItem[];
    total: number;
  }>({
    queryKey: ["admin", "transcriptions", "defective"],
    queryFn: async () => {
      const res = await fetch("/api/admin/transcriptions?mode=defective&limit=60");
      if (!res.ok) throw new Error("Erreur de récupération des anomalies");
      return res.json();
    },
    enabled: activeTab === "arbitrage",
  });

  // Batch verify mutation
  const verifyMutation = useMutation({
    mutationFn: async (plates: Array<{ databookId: number; pageNumber: number }>) => {
      const res = await fetch("/api/admin/transcriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify-batch", plates }),
      });
      if (!res.ok) throw new Error("Échec de la validation");
      return res.json();
    },
    onSuccess: () => {
      setSelectedPlates([]);
      queryClient.invalidateQueries({ queryKey: ["admin", "transcriptions"] });
    },
  });

  const toggleSelectPlate = (databookId: number, pageNumber: number) => {
    setSelectedPlates(prev => {
      const exists = prev.some(p => p.databookId === databookId && p.pageNumber === pageNumber);
      if (exists) {
        return prev.filter(p => !(p.databookId === databookId && p.pageNumber === pageNumber));
      }
      return [...prev, { databookId, pageNumber }];
    });
  };

  const selectAllDefective = () => {
    if (!defectiveData?.items) return;
    if (selectedPlates.length === defectiveData.items.length) {
      setSelectedPlates([]);
    } else {
      setSelectedPlates(
        defectiveData.items.map(i => ({
          databookId: i.databookId,
          pageNumber: i.pageNumber,
        })),
      );
    }
  };

  const databooks = overview?.databooks ?? initialData.databooks;
  const manga = overview?.manga ?? initialData.manga;

  return (
    <div className="space-y-6">
      {/* Subnav Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("vue-globale")}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${
              activeTab === "vue-globale"
                ? "bg-dbz-orange text-black"
                : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
            }`}
          >
            <Layers className="h-4 w-4" />
            Vue Globale
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("lots-gpu")}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${
              activeTab === "lots-gpu"
                ? "bg-dbz-orange text-black"
                : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
            }`}
          >
            <Cpu className="h-4 w-4" />
            Lots GPU Local
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("traduction-vps")}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${
              activeTab === "traduction-vps"
                ? "bg-dbz-orange text-black"
                : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
            }`}
          >
            <Languages className="h-4 w-4" />
            Traduction VPS
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("lexique")}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${
              activeTab === "lexique"
                ? "bg-dbz-orange text-black"
                : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
            }`}
          >
            <BookA className="h-4 w-4" />
            Lexique Canonique
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("databooks")}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${
              activeTab === "databooks"
                ? "bg-dbz-orange text-black"
                : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
            }`}
          >
            <BookOpen className="h-4 w-4" />
            Databooks ({databooks.transcribedPages}/{databooks.totalPages})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("manga")}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${
              activeTab === "manga"
                ? "bg-dbz-orange text-black"
                : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
            }`}
          >
            <BookMarked className="h-4 w-4" />
            Manga OCR ({manga.ocrWithText}/{manga.totalPages})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("arbitrage")}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${
              activeTab === "arbitrage"
                ? "bg-amber-400 text-black font-bold"
                : "bg-amber-400/10 text-amber-300 border border-amber-400/20 hover:bg-amber-400/20"
            }`}
          >
            <AlertTriangle className="h-4 w-4" />
            File d&apos;arbitrage ({databooks.defectivePages} anomalies)
          </button>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() =>
              queryClient.invalidateQueries({
                queryKey: ["admin", "transcriptions"],
              })
            }
            disabled={isFetchingOverview}
            className="btn btn-ghost btn-sm flex items-center gap-2 text-xs text-white/60 hover:text-white"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetchingOverview ? "animate-spin" : ""}`} />
            Rafraîchir
          </button>
        </div>
      </div>

      {/* TAB 1: VUE GLOBALE */}
      {activeTab === "vue-globale" && (
        <div className="space-y-6">
          {/* Stat KPI Grid */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="dbz-panel p-5">
              <div className="flex items-center justify-between text-xs text-white/55">
                <span>Transcription Databooks</span>
                <ScanText className="h-4 w-4 text-dbz-orange" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-3xl font-bold tabular-nums text-white">{databooks.transcriptionRate}%</span>
                <span className="text-xs text-white/45">
                  ({databooks.transcribedPages.toLocaleString("fr-FR")} / {databooks.totalPages.toLocaleString("fr-FR")}
                  )
                </span>
              </div>
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full bg-dbz-orange transition-all"
                  style={{ width: `${databooks.transcriptionRate}%` }}
                />
              </div>
              <p className="mt-2 text-[11px] text-white/40">
                {Math.round(databooks.japaneseChars / 1000).toLocaleString("fr-FR")} k signes japonais extraits
              </p>
            </div>

            <div className="dbz-panel p-5">
              <div className="flex items-center justify-between text-xs text-white/55">
                <span>Traduction FR Databooks</span>
                <Sparkles className="h-4 w-4 text-emerald-400" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-3xl font-bold tabular-nums text-emerald-400">{databooks.translationRate}%</span>
                <span className="text-xs text-white/45">
                  ({databooks.translatedPages.toLocaleString("fr-FR")} /{" "}
                  {databooks.transcribedPages.toLocaleString("fr-FR")})
                </span>
              </div>
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full bg-emerald-400 transition-all"
                  style={{ width: `${databooks.translationRate}%` }}
                />
              </div>
              <p className="mt-2 text-[11px] text-white/40">
                {Math.round(databooks.frenchChars / 1000).toLocaleString("fr-FR")} k signes français déposés
              </p>
            </div>

            <div className="dbz-panel p-5">
              <div className="flex items-center justify-between text-xs text-white/55">
                <span>Manga VF Intégral</span>
                <CheckCircle2 className="h-4 w-4 text-green-400" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-3xl font-bold tabular-nums text-green-400">100%</span>
                <span className="text-xs text-white/45">
                  ({manga.ocrWithText.toLocaleString("fr-FR")} / {manga.totalPages.toLocaleString("fr-FR")})
                </span>
              </div>
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div className="h-full bg-green-400 w-full" />
              </div>
              <p className="mt-2 text-[11px] text-white/40">42 tomes réguliers + Full Color + DBS chapitrés</p>
            </div>

            <div className="dbz-panel p-5">
              <div className="flex items-center justify-between text-xs text-white/55">
                <span>Anomalies &amp; Sans Scan</span>
                <AlertTriangle className="h-4 w-4 text-amber-400" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-3xl font-bold tabular-nums text-amber-300">{databooks.defectivePages}</span>
                <span className="text-xs text-white/45">anomalies · {databooks.missingScans} sans scan</span>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab("arbitrage")}
                  className="text-xs font-semibold text-amber-400 hover:underline"
                >
                  Ouvrir la file d&apos;arbitrage →
                </button>
              </div>
            </div>
          </div>

          {/* Pipeline & Infrastructure Cards */}
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="dbz-panel p-6">
              <h2 className="mb-4 font-saiyan text-lg uppercase text-dbz-orange">Pipelines &amp; Moteurs Actifs</h2>
              <div className="space-y-4 text-sm">
                <div className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] p-3">
                  <div>
                    <div className="font-semibold text-white">PP-OCRv5 Core (Aphrody)</div>
                    <div className="text-xs text-white/50">Détection déterministe CPU · ~1s par planche</div>
                  </div>
                  <span className="rounded-full border border-green-500/30 bg-green-500/10 px-2.5 py-0.5 text-xs text-green-300">
                    Opérationnel
                  </span>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] p-3">
                  <div>
                    <div className="font-semibold text-white">Arbitrage Multi-Agents (Manga)</div>
                    <div className="text-xs text-white/50">Double lecture indépendante sans hallucination</div>
                  </div>
                  <span className="rounded-full border border-green-500/30 bg-green-500/10 px-2.5 py-0.5 text-xs text-green-300">
                    Scellé (0 retard)
                  </span>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] p-3">
                  <div>
                    <div className="font-semibold text-white">Campagne Traduction FR (Databooks)</div>
                    <div className="text-xs text-white/50">Orchestration par vagues avec lexique canonique</div>
                  </div>
                  <span className="rounded-full border border-dbz-orange/30 bg-dbz-orange/10 px-2.5 py-0.5 text-xs text-dbz-orange">
                    En cours
                  </span>
                </div>
              </div>
            </div>

            <div className="dbz-panel p-6">
              <h2 className="mb-4 font-saiyan text-lg uppercase text-dbz-orange">Actions Rapides</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <Link
                  href="/admin/databooks"
                  className="flex flex-col justify-between rounded-lg border border-white/10 bg-white/5 p-4 transition hover:border-dbz-orange hover:bg-white/10"
                >
                  <span className="font-semibold text-white">Gestion Databooks</span>
                  <span className="mt-1 text-xs text-white/50">
                    Catalogue des {databooks.totalBooks} fiches, traductions et synchronisation Redis
                  </span>
                  <span className="mt-3 text-xs font-bold text-dbz-orange">Accéder →</span>
                </Link>

                <Link
                  href="/admin/ia?tab=overview"
                  className="flex flex-col justify-between rounded-lg border border-white/10 bg-white/5 p-4 transition hover:border-dbz-orange hover:bg-white/10"
                >
                  <span className="font-semibold text-white">Cockpit IA &amp; Canon</span>
                  <span className="mt-1 text-xs text-white/50">
                    Monitoring des embeddings RAG, quotas LLM et tests directs
                  </span>
                  <span className="mt-3 text-xs font-bold text-dbz-orange">Accéder →</span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: DATABOOKS */}
      {activeTab === "databooks" && (
        <div className="dbz-panel p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-saiyan text-xl uppercase text-dbz-orange">Avancement des Databooks</h2>
              <p className="text-xs text-white/50">
                Suivi du corpus de {databooks.totalBooks} ouvrages référencés ·{" "}
                {databooks.transcribedPages.toLocaleString("fr-FR")} planches transcrites
              </p>
            </div>
            <Link href="/admin/databooks" className="btn btn-primary btn-sm text-xs">
              Ouvrir le poste de commande Databooks →
            </Link>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
            <p className="text-sm leading-relaxed text-white/70">
              Le suivi détaillé et le contrôle des campagnes de traduction se font désormais sur la page dédiée{" "}
              <Link href="/admin/databooks" className="text-dbz-orange underline">
                /admin/databooks
              </Link>
              . Vous pouvez y piloter les vagues de traduction, identifier les ouvrages nécessitant une retranscription
              OCR et réindexer le cache Redis.
            </p>
          </div>
        </div>
      )}

      {/* TAB 3: MANGA OCR */}
      {activeTab === "manga" && (
        <div className="dbz-panel p-6 space-y-6">
          <div>
            <h2 className="font-saiyan text-xl uppercase text-dbz-orange">Corpus Manga OCR (VF &amp; Canon)</h2>
            <p className="text-xs text-white/50">
              État des 12 577 planches indexées dans PostgreSQL (bot.db_manga_pages)
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {manga.seriesBreakdown.map(s => (
              <div key={s.serie} className="rounded-lg border border-white/10 bg-white/5 p-4">
                <div className="text-xs font-bold uppercase text-dbz-orange">{s.serie}</div>
                <div className="mt-2 text-2xl font-bold text-white">{s.planches.toLocaleString("fr-FR")}</div>
                <div className="text-xs text-white/50">planches dans {s.chapitres} chapitres</div>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-4 text-sm text-green-300">
            ✓ L&apos;intégralité des 42 tomes réguliers de Dragon Ball et des chapitres de Dragon Ball Super sont
            transcrits et synchronisés. Aucune planche manga n&apos;est en attente d&apos;OCR.
          </div>
        </div>
      )}

      {/* TAB 4: FILE D'ARBITRAGE */}
      {activeTab === "arbitrage" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
            <div>
              <h2 className="font-saiyan text-xl uppercase text-amber-400">File d&apos;Arbitrage &amp; Anomalies</h2>
              <p className="text-xs text-white/50">
                {defectiveData?.total ?? 0} planches nécessitent une attention ou une confirmation humaine
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button type="button" onClick={selectAllDefective} className="btn btn-ghost btn-sm text-xs text-white/70">
                {selectedPlates.length === (defectiveData?.items.length ?? 0)
                  ? "Tout désélectionner"
                  : "Tout sélectionner"}
              </button>

              {selectedPlates.length > 0 && (
                <button
                  type="button"
                  onClick={() => verifyMutation.mutate(selectedPlates)}
                  disabled={verifyMutation.isPending}
                  className="btn btn-primary btn-sm flex items-center gap-1.5 text-xs font-bold"
                >
                  <Check className="h-3.5 w-3.5" />
                  Acquitter {selectedPlates.length} planche(s)
                </button>
              )}
            </div>
          </div>

          {isLoadingDefective ? (
            <div className="dbz-panel p-12 text-center text-white/40">Chargement des anomalies...</div>
          ) : defectiveData?.items.length === 0 ? (
            <div className="dbz-panel p-12 text-center text-green-300">
              ✓ Aucune anomalie en attente ! Toutes les planches sont saines ou acquittées.
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {defectiveData?.items.map(item => {
                const isSelected = selectedPlates.some(
                  p => p.databookId === item.databookId && p.pageNumber === item.pageNumber,
                );

                return (
                  <div
                    key={`${item.databookId}-${item.pageNumber}`}
                    className={`dbz-panel p-4 transition ${isSelected ? "ring-2 ring-dbz-orange" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <Link
                          href={`/admin/databooks/${item.databookId}?planche=${item.pageNumber}`}
                          className="text-xs font-bold text-dbz-orange hover:underline"
                        >
                          #{item.databookId} {item.databookTitle} · p.
                          {item.pageNumber}
                        </Link>
                        <div className="mt-1 flex items-center gap-2">
                          <span className="rounded bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-300">
                            {item.defectKind}
                          </span>
                          <span className="text-[10px] text-white/40">{item.charCount} caractères</span>
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelectPlate(item.databookId, item.pageNumber)}
                        className="checkbox checkbox-sm checkbox-warning"
                      />
                    </div>

                    <div className="mt-3 max-h-28 overflow-y-auto rounded bg-black/30 p-2 text-xs font-mono text-white/70">
                      {item.textJa || <span className="italic text-white/30">[Sans texte]</span>}
                    </div>

                    <div className="mt-3 flex items-center justify-between">
                      <Link
                        href={`/admin/databooks/${item.databookId}?planche=${item.pageNumber}`}
                        className="text-[11px] text-white/50 hover:text-white"
                      >
                        Inspecter scan &rarr;
                      </Link>
                      <button
                        type="button"
                        onClick={() =>
                          verifyMutation.mutate([
                            {
                              databookId: item.databookId,
                              pageNumber: item.pageNumber,
                            },
                          ])
                        }
                        className="rounded border border-green-500/30 px-2 py-0.5 text-[10px] font-semibold text-green-300 hover:bg-green-500/10"
                      >
                        Acquitter
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB: LOTS GPU LOCAL */}
      {activeTab === "lots-gpu" && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/5 p-4">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Cpu className="h-5 w-5 text-dbz-orange" />
                Lots OCR pour GPU Local (PP-OCRv5 + Vision VLM)
              </h3>
              <p className="mt-1 text-xs text-white/60">
                Lots partitionnés prêts pour inférence locale à haute cadence. Aucune charge sur le VPS.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <code className="rounded bg-black/60 px-3 py-1.5 text-xs text-amber-300 font-mono">
                bun scripts/ops/batch-databooks-ocr.ts --exporter --taille 100
              </code>
            </div>
          </div>

          {isLoadingBatches ? (
            <div className="flex justify-center py-12">
              <span className="loading loading-spinner loading-md text-dbz-orange" />
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(batchesData?.gpuBatches ?? []).map(batch => (
                <div key={batch.lotId} className="dbz-panel p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white text-sm">{batch.lotId}</span>
                    <span className="rounded bg-green-500/10 px-2 py-0.5 text-[11px] font-semibold text-green-400">
                      {batch.count} planches
                    </span>
                  </div>
                  {batch.details && (
                    <p className="text-xs text-white/50 truncate" title={batch.details}>
                      {batch.details}
                    </p>
                  )}
                  <p className="text-[11px] font-mono text-white/30 truncate" title={batch.path}>
                    {batch.path}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB: TRADUCTION VPS */}
      {activeTab === "traduction-vps" && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/5 p-4">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Languages className="h-5 w-5 text-dbz-orange" />
                Lots &amp; Pipelines de Traduction VPS (Subagents &amp; Lexique)
              </h3>
              <p className="mt-1 text-xs text-white/60">
                Masquage lexical obligatoire (Zeta001...) &rarr; Inférence subagent &rarr; Réinjection canonique FR.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <code className="rounded bg-black/60 px-3 py-1.5 text-xs text-emerald-300 font-mono">
                bun scripts/ops/translate-databooks.ts --databook 4 --exporter-lots
              </code>
            </div>
          </div>

          {isLoadingBatches ? (
            <div className="flex justify-center py-12">
              <span className="loading loading-spinner loading-md text-dbz-orange" />
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(batchesData?.translationBatches ?? []).map(batch => (
                <div key={batch.lotId} className="dbz-panel p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white text-sm">{batch.lotId}</span>
                    <span className="rounded bg-dbz-orange/10 px-2 py-0.5 text-[11px] font-semibold text-dbz-orange">
                      {batch.count} planches
                    </span>
                  </div>
                  <p className="text-[11px] font-mono text-white/40 truncate" title={batch.path}>
                    {batch.path}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB: LEXIQUE CANONIQUE */}
      {activeTab === "lexique" && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="relative flex-1 min-w-[280px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
              <input
                type="text"
                value={lexiconSearch}
                onChange={e => setLexiconSearch(e.target.value)}
                placeholder="Rechercher un terme japonais ou français..."
                className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-4 text-sm text-white placeholder:text-white/30 focus:border-dbz-orange focus:outline-none"
              />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {["all", "personnage", "technique", "race", "planete", "saga", "autre"].map(k => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setLexiconKind(k)}
                  className={`rounded px-2.5 py-1 text-xs font-semibold capitalize transition ${
                    lexiconKind === k
                      ? "bg-dbz-orange text-black"
                      : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {k === "all" ? "Tous" : k}
                  {lexiconData?.stats[k] ? ` (${lexiconData.stats[k]})` : ""}
                </button>
              ))}
            </div>
          </div>

          {isLoadingLexicon ? (
            <div className="flex justify-center py-12">
              <span className="loading loading-spinner loading-md text-dbz-orange" />
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-white/10 bg-white/5">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-white/10 bg-white/5 text-xs uppercase text-white/50">
                  <tr>
                    <th className="px-4 py-3">Japonais Canonique</th>
                    <th className="px-4 py-3">Français Officiel (Shenron)</th>
                    <th className="px-4 py-3">Catégorie</th>
                    <th className="px-4 py-3 text-right">Longueur</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {(lexiconData?.items ?? []).map((item, idx) => (
                    <tr key={idx} className="hover:bg-white/5">
                      <td className="px-4 py-2.5 font-bold font-mono text-amber-300">{item.ja}</td>
                      <td className="px-4 py-2.5 font-medium text-white">{item.fr}</td>
                      <td className="px-4 py-2.5">
                        <span className="rounded bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/70">
                          {item.kind}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-white/40">{item.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
