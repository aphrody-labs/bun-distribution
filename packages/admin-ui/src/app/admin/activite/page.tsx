"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Eye,
  Users,
  MousePointerClick,
  UserCheck,
  TrendingUp,
  TrendingDown,
  Minus,
  Radio,
  ExternalLink,
  Search,
  FileText,
} from "lucide-react";
import { fmtNum } from "@aphrody/admin-ui/format";
import type {
  AnalyticsOverview,
  AnalyticsPoint,
  AnalyticsRange,
} from "@/lib/analytics";

// `@/lib/analytics` est server-only (driver `postgres`) → on n'en importe que les
// TYPES (`import type`, effacés à la compilation). Les constantes d'affichage sont
// redéclarées ici pour rester côté client.
const RANGES: { id: AnalyticsRange; label: string }[] = [
  { id: "today", label: "Aujourd'hui" },
  { id: "7d", label: "7 jours" },
  { id: "30d", label: "30 jours" },
  { id: "90d", label: "90 jours" },
];

const ENTITY_LABELS: Record<string, string> = {
  character: "Personnage",
  saga: "Saga",
  arc: "Arc",
  movie: "Film",
  episode: "Épisode",
  planet: "Planète",
  technique: "Technique",
  game: "Jeu",
  manga: "Manga",
  race: "Race",
};

type AnalyticsResponse = { ok: true } & AnalyticsOverview;

async function fetchAnalytics(
  range: AnalyticsRange,
): Promise<AnalyticsResponse> {
  const res = await fetch(`/api/analytics?range=${range}`, {
    credentials: "same-origin",
  });
  if (!res.ok) throw new Error(`analytics ${res.status}`);
  return res.json() as Promise<AnalyticsResponse>;
}

function prettyPath(path: string): string {
  if (path === "/" || path === "") return "Accueil";
  const seg = path.replace(/\/+$/, "").split("/").filter(Boolean);
  const last = seg[seg.length - 1] ?? path;
  const decoded = decodeURIComponent(last).replace(/[-_]+/g, " ");
  return decoded.charAt(0).toUpperCase() + decoded.slice(1);
}

