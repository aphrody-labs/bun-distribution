"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { NativeAiPanel } from "./NativeAiPanel";
import {
  type CockpitFailure,
  type IaCockpitTab,
  bytesToBase64,
  describeHttpFailure,
  describeNetworkFailure,
  ocrProbeFileError,
  parseCockpitTab,
  splitMarkedExcerpt,
} from "./ia-cockpit-view";
import {
  Brain,
  Shield,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Search,
  Database,
  Sparkles,
  Cpu,
  Send,
  MessageSquare,
  Award,
  Activity,
  ExternalLink,
  Play,
  Clock,
  Scale,
  BookOpen,
  TrendingUp,
  Users,
  Server,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import CanonEditor from "@aphrody/admin-ui/app/admin/canon/CanonEditor";
import type { CanonConfig } from "@/lib/canon-engine";
import type {
  CockpitEvalResult,
  IaCockpitReport,
  IaSourceKey,
  RagBackendInfo,
  RetrievalHit,
  SourceReport,
  SourceStatus,
} from "@/lib/ia-cockpit";
import { Card, CardContent, CardHeader, CardTitle } from "@shenron/ui/card";

type IaDashboardData = IaCockpitReport & {
  canonConfig: CanonConfig;
  canonDefaults: CanonConfig;
  timestamp: string;
};

interface MangaHit {
  series: string;
  tome: string;
  planche: number;
  extrait: string;
  score: number;
}

interface TestPromptResult {
  ok: boolean;
  query: string;
  latencyMs: number;
  backend: RagBackendInfo;
  rag: SourceReport<{ mode: string; results: RetrievalHit[] }>;
  canon: {
    tier: string;
    tierLabel: string;
    score: number;
    verdict: string;
    nature: string;
    toriyamaQuote?: { text: string; source: string; year?: number };
    preuves?: unknown;
  } | null;
  manga: SourceReport<MangaHit[]>;
}

type Notice = { kind: "ok" | "info" | "error"; text: string };

interface Props {
  initialTab?: IaCockpitTab;
}

// ── Formatting ───────────────────────────────────────────────────────────────

const fmtInt = (value: number | null | undefined) => (typeof value === "number" ? value.toLocaleString("fr-FR") : "—");
const fmtPct = (value: number | null | undefined) =>
  typeof value === "number" ? `${(value * 100).toFixed(1)} %` : "—";
const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("fr-FR") : "—");

function modeLabel(mode: string | null | undefined): string {
  switch (mode) {
    case "hybrid":
      return "Hybride (lexical + vecteurs)";
    case "hybrid+rerank":
      return "Hybride + reranking";
    case "lexical":
      return "Lexical seul";
    case "unavailable":
      return "Index vide";
    case null:
    case undefined:
      return "Mode inconnu";
    default:
      return mode;
  }
}

const STATUS_TEXT: Record<SourceStatus, string> = {
  ok: "OK",
  unavailable: "Indisponible",
  unconfigured: "Non configuré",
};

const STATUS_CLASS: Record<SourceStatus, string> = {
  ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  unavailable: "border-red-500/30 bg-red-500/10 text-red-300",
  unconfigured: "border-amber-500/30 bg-amber-500/10 text-amber-300",
};

const DOT_CLASS: Record<SourceStatus, string> = {
  ok: "bg-emerald-400",
  unavailable: "bg-red-400",
  unconfigured: "bg-amber-400",
};

function StatusBadge({ status }: { status: SourceStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_CLASS[status]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${DOT_CLASS[status]}`} />
      {STATUS_TEXT[status]}
    </span>
  );
}

function Flag({ label, on }: { label: string; on: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-semibold ${on ? STATUS_CLASS.ok : STATUS_CLASS.unavailable}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${on ? DOT_CLASS.ok : DOT_CLASS.unavailable}`} />
      {label} {on ? "actif" : "inactif"}
    </span>
  );
}

/** One data source: status, target, latency, then either its details or its error. */
function SourceRow<T>({ report, children }: { report: SourceReport<T>; children?: (data: T) => React.ReactNode }) {
  return (
    <div className="space-y-1.5 rounded-lg border border-white/10 bg-black/30 p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold text-white">{report.label}</span>
        <div className="flex items-center gap-2">
          {report.latencyMs !== null && (
            <span className="font-mono text-[10px] text-white/40">{report.latencyMs} ms</span>
          )}
          <StatusBadge status={report.status} />
        </div>
      </div>
      <div className="font-mono text-[10px] text-white/40">{report.target}</div>
      {report.status === "ok" && report.data !== null ? (
        children?.(report.data)
      ) : (
        <div className="text-[11px] text-red-300">{report.error ?? "Source indisponible"}</div>
      )}
    </div>
  );
}

function SourceError({ report }: { report: SourceReport<unknown> | undefined }) {
  if (!report || report.status === "ok") return null;
  return (
    <div className={`rounded-lg border px-3 py-2 text-[11px] ${STATUS_CLASS[report.status]}`}>
      {report.label} — {STATUS_TEXT[report.status]} : {report.error ?? "source indisponible"}
    </div>
  );
}

const TABS: Array<{ key: IaCockpitTab; label: string; icon: LucideIcon }> = [
  { key: "overview", label: "Supervision & Test Direct", icon: Activity },
  { key: "training", label: "Entraînement RAG & Évaluations", icon: Award },
  { key: "canon", label: "Doctrine de Canonicité & Toriyama", icon: Scale },
  { key: "corpus", label: "Corpus manga, databooks & OCR", icon: BookOpen },
  { key: "agents", label: "Agents Autonomes & Objectifs", icon: Users },
];

const HEADER_SOURCES: Array<{ key: IaSourceKey; name: string }> = [
  { key: "aphrodyHealth", name: "Aphrody AI" },
  { key: "aphrodyWeb", name: "Aphrody Web" },
  { key: "botRag", name: "Bot" },
  { key: "evalHistory", name: "PostgreSQL" },
];