export default function ActivitePage() {
  const [range, setRange] = useState<AnalyticsRange>("7d");
  const q = useQuery({
    queryKey: ["analytics", range],
    queryFn: () => fetchAnalytics(range),
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });

  const d = q.data;

  return (
    <div className="space-y-8">
      {/* En-tête + sélecteur de période */}
      <div className="dbz-panel px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-saiyan text-3xl text-dbz-yellow leading-tight flex items-center gap-3">
              <Activity className="h-7 w-7 text-dbz-orange" />
              Activité du site
            </h1>
            <p className="mt-2 text-white/60 text-sm leading-relaxed max-w-xl">
              Audience web (télémétrie first-party, anonymisée & RGPD). Distinct
              des stats du bot. Compteur public non-sensible sur{" "}
              <Link href="/stats" className="text-dbz-orange hover:underline">
                /stats
              </Link>
              .
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <LiveBadge live={d?.live} />
            <div className="flex rounded-lg border border-dbz-border overflow-hidden">
              {RANGES.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setRange(r.id)}
                  className={`px-3 py-1.5 text-[12px] font-display font-semibold transition-colors ${
                    range === r.id
                      ? "bg-dbz-orange text-black"
                      : "bg-dbz-bg/40 text-white/70 hover:text-white hover:bg-white/5"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {q.isError && (
        <div className="card border-dbz-red/40">
          <p className="text-dbz-red text-sm">
            Impossible de charger l'activité. Réessayez dans un instant.
          </p>
        </div>
      )}

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Visites"
          icon={<Eye className="h-4 w-4" />}
          value={d?.totals.pageviews}
          delta={d?.delta.pageviews}
          hint="Pages vues sur la période"
        />
        <KpiCard
          label="Visiteurs uniques"
          icon={<Users className="h-4 w-4" />}
          value={d?.totals.uniqueVisitors}
          delta={d?.delta.uniqueVisitors}
          hint="Pseudonymes distincts (anonId)"
        />
        <KpiCard
          label="Sessions"
          icon={<MousePointerClick className="h-4 w-4" />}
          value={d?.totals.sessions}
          delta={d?.delta.sessions}
          hint="Visites regroupées (~30 min)"
        />
        <KpiCard
          label="Connectés"
          icon={<UserCheck className="h-4 w-4" />}
          value={d?.totals.loggedIn}
          hint="Visiteurs authentifiés Discord"
        />
      </div>

      {/* Série temporelle */}
      <div className="card">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white/70 uppercase tracking-widest text-[11px]">
            Évolution — {RANGES.find((r) => r.id === range)?.label}
          </h2>
          <Legend />
        </div>
        <TrendChart
          points={d?.timeseries ?? []}
          range={range}
          loading={q.isLoading}
        />
      </div>

      {/* Top pages + Sources */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="dbz-panel overflow-hidden">
          <PanelHeader
            icon={<FileText className="h-4 w-4" />}
            title="Pages les plus vues"
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-dbz-border/40 text-[10px] uppercase tracking-widest text-dbz-blue-light">
                <tr>
                  <th className="p-2 text-left font-semibold">Page</th>
                  <th className="p-2 text-right font-semibold w-20">Vues</th>
                  <th className="p-2 text-right font-semibold w-20">
                    Visiteurs
                  </th>
                </tr>
              </thead>
              <tbody>
                {(d?.topPages ?? []).map((p) => (
                  <tr
                    key={p.path}
                    className="border-b border-dbz-border/60 hover:bg-dbz-orange/5"
                  >
                    <td className="p-2 align-top">
                      <Link
                        href={p.path}
                        className="text-white hover:text-dbz-orange"
                      >
                        {prettyPath(p.path)}
                      </Link>
                      <div className="text-[10px] text-white/50 font-mono truncate max-w-[240px]">
                        {p.path}
                      </div>
                    </td>
                    <td className="p-2 text-right font-mono text-dbz-orange align-top">
                      {fmtNum(p.views)}
                    </td>
                    <td className="p-2 text-right font-mono text-white/60 align-top">
                      {fmtNum(p.visitors)}
                    </td>
                  </tr>
                ))}
                {d && d.topPages.length === 0 && <EmptyRow colSpan={3} />}
              </tbody>
            </table>
          </div>
        </div>

        <div className="dbz-panel overflow-hidden">
          <PanelHeader
            icon={<ExternalLink className="h-4 w-4" />}
            title="Sources de trafic"
          />
          <div className="p-4 space-y-2">
            {(d?.sources ?? []).map((s) => {
              const total = d?.sources.reduce((a, x) => a + x.count, 0) || 1;
              const p = Math.round((s.count / total) * 100);
              return (
                <div key={s.source}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-white/80 truncate max-w-[220px]">
                      {s.source === "(direct)"
                        ? "Accès direct / inconnu"
                        : s.source}
                    </span>
                    <span className="font-mono text-white/50 shrink-0">
                      {fmtNum(s.count)} · {p}%
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-dbz-bg overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-dbz-orange to-dbz-yellow rounded-full"
                      style={{ width: `${p}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {d && d.sources.length === 0 && (
              <p className="text-white/50 text-sm py-4 text-center">
                Aucune source sur la période.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Entités + Recherches + Types */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="dbz-panel overflow-hidden">
          <PanelHeader
            icon={<Eye className="h-4 w-4" />}
            title="Fiches wiki populaires"
          />
          <ul className="p-3 space-y-1.5">
            {(d?.topEntities ?? []).map((e) => (
              <li
                key={`${e.entityType}:${e.entityId}`}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span className="truncate">
                  <span className="text-[10px] uppercase tracking-wide text-dbz-blue-light/70 mr-1.5">
                    {ENTITY_LABELS[e.entityType] ?? e.entityType}
                  </span>
                  <span className="text-white/85">
                    {e.name ?? `#${e.entityId}`}
                  </span>
                </span>
                <span className="font-mono text-dbz-orange shrink-0">
                  {fmtNum(e.views)}
                </span>
              </li>
            ))}
            {d && d.topEntities.length === 0 && (
              <li className="text-white/50 text-sm py-3 text-center">
                Aucune vue de fiche.
              </li>
            )}
          </ul>
        </div>

        <div className="dbz-panel overflow-hidden">
          <PanelHeader
            icon={<Search className="h-4 w-4" />}
            title="Recherches populaires"
          />
          <ul className="p-3 space-y-1.5">
            {(d?.topSearches ?? []).map((s) => (
              <li
                key={s.query}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span className="text-white/85 truncate">{s.query}</span>
                <span className="font-mono text-dbz-orange shrink-0">
                  {fmtNum(s.count)}
                </span>
              </li>
            ))}
            {d && d.topSearches.length === 0 && (
              <li className="text-white/50 text-sm py-3 text-center">
                Aucune recherche.
              </li>
            )}
          </ul>
        </div>

        <div className="dbz-panel overflow-hidden">
          <PanelHeader
            icon={<Activity className="h-4 w-4" />}
            title="Types d'événements"
          />
          <div className="p-4 space-y-2">
            {(d?.eventTypes ?? []).map((t) => {
              const total = d?.eventTypes.reduce((a, x) => a + x.count, 0) || 1;
              const p = Math.round((t.count / total) * 100);
              return (
                <div key={t.type}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-white/80 font-mono">{t.type}</span>
                    <span className="font-mono text-white/50">
                      {fmtNum(t.count)}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-dbz-bg overflow-hidden">
                    <div
                      className="h-full bg-dbz-blue-light/70 rounded-full"
                      style={{ width: `${p}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {d && d.eventTypes.length === 0 && (
              <p className="text-white/50 text-sm py-4 text-center">
                Aucun événement.
              </p>
            )}
          </div>
        </div>
      </div>

      <p className="text-[11px] text-white/50 text-center">
        Données anonymisées (jamais d'IP brute) · visiteurs comptés par
        pseudonyme stable · rafraîchi automatiquement toutes les 30 s
        {d
          ? ` · dernière mesure ${new Date(d.generatedAt).toLocaleTimeString("fr-FR")}`
          : ""}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sous-composants
// ---------------------------------------------------------------------------

function KpiCard({
  label,
  icon,
  value,
  delta,
  hint,
}: {
  label: string;
  icon: React.ReactNode;
  value: number | undefined;
  delta?: number | null;
  hint: string;
}) {
  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between text-zinc-400">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-sm font-medium">{label}</h3>
        </div>
        {delta !== undefined && <DeltaBadge delta={delta} />}
      </div>
      <p className="text-3xl font-bold text-brand-400">
        {value === undefined ? "—" : fmtNum(value)}
      </p>
      <p className="mt-2 text-xs text-zinc-500">{hint}</p>
    </div>
  );
}

function DeltaBadge({ delta }: { delta: number | null | undefined }) {
  if (delta === null || delta === undefined) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[11px] text-white/50">
        <Minus className="h-3 w-3" />
      </span>
    );
  }
  const up = delta >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[11px] font-mono ${up ? "text-namek" : "text-dbz-red"}`}
      title="Variation vs période précédente"
    >
      {up ? (
        <TrendingUp className="h-3 w-3" />
      ) : (
        <TrendingDown className="h-3 w-3" />
      )}
      {up ? "+" : ""}
      {delta}%
    </span>
  );
}

function LiveBadge({ live }: { live?: AnalyticsOverview["live"] }) {
  const n = live?.activeVisitors ?? 0;
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border border-namek/40 bg-namek/10 px-3 py-1.5"
      title="Visiteurs actifs sur les 5 dernières minutes"
    >
      <Radio
        className={`h-3.5 w-3.5 text-namek ${n > 0 ? "animate-pulse" : "opacity-50"}`}
      />
      <span className="text-xs text-white/80">
        <span className="font-bold text-namek">{fmtNum(n)}</span> en direct
      </span>
    </span>
  );
}

function PanelHeader({
  icon,
  title,
}: {
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 border-b border-dbz-border bg-dbz-bg/30">
      <span className="text-dbz-orange">{icon}</span>
      <h3 className="text-sm font-display font-semibold text-white/85">
        {title}
      </h3>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-4 text-[10px] text-white/50">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2 w-3 rounded-sm bg-dbz-orange/70" /> Visites
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-0.5 w-3 rounded-sm bg-dbz-blue-light" /> Visiteurs
      </span>
    </div>
  );
}

function EmptyRow({ colSpan }: { colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="p-6 text-center text-white/50 text-sm">
        Aucune donnée sur la période. Les visites se peuplent au fil de la
        navigation (avec consentement analytics).
      </td>
    </tr>
  );
}

// --- Graphe SVG maison (zéro dépendance) ------------------------------------

function fmtBucket(b: string, range: AnalyticsRange): string {
  const [datePart, timePart] = b.split("T");
  if (range === "today") return `${(timePart ?? "00:00").slice(0, 2)}h`;
  const parts = (datePart ?? "").split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}` : (datePart ?? b);
}

function TrendChart({
  points,
  range,
  loading,
}: {
  points: AnalyticsPoint[];
  range: AnalyticsRange;
  loading: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 760;
  const H = 220;
  const padL = 6;
  const padR = 6;
  const padT = 14;
  const padB = 26;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const max = useMemo(
    () => Math.max(1, ...points.map((p) => Math.max(p.pageviews, p.visitors))),
    [points],
  );
  const n = points.length;

  if (n === 0) {
    return (
      <div className="h-[220px] flex items-center justify-center text-sm text-white/50">
        {loading ? "Chargement…" : "Aucune visite enregistrée sur la période."}
      </div>
    );
  }

  const x = (i: number) =>
    padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => padT + innerH - (v / max) * innerH;

  const areaTop = points.map((p, i) => `${x(i)},${y(p.pageviews)}`).join(" ");
  const areaPath = `M ${padL},${padT + innerH} L ${areaTop} L ${x(n - 1)},${padT + innerH} Z`;
  const line = points.map((p, i) => `${x(i)},${y(p.visitors)}`).join(" ");

  // ~6 étiquettes d'axe X réparties.
  const tickEvery = Math.max(1, Math.ceil(n / 6));

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: "auto", aspectRatio: `${W} / ${H}` }}
        role="img"
        aria-label="Évolution des visites et visiteurs"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = (e.clientX - rect.left) / rect.width;
          const idx = Math.round(ratio * (n - 1));
          setHover(Math.min(n - 1, Math.max(0, idx)));
        }}
      >
        <defs>
          <linearGradient id="activite-area" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor="var(--color-dbz-orange)"
              stopOpacity="0.45"
            />
            <stop
              offset="100%"
              stopColor="var(--color-dbz-orange)"
              stopOpacity="0.02"
            />
          </linearGradient>
        </defs>

        {/* Grille horizontale */}
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={padL}
            x2={W - padR}
            y1={padT + innerH * f}
            y2={padT + innerH * f}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={1}
          />
        ))}

        {/* Aire visites */}
        <path d={areaPath} fill="url(#activite-area)" />
        <polyline
          points={areaTop}
          fill="none"
          stroke="var(--color-dbz-orange)"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
        {/* Ligne visiteurs */}
        <polyline
          points={line}
          fill="none"
          stroke="var(--color-dbz-blue-light, #5aa9ff)"
          strokeWidth={1.5}
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
        />

        {/* Curseur de survol */}
        {hover !== null && points[hover] && (
          <>
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={padT}
              y2={padT + innerH}
              stroke="rgba(255,255,255,0.25)"
              strokeWidth={1}
            />
            <circle
              cx={x(hover)}
              cy={y(points[hover].pageviews)}
              r={3.5}
              fill="var(--color-dbz-orange)"
            />
            <circle
              cx={x(hover)}
              cy={y(points[hover].visitors)}
              r={3}
              fill="var(--color-dbz-blue-light, #5aa9ff)"
            />
          </>
        )}

        {/* Étiquettes d'axe X */}
        {points.map((p, i) =>
          i % tickEvery === 0 || i === n - 1 ? (
            <text
              key={p.bucket}
              x={x(i)}
              y={H - 8}
              textAnchor="middle"
              fontSize={10}
              fill="rgba(255,255,255,0.35)"
            >
              {fmtBucket(p.bucket, range)}
            </text>
          ) : null,
        )}
      </svg>

      {/* Tooltip */}
      {hover !== null && points[hover] && (
        <div
          className="pointer-events-none absolute top-2 rounded-md border border-dbz-border bg-dbz-card/95 px-3 py-2 text-[11px] shadow-lg"
          style={{
            left: `calc(${(x(hover) / W) * 100}% )`,
            transform: `translateX(${x(hover) > W / 2 ? "-105%" : "5%"})`,
          }}
        >
          <div className="font-mono text-white/60 mb-1">
            {fmtBucket(points[hover].bucket, range)}
          </div>
          <div className="text-dbz-orange">
            {fmtNum(points[hover].pageviews)} visite
            {points[hover].pageviews > 1 ? "s" : ""}
          </div>
          <div className="text-dbz-blue-light">
            {fmtNum(points[hover].visitors)} visiteur
            {points[hover].visitors > 1 ? "s" : ""}
          </div>
        </div>
      )}
    </div>
  );
}