export function UnifiedIaCockpit({ initialTab = "overview" }: Props) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const activeTab = parseCockpitTab(searchParams.get("tab"), initialTab);

  const setTab = (tab: IaCockpitTab) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    router.push(`/admin/ia?${params.toString()}`, { scroll: false });
  };

  // ── Données et rafraîchissement en direct ─────────────────────────────────
  const [data, setData] = useState<IaDashboardData | null>(null);
  const [loadFailure, setLoadFailure] = useState<CockpitFailure | null>(null);
  // Auto-refresh can overlap a manual refresh; only the latest request may write state.
  const latestFetch = useRef(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<number>(15000);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [ocrImage, setOcrImage] = useState<string | null>(null);
  const [ocrResult, setOcrResult] = useState<string | null>(null);
  const [ocrBusy, setOcrBusy] = useState(false);

  const fetchData = async (silent = false) => {
    const ticket = ++latestFetch.current;
    if (!silent) setIsRefreshing(true);
    try {
      const res = await fetch("/api/admin/ia", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (ticket !== latestFetch.current) return;
      if (!res.ok) {
        setLoadFailure(describeHttpFailure(res.status, json?.error));
        return;
      }
      setData(json as IaDashboardData);
      setLoadFailure(null);
    } catch (err) {
      if (ticket === latestFetch.current) setLoadFailure(describeNetworkFailure(err));
    } finally {
      if (ticket === latestFetch.current) setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (autoRefreshInterval <= 0) return;
    const timer = setInterval(() => {
      fetchData(true);
    }, autoRefreshInterval);
    return () => clearInterval(timer);
  }, [autoRefreshInterval]);

  /** POST an action; surfaces the server error or notice instead of failing silently. */
  const postAction = async (payload: Record<string, unknown>): Promise<any | null> => {
    try {
      const res = await fetch("/api/admin/ia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setNotice({
          kind: "error",
          text: json?.error ?? `Erreur HTTP ${res.status}`,
        });
        return null;
      }
      if (typeof json?.notice === "string") setNotice({ kind: "info", text: json.notice });
      return json;
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  };

  const handleOcrProbe = async () => {
    if (!ocrImage) return;
    setOcrBusy(true);
    setOcrResult(null);
    const result = await postAction({
      action: "ocr_probe",
      imageBase64: ocrImage,
      language: "ja",
    });
    if (result)
      setOcrResult(typeof result.result?.text === "string" ? result.result.text : "Réponse OCR reçue sans texte.");
    setOcrBusy(false);
  };

  // ── Test multi-moteurs en direct ──────────────────────────────────────────
  const [testQuery, setTestQuery] = useState("");
  const [isTestingQuery, setIsTestingQuery] = useState(false);
  const [testResult, setTestResult] = useState<TestPromptResult | null>(null);

  const handleRunTest = async (queryToRun?: string) => {
    const q = (queryToRun ?? testQuery).trim();
    if (!q) return;
    setIsTestingQuery(true);
    try {
      const json = await postAction({ action: "test_prompt", query: q });
      if (json) setTestResult(json as TestPromptResult);
    } finally {
      setIsTestingQuery(false);
    }
  };

  // ── Évaluation RAG directe ────────────────────────────────────────────────
  const [evalSampleSize, setEvalSampleSize] = useState<number>(25);
  const [isRunningEval, setIsRunningEval] = useState(false);
  const [evalMessage, setEvalMessage] = useState<Notice | null>(null);
  const [liveEvalResult, setLiveEvalResult] = useState<CockpitEvalResult | null>(null);

  const handleRunLiveEval = async () => {
    setIsRunningEval(true);
    setEvalMessage({
      kind: "info",
      text: `Évaluation en cours sur ${evalSampleSize > 0 ? `${evalSampleSize} cas dorés` : "tout le jeu doré"}…`,
    });
    try {
      const res = await fetch("/api/admin/ia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "evaluate_rag",
          samples: evalSampleSize,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setEvalMessage({
          kind: "error",
          text: json?.error ?? `Erreur HTTP ${res.status}`,
        });
        return;
      }
      const metrics = json.metrics as CockpitEvalResult;
      setLiveEvalResult(metrics);
      setEvalMessage({
        kind: "ok",
        text: metrics.persisted
          ? `Évaluation de ${metrics.engine} terminée et historisée par le bot (visible ici après synchronisation du miroir PostgreSQL).`
          : `Évaluation de ${metrics.engine} terminée ; non historisée (l'historique bot.rag_eval_history appartient au bot).`,
      });
      fetchData(true);
    } catch (err) {
      setEvalMessage({
        kind: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsRunningEval(false);
    }
  };

  // ── Jeu doré ──────────────────────────────────────────────────────────────
  const [newGoldQ, setNewGoldQ] = useState("");
  const [newGoldExpect, setNewGoldExpect] = useState("");
  const [goldFilter, setGoldFilter] = useState("");
  const [isAddingGold, setIsAddingGold] = useState(false);

  const handleAddGoldCase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGoldQ.trim() || !newGoldExpect.trim()) return;
    setIsAddingGold(true);
    try {
      const json = await postAction({
        action: "add_gold_case",
        q: newGoldQ.trim(),
        expect: newGoldExpect
          .split(",")
          .map(s => s.trim())
          .filter(Boolean),
      });
      if (json) {
        setNewGoldQ("");
        setNewGoldExpect("");
        fetchData(true);
      }
    } finally {
      setIsAddingGold(false);
    }
  };

  // ── Modération des retours ────────────────────────────────────────────────
  const handleUpdateFeedback = async (id: number, status: string) => {
    if (await postAction({ action: "update_feedback", id, status })) fetchData(true);
  };

  // ── Salon Discord admin ───────────────────────────────────────────────────
  const [discordInput, setDiscordInput] = useState("");
  const [isSendingDiscord, setIsSendingDiscord] = useState(false);

  const handleSendDiscord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!discordInput.trim()) return;
    setIsSendingDiscord(true);
    try {
      if (
        await postAction({
          action: "send_lab_message",
          message: discordInput.trim(),
        })
      ) {
        setDiscordInput("");
        setTimeout(() => fetchData(true), 800);
      }
    } finally {
      setIsSendingDiscord(false);
    }
  };

  // ── Objectifs ─────────────────────────────────────────────────────────────
  const [newGoalTitle, setNewGoalTitle] = useState("");
  const [newGoalDesc, setNewGoalDesc] = useState("");

  const handleCreateGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGoalTitle.trim()) return;
    const json = await postAction({
      action: "create_goal",
      title: newGoalTitle.trim(),
      description: newGoalDesc.trim() || newGoalTitle.trim(),
    });
    if (json) {
      setNewGoalTitle("");
      setNewGoalDesc("");
      fetchData(true);
    }
  };

  const handleCompleteGoal = async (id: number) => {
    if (
      await postAction({
        action: "complete_goal",
        id,
        notes: "Validé depuis le Web Cockpit",
      })
    )
      fetchData(true);
  };

  const sources = data?.sources;
  const summary = data?.summary;
  const goldSample = sources?.goldSet.data?.sample ?? [];
  const filteredGoldCases = (() => {
    if (!goldFilter.trim()) return goldSample;
    const f = goldFilter.toLowerCase();
    return goldSample.filter(c => c.q.toLowerCase().includes(f) || c.expected.some(e => e.toLowerCase().includes(f)));
  })();

  const latestEval = summary?.latestEval ?? null;
  const countsReport = summary && sources ? sources[summary.countsSource] : undefined;
  const servingStatus = summary?.serving.status;
  const gatewayReady = sources?.botRag.data?.gatewayReady ?? null;

  return (
    <div className="mx-auto w-full max-w-[1700px] space-y-6 pb-16">
      {/* ── BARRE DE CONTRÔLE SUPÉRIEURE ─────────────────────────────────── */}
      <header className="rounded-2xl border border-dbz-border bg-gradient-to-b from-dbz-card to-black/80 p-5 shadow-2xl backdrop-blur-md">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-dbz-orange to-red-600 text-white shadow-lg shadow-dbz-orange/20">
                <Brain className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-xl font-black uppercase tracking-wider text-white flex items-center gap-2">
                  IA &amp; CANON COCKPIT
                  {summary && (
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${summary.status === "ok" ? STATUS_CLASS.ok : STATUS_CLASS.unavailable}`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${summary.status === "ok" ? DOT_CLASS.ok : DOT_CLASS.unavailable}`}
                      />
                      {summary.status === "ok" ? "TOUTES SOURCES OK" : `${summary.failing.length} SOURCE(S) EN DÉFAUT`}
                    </span>
                  )}
                </h1>
                <p className="text-xs text-white/50">
                  Aphrody (RAG, LLM, OCR, crawl), doctrine de canonicité, entraînement RAG et agents autonomes
                </p>
              </div>
            </div>
          </div>

          {/* Télémesures en direct */}
          <div className="flex flex-wrap items-center gap-2">
            {sources &&
              HEADER_SOURCES.map(({ key, name }) => {
                const report = sources[key];
                return (
                  <div
                    key={key}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium ${STATUS_CLASS[report.status]}`}
                    title={report.error ? `${report.target} — ${report.error}` : report.target}
                  >
                    <span className={`h-2 w-2 rounded-full ${DOT_CLASS[report.status]}`} />
                    <span>{name}</span>
                    <span className="font-mono text-[10px] text-white/40">
                      {report.latencyMs !== null ? `${report.latencyMs}ms` : STATUS_TEXT[report.status]}
                    </span>
                  </div>
                );
              })}

            {/* Contrôle de rafraîchissement */}
            <div className="flex items-center gap-1.5 rounded-lg border border-dbz-border bg-black/40 px-2 py-1">
              <button
                onClick={() => fetchData()}
                disabled={isRefreshing}
                className="btn btn-ghost btn-xs h-7 px-2 text-white/70 hover:text-white flex items-center gap-1"
                title="Actualiser les données"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin text-dbz-orange" : ""}`} />
                <span className="text-[11px]">Actualiser</span>
              </button>

              <select
                value={autoRefreshInterval}
                onChange={e => setAutoRefreshInterval(Number(e.target.value))}
                className="bg-transparent text-[11px] text-white/60 outline-none cursor-pointer"
                title="Cadence de rafraîchissement automatique"
              >
                <option value="5000">Auto 5s</option>
                <option value="15000">Auto 15s</option>
                <option value="30000">Auto 30s</option>
                <option value="0">Manuel</option>
              </select>
            </div>

            <Link
              href="/wiki/canon"
              target="_blank"
              className="btn btn-ghost btn-xs h-8 px-2.5 text-xs text-white/60 hover:text-white border border-white/10 rounded-lg flex items-center gap-1"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Détecteur Public
            </Link>
          </div>
        </div>

        {/* Bandeau d'onglets */}
        <nav
          aria-label="Sections du cockpit IA"
          className="mt-5 flex flex-wrap gap-1 border-t border-dbz-border/50 pt-4"
        >
          {TABS.map(({ key, label, icon: Icon }) => {
            const badge = key === "training" ? summary?.pendingFeedbacks : key === "agents" ? summary?.activeGoals : 0;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                aria-current={activeTab === key ? "page" : undefined}
                className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition-all ${
                  activeTab === key
                    ? "bg-dbz-orange text-black shadow-lg shadow-dbz-orange/30"
                    : "text-white/70 hover:bg-white/5 hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
                {badge ? (
                  <span
                    className={`rounded-full px-1.5 py-0.2 text-[10px] text-white font-mono font-bold ${
                      key === "training" ? "bg-red-500" : "bg-blue-500"
                    }`}
                  >
                    {badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
      </header>

      <NativeAiPanel />

      {!data && !loadFailure && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-xs text-blue-300"
        >
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          Chargement du cockpit : les sources IA répondent une à une, les indicateurs restent à « — » d'ici là.
        </div>
      )}

      {loadFailure && (
        <div
          role="alert"
          className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs ${STATUS_CLASS.unavailable}`}
        >
          <span>
            Cockpit non actualisé — /api/admin/ia : {loadFailure.text}
            {data ? ` (dernières données : ${fmtDate(data.timestamp)})` : ""}
          </span>
          {loadFailure.kind === "unauthenticated" || loadFailure.kind === "forbidden" ? (
            <Link
              href={`/signin?callbackURL=${encodeURIComponent(`/admin/ia?tab=${activeTab}`)}`}
              className="font-semibold underline"
            >
              Se reconnecter
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => fetchData()}
              disabled={isRefreshing}
              className="font-semibold underline disabled:opacity-50"
            >
              Réessayer
            </button>
          )}
        </div>
      )}

      {notice && (
        <div
          className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-xs ${
            notice.kind === "error"
              ? STATUS_CLASS.unavailable
              : notice.kind === "ok"
                ? STATUS_CLASS.ok
                : "border-blue-500/30 bg-blue-500/10 text-blue-300"
          }`}
        >
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} className="text-white/50 hover:text-white" title="Fermer">
            Fermer
          </button>
        </div>
      )}

      {activeTab === "corpus" && (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" aria-labelledby="corpus-title">
          <div className="md:col-span-2 xl:col-span-4">
            <h2 id="corpus-title" className="text-xl font-bold text-white">
              Corpus éditorial
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-white/55">
              Aphrody fournit les modèles et le RAG ; Shenron conserve les sources, les arbitrages OCR, les traductions
              et la publication. Chaque action ci-dessous ouvre la surface réelle de son propriétaire.
            </p>
          </div>
          <CorpusLink
            href="/admin/transcriptions"
            title="Manga & OCR"
            text="Relecture, défauts OCR et arbitrage multi-agents."
          />
          <CorpusLink
            href="/admin/databooks"
            title="Databooks & traductions"
            text="Pages, campagnes, traductions FR et gelures d'écriture."
          />
          <CorpusLink
            href="/admin/db-universe/databooks"
            title="Catalogue databooks"
            text="Métadonnées éditoriales et ouvrages officiels."
          />
          <CorpusLink
            href="/admin/ia?tab=canon"
            title="Canon & preuves"
            text="Doctrine, références et verdicts contrôlés."
          />
          <CorpusLiveStatus />
          <Card className="border-dbz-border bg-dbz-card md:col-span-2 xl:col-span-4">
            <CardHeader>
              <CardTitle className="text-base text-white">Sonde OCR Aphrody</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-white/55">
                Envoyer une planche à l’endpoint OCR Aphrody réel pour vérifier la chaîne de calcul.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="text-sm text-white/70 file:mr-3 file:rounded-lg file:border-0 file:bg-dbz-orange file:px-3 file:py-2 file:font-semibold file:text-black"
                  onChange={async event => {
                    const file = event.target.files?.[0];
                    setOcrResult(null);
                    if (!file) {
                      setOcrImage(null);
                      return;
                    }
                    const rejection = ocrProbeFileError(file);
                    if (rejection) {
                      setOcrImage(null);
                      setNotice({ kind: "error", text: rejection });
                      return;
                    }
                    setOcrImage(bytesToBase64(new Uint8Array(await file.arrayBuffer())));
                  }}
                />
                <button
                  type="button"
                  onClick={handleOcrProbe}
                  disabled={!ocrImage || ocrBusy}
                  className="btn bg-dbz-orange px-4 py-2 text-sm font-bold text-black disabled:opacity-40"
                >
                  {ocrBusy ? "Analyse…" : "Tester OCR"}
                </button>
              </div>
              {ocrResult !== null && (
                <pre className="max-h-48 overflow-auto rounded-lg border border-white/10 bg-black/30 p-3 text-sm text-white/80">
                  {ocrResult}
                </pre>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
			    ONGLET 1 : SUPERVISION & TEST DIRECT MULTI-MOTEURS
			    ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* Métriques globales */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
            <div className="rounded-xl border border-dbz-border bg-dbz-card/60 p-4">
              <div className="text-[11px] font-semibold text-white/50 uppercase">Moteur RAG actif</div>
              <div className="mt-1 text-base font-black text-white">{data?.backend.engine ?? "—"}</div>
              <div className="mt-1 font-mono text-[10px] text-white/40">
                RAG_BACKEND={data ? (data.backend.raw ?? "non défini") : "—"}
              </div>
              {servingStatus && (
                <div className="mt-1.5">
                  <StatusBadge status={servingStatus} />
                </div>
              )}
            </div>

            <div className="rounded-xl border border-dbz-border bg-dbz-card/60 p-4">
              <div className="text-[11px] font-semibold text-white/50 uppercase">Documents RAG</div>
              <div className="mt-1 text-2xl font-black text-white font-mono">{fmtInt(summary?.documents)}</div>
              <div
                className={`text-[10px] mt-1 flex items-center gap-1 ${countsReport?.status === "ok" ? "text-emerald-400" : "text-red-400"}`}
              >
                {countsReport?.status === "ok" ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : (
                  <AlertTriangle className="h-3 w-3" />
                )}
                {countsReport
                  ? countsReport.status === "ok"
                    ? countsReport.label
                    : `${countsReport.label} : ${countsReport.error ?? STATUS_TEXT[countsReport.status]}`
                  : "—"}
              </div>
            </div>

            <div className="rounded-xl border border-dbz-border bg-dbz-card/60 p-4">
              <div className="text-[11px] font-semibold text-white/50 uppercase">Vecteurs RAG</div>
              <div className="mt-1 text-2xl font-black text-white font-mono">{fmtInt(summary?.vectors)}</div>
              <div
                className={`text-[10px] mt-1 flex items-center gap-1 ${summary?.mode ? "text-emerald-400" : "text-red-400"}`}
              >
                <Cpu className="h-3 w-3" /> {summary ? modeLabel(summary.mode) : "—"}
              </div>
            </div>

            <div className="rounded-xl border border-dbz-border bg-dbz-card/60 p-4">
              <div className="text-[11px] font-semibold text-white/50 uppercase">Banc Doré (Gold-Set)</div>
              <div className="mt-1 text-2xl font-black text-white font-mono">{fmtInt(summary?.goldCases)}</div>
              <div className="text-[10px] text-white/40 mt-1">
                {sources?.goldSet.status === "ok"
                  ? latestEval
                    ? `Dernière éval : ${latestEval.casesCount} cas`
                    : "Aucune évaluation historisée"
                  : (sources?.goldSet.error ?? "—")}
              </div>
            </div>

            <div className="rounded-xl border border-dbz-border bg-dbz-card/60 p-4">
              <div className="text-[11px] font-semibold text-white/50 uppercase">Dernier Recall@5</div>
              <div className="mt-1 text-2xl font-black text-emerald-400 font-mono">{fmtPct(latestEval?.recall5)}</div>
              <div className="text-[10px] text-white/40 mt-1">
                {latestEval ? fmtDate(latestEval.createdAt) : (sources?.evalHistory.error ?? "Aucun instantané")}
              </div>
            </div>

            <div className="rounded-xl border border-dbz-border bg-dbz-card/60 p-4">
              <div className="text-[11px] font-semibold text-white/50 uppercase">Dernier MRR</div>
              <div className="mt-1 text-2xl font-black text-cyan-400 font-mono">{fmtPct(latestEval?.mrr)}</div>
              <div className="text-[10px] text-white/40 mt-1">Rang moyen du 1er hit juste</div>
            </div>

            <div className="rounded-xl border border-dbz-border bg-dbz-card/60 p-4">
              <div className="text-[11px] font-semibold text-white/50 uppercase">Feedbacks RAG</div>
              <div className="mt-1 text-2xl font-black text-white font-mono">
                {fmtInt(sources?.feedbacks.data?.total)}
              </div>
              <div className="text-[10px] text-amber-400 mt-1">
                {sources?.feedbacks.status === "ok"
                  ? `${sources.feedbacks.data?.pending ?? 0} en attente d'arbitrage`
                  : (sources?.feedbacks.error ?? "—")}
              </div>
            </div>
          </div>

          {/* ── SOURCES IA : chaque propriétaire rend son propre état ───────── */}
          {sources && (
            <div className="rounded-2xl border border-dbz-border bg-dbz-card p-6 space-y-4">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Server className="h-5 w-5 text-dbz-orange" />
                  Sources IA en direct
                </h2>
                <p className="text-xs text-white/50">
                  Chaque source rend son propre état ; une source en défaut n'est jamais remplacée par une valeur de
                  repli.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <SourceRow report={sources.aphrodyHealth}>
                  {health => (
                    <div className="flex flex-wrap gap-1.5">
                      <Flag label="RAG" on={health.rag} />
                      <Flag label="LLM" on={health.llm} />
                      <Flag label="OCR" on={health.ocr} />
                    </div>
                  )}
                </SourceRow>

                <SourceRow report={sources.aphrodyRagStats}>
                  {stats => (
                    <div className="space-y-1 text-[11px] text-white/70">
                      <div>
                        {fmtInt(stats.chunks)} documents · {fmtInt(stats.vectors)} vecteurs alignés
                        {stats.vectorsStored !== null ? ` (${fmtInt(stats.vectorsStored)} stockés)` : ""} ·{" "}
                        {fmtInt(stats.sources)} sources
                      </div>
                      {stats.kinds.length > 0 && (
                        <div className="text-white/50">
                          {stats.kinds
                            .slice(0, 6)
                            .map(k => `${k.kind} ${fmtInt(k.count)}`)
                            .join(" · ")}
                        </div>
                      )}
                    </div>
                  )}
                </SourceRow>

                <SourceRow report={sources.aphrodyRagProbe}>
                  {probe => (
                    <div className="text-[11px] text-white/70">
                      {modeLabel(probe.mode)} · {probe.hits} résultat(s) pour « {probe.query} »
                    </div>
                  )}
                </SourceRow>

                <SourceRow report={sources.aphrodyWeb}>
                  {web => (
                    <div className="text-[11px] text-white/70">
                      File : {fmtInt(web.queue.pending)} en attente · {fmtInt(web.queue.locked)} en cours ·{" "}
                      {fmtInt(web.queue.done)} traitées · {fmtInt(web.queue.failed)} en échec (total{" "}
                      {fmtInt(web.queue.total)}) · {web.jobs} travail(aux), {web.runningJobs} actif(s)
                    </div>
                  )}
                </SourceRow>

                <SourceRow report={sources.botRag}>
                  {bot => (
                    <div className="text-[11px] text-white/70">
                      {fmtInt(bot.chunks)} documents · {fmtInt(bot.vectors)} vecteurs · {modeLabel(bot.mode)}
                      {bot.builtAt ? ` · construit le ${fmtDate(bot.builtAt)}` : ""}
                      {data?.backend.value === "aphrody" ? " · hors trafic (RAG_BACKEND=aphrody)" : " · sert le trafic"}
                    </div>
                  )}
                </SourceRow>

                <SourceRow report={sources.evalHistory}>
                  {rows => (
                    <div className="text-[11px] text-white/70">
                      {rows.length} instantané(s) récent(s)
                      {rows[0] ? ` · dernier le ${fmtDate(rows[0].createdAt)} (miroir PostgreSQL du bot)` : ""}
                    </div>
                  )}
                </SourceRow>
              </div>
            </div>
          )}

          {/* ── BANC D'ESSAI MULTI-MOTEURS INTERACTIF ──────────────────────── */}
          <div className="rounded-2xl border border-dbz-border bg-dbz-card p-6 shadow-xl">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-dbz-orange" />
                  Banc d'Essai Multi-Moteurs en Direct
                </h2>
                <p className="text-xs text-white/50">
                  La requête interroge en parallèle le moteur RAG actif ({data?.backend.engine ?? "—"}), la doctrine
                  canonique et la recherche manga.
                </p>
              </div>

              {/* Suggestions rapides */}
              <div className="flex flex-wrap gap-1.5">
                {[
                  "Kamehameha",
                  "Broly DBZ 1993",
                  "Gine mère de Goku",
                  "Freezer 530 000",
                  "Gogeta vs Vegito",
                  "Planète Namek",
                ].map(preset => (
                  <button
                    key={preset}
                    type="button"
                    disabled={isTestingQuery}
                    onClick={() => {
                      setTestQuery(preset);
                      handleRunTest(preset);
                    }}
                    className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-white/70 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            {/* Formulaire de recherche */}
            <div className="mt-4 flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
                <input
                  type="text"
                  value={testQuery}
                  onChange={e => setTestQuery(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleRunTest()}
                  placeholder="Exemple : Quel est le niveau de Freezer lors de sa première transformation ? Broly 1993 est-il canon ?"
                  className="w-full rounded-xl border border-dbz-border bg-black/40 pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-dbz-orange transition-colors"
                />
              </div>
              <button
                onClick={() => handleRunTest()}
                disabled={isTestingQuery || !testQuery.trim()}
                className="btn bg-dbz-orange hover:bg-dbz-orange/90 text-black font-bold px-5 rounded-xl flex items-center gap-2 transition-all disabled:opacity-50"
              >
                {isTestingQuery ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 fill-current" />
                )}
                Diagnostiquer
              </button>
            </div>

            {/* Résultats du diagnostic multi-moteurs */}
            {testResult && (
              <div className="mt-6 space-y-4 border-t border-white/10 pt-5">
                <div className="flex items-center justify-between text-xs text-white/60">
                  <span>
                    Résultats pour : <strong className="text-white">« {testResult.query} »</strong>
                  </span>
                  <span className="font-mono bg-white/5 px-2 py-0.5 rounded border border-white/10">
                    Latence totale : {testResult.latencyMs} ms
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Carte 1 : Verdict canonique */}
                  <div className="rounded-xl border border-dbz-border bg-black/40 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase text-white/70 flex items-center gap-1.5">
                        <Scale className="h-3.5 w-3.5 text-amber-400" />
                        Doctrine Canonique
                      </span>
                      {testResult.canon ? (
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                            testResult.canon.tier === "canon"
                              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                              : testResult.canon.tier === "retcon"
                                ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                                : "bg-red-500/20 text-red-400 border border-red-500/30"
                          }`}
                        >
                          {testResult.canon.tierLabel} ({testResult.canon.score}
                          /100)
                        </span>
                      ) : (
                        <span className="text-[10px] text-white/40">Inconnu</span>
                      )}
                    </div>

                    {testResult.canon ? (
                      <div className="space-y-2 text-xs">
                        <div className="font-semibold text-white">{testResult.canon.verdict}</div>
                        <div className="text-white/60 text-[11px] leading-relaxed">
                          Nature : {testResult.canon.nature}
                        </div>
                        {testResult.canon.toriyamaQuote && (
                          <div className="rounded-lg bg-white/5 p-2 border-l-2 border-dbz-orange text-[11px] italic text-white/80">
                            « {testResult.canon.toriyamaQuote.text} »
                            <div className="mt-1 font-sans not-italic text-[10px] text-white/40">
                              — Akira Toriyama ({testResult.canon.toriyamaQuote.source})
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-xs text-white/40 italic">Aucune règle canon spécifique activée.</div>
                    )}
                  </div>

                  {/* Carte 2 : RAG (moteur actif) */}
                  <div className="rounded-xl border border-dbz-border bg-black/40 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase text-white/70 flex items-center gap-1.5">
                        <Database className="h-3.5 w-3.5 text-cyan-400" />
                        RAG ({testResult.rag.data?.results.length ?? 0})
                      </span>
                      <span className="text-[10px] text-white/40">
                        {testResult.rag.label} ·{" "}
                        {testResult.rag.data ? modeLabel(testResult.rag.data.mode) : STATUS_TEXT[testResult.rag.status]}
                      </span>
                    </div>

                    <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                      {testResult.rag.status !== "ok" ? (
                        <SourceError report={testResult.rag} />
                      ) : testResult.rag.data && testResult.rag.data.results.length > 0 ? (
                        testResult.rag.data.results.map((hit, idx) => (
                          <div
                            key={idx}
                            className="rounded-lg border border-white/5 bg-white/[0.02] p-2.5 text-xs space-y-1"
                          >
                            <div className="flex items-center justify-between font-medium text-white">
                              <span className="truncate max-w-[180px] text-dbz-orange">{hit.title}</span>
                              {typeof hit.score === "number" && (
                                <span className="font-mono text-[10px] text-white/40">
                                  Score: {hit.score.toFixed(2)}
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-white/60 line-clamp-3 leading-relaxed">{hit.snippet}</p>
                          </div>
                        ))
                      ) : (
                        <div className="text-xs text-white/40 italic">Aucun passage retourné par le moteur.</div>
                      )}
                    </div>
                  </div>

                  {/* Carte 3 : Extraits manga */}
                  <div className="rounded-xl border border-dbz-border bg-black/40 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase text-white/70 flex items-center gap-1.5">
                        <BookOpen className="h-3.5 w-3.5 text-emerald-400" />
                        Manga 42 Tomes ({testResult.manga.data?.length ?? 0})
                      </span>
                      <span className="text-[10px] text-white/40">OCR Bulles</span>
                    </div>

                    <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                      {testResult.manga.status !== "ok" ? (
                        <SourceError report={testResult.manga} />
                      ) : testResult.manga.data && testResult.manga.data.length > 0 ? (
                        testResult.manga.data.map((m, idx) => (
                          <div
                            key={idx}
                            className="rounded-lg border border-white/5 bg-white/[0.02] p-2.5 text-xs space-y-1"
                          >
                            <div className="flex items-center justify-between font-medium text-white">
                              <span className="text-emerald-400 font-bold">
                                {m.series.toUpperCase()} {m.tome} — Planche {m.planche}
                              </span>
                              <span className="font-mono text-[10px] text-white/40">Score: {m.score.toFixed(1)}</span>
                            </div>
                            <p className="text-[11px] text-white/70 line-clamp-3 leading-relaxed [&>mark]:bg-dbz-orange/40 [&>mark]:text-white [&>mark]:px-0.5 rounded">
                              {splitMarkedExcerpt(m.extrait).map((part, i) =>
                                part.marked ? <mark key={i}>{part.text}</mark> : part.text,
                              )}
                            </p>
                          </div>
                        ))
                      ) : (
                        <div className="text-xs text-white/40 italic">Aucune planche correspondante.</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── DIALOGUE DIRECT AVEC LE SALON DISCORD ADMIN ──────────────────── */}
          <div className="rounded-2xl border border-dbz-border bg-dbz-card p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <MessageSquare className="h-5 w-5 text-blue-400" />
                  Flux Direct Discord — lab-ia-admin
                </h2>
                <p className="text-xs text-white/50">
                  Canal privé (1548677623935139901) : échangez directement avec Shenron Bot et tous les agents du
                  monorepo.
                </p>
              </div>
              <span className="text-xs font-mono text-white/40 bg-white/5 px-2.5 py-1 rounded border border-white/10">
                Canal : 1548677623935139901
              </span>
            </div>

            {/* Messages récents */}
            <div className="max-h-[260px] overflow-y-auto space-y-2 rounded-xl border border-white/10 bg-black/50 p-4 font-mono text-xs">
              {sources && sources.labMessages.status !== "ok" ? (
                <SourceError report={sources.labMessages} />
              ) : sources?.labMessages.data && sources.labMessages.data.length > 0 ? (
                sources.labMessages.data.map((m, idx) => {
                  const isShenron = m.author.toLowerCase().includes("shenron");
                  return (
                    <div key={m.id || idx} className="flex flex-col gap-0.5 border-b border-white/5 pb-2">
                      <div className="flex items-center gap-2 text-[11px] text-white/40">
                        <span className={isShenron ? "font-bold text-dbz-orange" : "font-bold text-blue-400"}>
                          {m.author}
                        </span>
                        <span>•</span>
                        <span>{m.timestamp ? new Date(m.timestamp).toLocaleTimeString("fr-FR") : "—"}</span>
                      </div>
                      <div className="text-white/80 whitespace-pre-wrap font-sans text-xs">{m.content}</div>
                    </div>
                  );
                })
              ) : (
                <div className="text-white/40 italic">Aucun message récent dans le salon.</div>
              )}
            </div>

            {/* Envoi rapide */}
            <form onSubmit={handleSendDiscord} className="flex gap-2">
              <input
                type="text"
                value={discordInput}
                onChange={e => setDiscordInput(e.target.value)}
                placeholder="Transmettre une instruction immédiate ou poser une question aux agents..."
                className="flex-1 rounded-xl border border-dbz-border bg-black/40 px-4 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-blue-400 transition-colors"
              />
              <button
                type="submit"
                disabled={isSendingDiscord || !discordInput.trim()}
                className="btn bg-blue-600 hover:bg-blue-500 text-white font-bold px-4 rounded-xl flex items-center gap-1.5 transition-all disabled:opacity-50"
              >
                {isSendingDiscord ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Transmettre
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
			    ONGLET 2 : ENTRAÎNEMENT RAG & BANCS D'ÉVALUATION
			    ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "training" && (
        <div className="space-y-6">
          {/* Évaluation RAG en direct */}
          <div className="rounded-2xl border border-dbz-border bg-dbz-card p-6 shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Award className="h-5 w-5 text-dbz-orange" />
                  Banc d'Évaluation &amp; Surveillance des Régressions
                </h2>
                <p className="text-xs text-white/50">
                  Recall@1, Recall@5, MRR et nDCG@10 du moteur actif ({data?.backend.engine ?? "—"}) sur le jeu doré
                  versionné.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={evalSampleSize}
                  onChange={e => setEvalSampleSize(Number(e.target.value))}
                  className="rounded-lg border border-dbz-border bg-black/40 px-3 py-2 text-xs text-white outline-none"
                >
                  <option value="10">10 cas</option>
                  <option value="25">25 cas</option>
                  <option value="0">Tous les cas ({fmtInt(summary?.goldCases)})</option>
                </select>

                <button
                  onClick={handleRunLiveEval}
                  disabled={isRunningEval}
                  className="btn bg-dbz-orange hover:bg-dbz-orange/90 text-black font-bold px-4 py-2 rounded-lg flex items-center gap-2 text-xs disabled:opacity-50"
                >
                  {isRunningEval ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 fill-current" />
                  )}
                  Lancer Évaluation
                </button>
              </div>
            </div>

            {evalMessage && (
              <div
                className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                  evalMessage.kind === "ok"
                    ? STATUS_CLASS.ok
                    : evalMessage.kind === "error"
                      ? STATUS_CLASS.unavailable
                      : "bg-blue-500/10 border-blue-500/20 text-blue-400"
                }`}
              >
                {isRunningEval && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                <span>{evalMessage.text}</span>
              </div>
            )}

            {liveEvalResult && (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 border-t border-white/10 pt-4">
                <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                  <div className="text-[10px] text-white/50 uppercase">Cas</div>
                  <div className="text-xl font-bold text-white font-mono">{liveEvalResult.cases}</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                  <div className="text-[10px] text-white/50 uppercase">Recall@1</div>
                  <div className="text-xl font-bold text-white font-mono">{fmtPct(liveEvalResult.recall[1])}</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                  <div className="text-[10px] text-white/50 uppercase">Recall@5</div>
                  <div className="text-xl font-bold text-emerald-400 font-mono">{fmtPct(liveEvalResult.recall[5])}</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                  <div className="text-[10px] text-white/50 uppercase">MRR</div>
                  <div className="text-xl font-bold text-cyan-400 font-mono">{fmtPct(liveEvalResult.mrr)}</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                  <div className="text-[10px] text-white/50 uppercase">nDCG@10</div>
                  <div className="text-xl font-bold text-purple-400 font-mono">{fmtPct(liveEvalResult.ndcg)}</div>
                </div>
              </div>
            )}
          </div>

          {/* Historique des évaluations */}
          <div className="rounded-2xl border border-dbz-border bg-dbz-card p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Clock className="h-4 w-4 text-white/60" />
              Historique des Instantanés d'Évaluation (bot.rag_eval_history, miroir PostgreSQL)
            </h3>
            <SourceError report={sources?.evalHistory} />

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-white/80">
                <thead className="border-b border-white/10 text-[11px] uppercase text-white/40 font-mono">
                  <tr>
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Cas</th>
                    <th className="py-2.5 px-3">Recall@1</th>
                    <th className="py-2.5 px-3">Recall@5</th>
                    <th className="py-2.5 px-3">MRR</th>
                    <th className="py-2.5 px-3">nDCG@10</th>
                    <th className="py-2.5 px-3">Durée</th>
                    <th className="py-2.5 px-3">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 font-mono">
                  {sources?.evalHistory.data && sources.evalHistory.data.length > 0 ? (
                    sources.evalHistory.data.map(snap => (
                      <tr key={snap.id} className="hover:bg-white/[0.02]">
                        <td className="py-2.5 px-3 font-sans text-white/60">{fmtDate(snap.createdAt)}</td>
                        <td className="py-2.5 px-3">{snap.casesCount}</td>
                        <td className="py-2.5 px-3 text-white">{fmtPct(snap.recall1)}</td>
                        <td className="py-2.5 px-3 text-emerald-400 font-bold">{fmtPct(snap.recall5)}</td>
                        <td className="py-2.5 px-3 text-cyan-400">{fmtPct(snap.mrr)}</td>
                        <td className="py-2.5 px-3 text-purple-400">{fmtPct(snap.ndcg)}</td>
                        <td className="py-2.5 px-3 text-white/40">{snap.durationMs} ms</td>
                        <td className="py-2.5 px-3">
                          {snap.missesCount === 0 ? (
                            <span className="inline-flex items-center gap-1 text-emerald-400">
                              <CheckCircle2 className="h-3 w-3" /> Parfait
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-amber-400">
                              <AlertTriangle className="h-3 w-3" /> {snap.missesCount} échec(s)
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} className="py-4 text-center text-white/40 italic">
                        {sources?.evalHistory.status === "ok"
                          ? "Aucun instantané d'évaluation enregistré."
                          : "Historique indisponible."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Jeu doré & retours */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-2xl border border-dbz-border bg-dbz-card p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Award className="h-4 w-4 text-dbz-orange" />
                  Cas Dorés du RAG ({fmtInt(summary?.goldCases)})
                </h3>
              </div>
              <SourceError report={sources?.goldSet} />

              <form
                onSubmit={handleAddGoldCase}
                className="space-y-2 rounded-xl border border-white/10 bg-black/30 p-3"
              >
                <div className="text-xs font-bold text-white/80">Ajouter un cas au jeu doré (écrit par le bot)</div>
                <input
                  type="text"
                  value={newGoldQ}
                  onChange={e => setNewGoldQ(e.target.value)}
                  placeholder="Question canonique précise..."
                  className="w-full rounded-lg border border-dbz-border bg-black/40 px-3 py-1.5 text-xs text-white outline-none"
                />
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newGoldExpect}
                    onChange={e => setNewGoldExpect(e.target.value)}
                    placeholder="Mots-clés attendus (séparés par virgules)..."
                    className="flex-1 rounded-lg border border-dbz-border bg-black/40 px-3 py-1.5 text-xs text-white outline-none"
                  />
                  <button
                    type="submit"
                    disabled={isAddingGold || !newGoldQ.trim() || !newGoldExpect.trim()}
                    className="btn bg-dbz-orange text-black font-bold px-3 py-1.5 text-xs rounded-lg disabled:opacity-50"
                  >
                    Ajouter
                  </button>
                </div>
              </form>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/40" />
                <input
                  type="text"
                  value={goldFilter}
                  onChange={e => setGoldFilter(e.target.value)}
                  placeholder="Filtrer les cas dorés..."
                  className="w-full rounded-lg border border-dbz-border bg-black/40 pl-9 pr-3 py-1.5 text-xs text-white outline-none"
                />
              </div>

              <div className="max-h-[300px] overflow-y-auto space-y-2 pr-1">
                {filteredGoldCases.map((c, idx) => (
                  <div key={idx} className="rounded-lg border border-white/5 bg-white/[0.02] p-2.5 text-xs space-y-1">
                    <div className="font-medium text-white">{c.q}</div>
                    <div className="text-[11px] text-emerald-400">Attendu : [{c.expected.join(", ")}]</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-dbz-border bg-dbz-card p-6 shadow-xl space-y-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-400" />
                Retours &amp; Arbitrage RAG (bot.rag_training_feedback)
              </h3>
              <SourceError report={sources?.feedbacks} />

              <div className="max-h-[420px] overflow-y-auto space-y-2 pr-1">
                {sources?.feedbacks.data && sources.feedbacks.data.rows.length > 0 ? (
                  sources.feedbacks.data.rows.map(fb => (
                    <div key={fb.id} className="rounded-lg border border-white/5 bg-white/[0.02] p-3 text-xs space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-white/80">
                          #{fb.id} — « {fb.query} »
                        </span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded uppercase font-bold ${
                            fb.status === "pending"
                              ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                              : fb.status === "gold_added"
                                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                                : "bg-white/10 text-white/50"
                          }`}
                        >
                          {fb.status}
                        </span>
                      </div>

                      {fb.expected && (
                        <div className="text-[11px] text-emerald-400">Attendu proposé : {fb.expected}</div>
                      )}
                      {fb.comment && <div className="text-[11px] text-white/60 italic">« {fb.comment} »</div>}

                      {fb.status === "pending" && (
                        <div className="flex gap-2 pt-1 border-t border-white/5">
                          <button
                            onClick={() => handleUpdateFeedback(fb.id, "gold_added")}
                            className="btn bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 py-1 rounded text-[11px] font-bold"
                          >
                            Valider
                          </button>
                          <button
                            onClick={() => handleUpdateFeedback(fb.id, "rejected")}
                            className="btn bg-red-600/30 hover:bg-red-600/50 text-red-300 px-2.5 py-1 rounded text-[11px]"
                          >
                            Rejeter
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                ) : sources?.feedbacks.status === "ok" ? (
                  <div className="text-xs text-white/40 italic text-center py-6">Aucun retour enregistré.</div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
			    ONGLET 3 : DOCTRINE DE CANONICITÉ & PAROLES DE TORIYAMA
			    ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "canon" && data?.canonConfig && (
        <div className="space-y-6">
          <CanonEditor initial={data.canonConfig} defaults={data.canonDefaults} />
        </div>
      )}
      {activeTab === "canon" && !data?.canonConfig && loadFailure && (
        <p className="rounded-xl border border-white/10 bg-black/30 px-4 py-6 text-center text-xs text-white/50">
          La doctrine n'a pas pu être chargée : voir l'erreur ci-dessus. L'éditeur reste masqué plutôt que de proposer
          des valeurs par défaut à écraser.
        </p>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
			    ONGLET 4 : AGENTS AUTONOMES, CLÉS D'ACCÈS & OBJECTIFS DE SESSION
			    ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "agents" && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-dbz-border bg-dbz-card p-6 shadow-xl space-y-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Users className="h-5 w-5 text-dbz-orange" />
              Gardiens du Canon &amp; Alignement Multi-Agents
            </h2>
            <p className="text-xs text-white/50">
              Tous les agents de développement incarnent Shenron et partagent la même directive de vérité canonique et
              d'écoute sur le salon <code>lab-ia-admin</code>.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-xl border border-white/10 bg-black/40 p-4 space-y-2">
                <div className="flex items-center justify-between font-bold text-white text-sm">
                  <span>Shenron Discord Bot</span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded border ${
                      gatewayReady === true
                        ? STATUS_CLASS.ok
                        : gatewayReady === false
                          ? STATUS_CLASS.unavailable
                          : STATUS_CLASS.unconfigured
                    }`}
                  >
                    {gatewayReady === true
                      ? "Gateway prête"
                      : gatewayReady === false
                        ? "Gateway hors ligne"
                        : "Gateway inconnue"}
                  </span>
                </div>
                <p className="text-xs text-white/60">
                  Écoute <code>messageCreate</code> dans le lab admin, tâche cron <code>rag-auto-eval</code> toutes les
                  6h, détection de régressions.
                </p>
              </div>

              <div className="rounded-xl border border-white/10 bg-black/40 p-4 space-y-2">
                <div className="flex items-center justify-between font-bold text-white text-sm">
                  <span>Claude Code Agent</span>
                  <span className="text-[10px] bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded">CLAUDE.md</span>
                </div>
                <p className="text-xs text-white/60">
                  Lecture impérative de <code>docs/GOALS.md</code> et <code>docs/ADMIN-REPORTS.md</code> au démarrage de
                  chaque session. Primauté absolue aux 42 tomes.
                </p>
              </div>

              <div className="rounded-xl border border-white/10 bg-black/40 p-4 space-y-2">
                <div className="flex items-center justify-between font-bold text-white text-sm">
                  <span>Gemini / AGY / Codex</span>
                  <span className="text-[10px] bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded">
                    GEMINI / CODEX.md
                  </span>
                </div>
                <p className="text-xs text-white/60">
                  Directives unifiées. Notification directe via <code>bun scripts/ops/notify-admin-lab.ts</code>.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-2xl border border-dbz-border bg-dbz-card p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-emerald-400" />
                  Objectifs Actifs (bot.admin_goals → docs/GOALS.md)
                </h3>
                <span className="text-xs text-white/40">{fmtInt(summary?.activeGoals)} actif(s)</span>
              </div>
              <SourceError report={sources?.goals} />

              <form onSubmit={handleCreateGoal} className="space-y-2 rounded-xl border border-white/10 bg-black/30 p-3">
                <div className="text-xs font-bold text-white/80">
                  Fixer un objectif pour la prochaine session (écrit par le bot)
                </div>
                <input
                  type="text"
                  value={newGoalTitle}
                  onChange={e => setNewGoalTitle(e.target.value)}
                  placeholder="Titre de l'objectif (ex: Optimiser le reranker)..."
                  className="w-full rounded-lg border border-dbz-border bg-black/40 px-3 py-1.5 text-xs text-white outline-none"
                />
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newGoalDesc}
                    onChange={e => setNewGoalDesc(e.target.value)}
                    placeholder="Description détaillée ou contraintes..."
                    className="flex-1 rounded-lg border border-dbz-border bg-black/40 px-3 py-1.5 text-xs text-white outline-none"
                  />
                  <button
                    type="submit"
                    disabled={!newGoalTitle.trim()}
                    className="btn bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3 py-1.5 text-xs rounded-lg disabled:opacity-50"
                  >
                    Fixer
                  </button>
                </div>
              </form>

              <div className="max-h-[300px] overflow-y-auto space-y-2 pr-1">
                {sources?.goals.data?.rows.map(g => (
                  <div key={g.id} className="rounded-lg border border-white/5 bg-white/[0.02] p-3 text-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white">
                        #{g.id} — {g.title}
                      </span>
                      <button
                        onClick={() => handleCompleteGoal(g.id)}
                        className="btn btn-xs bg-emerald-600/30 hover:bg-emerald-600 text-emerald-300 hover:text-white px-2 py-0.5 rounded text-[10px]"
                      >
                        Marquer accompli
                      </button>
                    </div>
                    {g.description && <p className="text-[11px] text-white/60">{g.description}</p>}
                  </div>
                ))}
                {sources?.goals.status === "ok" && sources.goals.data?.rows.length === 0 && (
                  <div className="text-xs text-white/40 italic text-center py-6">Aucun objectif actif.</div>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-dbz-border bg-dbz-card p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Shield className="h-4 w-4 text-dbz-orange" />
                  Clés d'Accès &amp; Sécurité Agents
                </h3>
                <Link href="/admin/agents" className="text-xs text-dbz-orange hover:underline">
                  Gestionnaire complet
                </Link>
              </div>
              <SourceError report={sources?.agentKeys} />

              <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                {sources?.agentKeys.data && sources.agentKeys.data.length > 0 ? (
                  sources.agentKeys.data.map(k => (
                    <div key={k.id} className="rounded-lg border border-white/5 bg-white/[0.02] p-3 text-xs space-y-1">
                      <div className="flex items-center justify-between font-medium text-white">
                        <span className="font-bold">{k.name}</span>
                        <span className="font-mono text-[10px] text-white/40">
                          Créée le {k.createdAt ? new Date(k.createdAt).toLocaleDateString("fr-FR") : "—"}
                        </span>
                      </div>
                      <div className="text-[11px] text-white/50">
                        Portées : <code className="text-white/80">{k.scopes.join(", ")}</code>
                      </div>
                    </div>
                  ))
                ) : sources?.agentKeys.status === "ok" ? (
                  <div className="text-xs text-white/40 italic text-center py-6">Aucune clé d'agent configurée.</div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CorpusLink({ href, title, text }: { href: string; title: string; text: string }) {
  return (
    <Card className="group border-dbz-border bg-dbz-card transition-colors hover:border-dbz-orange/60 hover:bg-dbz-orange/[.06]">
      <Link href={href} className="block focus-visible:outline-2 focus-visible:outline-dbz-orange">
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-base text-white group-hover:text-dbz-orange">{title}</CardTitle>
          <ExternalLink className="h-4 w-4 text-white/40 group-hover:text-dbz-orange" aria-hidden />
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed text-white/55">{text}</p>
        </CardContent>
      </Link>
    </Card>
  );
}

interface CorpusTranscription {
  databooks?: { transcribedPages?: number; defectivePages?: number };
  manga?: { ocrPages?: number; ocrWithText?: number };
}

interface CorpusPipeline {
  databooks?: { etat?: string };
  manga?: { etat?: string };
}

interface CorpusLive {
  transcription: CorpusTranscription | null;
  pipeline: CorpusPipeline | null;
  errors: string[];
  loading: boolean;
}

/** GET a private admin route; a non-2xx answer throws its readable cause instead of parsing as data. */
async function readAdminJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(describeHttpFailure(res.status, json?.error).text);
  return json as T;
}

function CorpusLiveStatus() {
  const [state, setState] = useState<CorpusLive>({
    transcription: null,
    pipeline: null,
    errors: [],
    loading: true,
  });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [transcription, pipeline] = await Promise.allSettled([
        readAdminJson<CorpusTranscription>("/api/admin/transcriptions?mode=overview"),
        readAdminJson<{ local?: CorpusPipeline }>("/api/admin/databooks/status"),
      ]);
      if (!alive) return;
      const errors: string[] = [];
      if (transcription.status === "rejected")
        errors.push(`Transcriptions : ${describeNetworkFailure(transcription.reason).text}`);
      if (pipeline.status === "rejected") errors.push(`Pipeline OCR : ${describeNetworkFailure(pipeline.reason).text}`);
      setState({
        transcription: transcription.status === "fulfilled" ? transcription.value : null,
        pipeline: pipeline.status === "fulfilled" ? (pipeline.value.local ?? null) : null,
        errors,
        loading: false,
      });
    };
    void load();
    return () => {
      alive = false;
    };
  }, []);

  const { transcription, pipeline, errors, loading } = state;
  return (
    <Card className="border-dbz-border bg-dbz-card md:col-span-2 xl:col-span-4">
      <CardHeader>
        <CardTitle className="text-base text-white">État live du corpus</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <p role="status" className="text-sm text-white/50">
            Mesure en cours…
          </p>
        ) : null}
        {errors.map(message => (
          <p key={message} role="alert" className="text-sm text-red-300">
            {message}
          </p>
        ))}
        {!loading && (
          <div className="grid gap-3 sm:grid-cols-3">
            <LiveMetric label="Pages databooks transcrites" value={transcription?.databooks?.transcribedPages ?? "—"} />
            <LiveMetric
              label="Pages manga OCR"
              value={transcription?.manga?.ocrWithText ?? transcription?.manga?.ocrPages ?? "—"}
            />
            <LiveMetric label="Pipeline OCR" value={pipeline?.databooks?.etat ?? pipeline?.manga?.etat ?? "—"} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LiveMetric({ label, value }: { label: string; value: unknown }) {
  const display =
    typeof value === "object" && value !== null
      ? String(
          (value as { status?: unknown; state?: unknown }).status ??
            (value as { state?: unknown }).state ??
            "Disponible",
        )
      : String(value);
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="text-xs text-white/50">{label}</div>
      <div className="mt-1 text-lg font-semibold text-white">{display}</div>
    </div>
  );
}
