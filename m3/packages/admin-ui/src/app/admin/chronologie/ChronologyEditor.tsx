"use client";

/**
 * Éditeur de la chronologie universelle (/admin/chronologie).
 *
 * La frise publique `/wiki/chronologie` est FIXE : son ordre officiel est décidé
 * ici. On part du dataset brut (tous les épisodes + films + tomes du manga) et on
 * applique une **curation** stockée en DB (`ChronologyConfig`) :
 *   - masquer une entrée,
 *   - forcer son ère (corrige un mauvais bucket auto),
 *   - fixer sa date (comble les trous — ex. DBGT sans date de diffusion),
 *   - surcharger son titre,
 *   - ajouter une note éditoriale,
 *   - réordonner À LA MAIN par glisser-déposer (drag & drop). Glisser une entrée
 *     DANS une autre ère la réaffecte à cette ère → on mélange librement épisodes,
 *     films et tomes de manga (l'ordre de l'ère touchée est épinglé).
 *
 * Sans aucune curation, l'ordre reste identique au tri auto « ère ». L'écriture
 * passe par PUT /api/chronologie-config (gate admin) qui revalide la page publique.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  ExternalLink,
  Film,
  Tv,
  BookOpen,
  GripVertical,
  RotateCcw,
  Save,
  Search,
  Info,
} from "lucide-react";
import { assetUrl } from "@/lib/assets";
import { DragonBallLoader } from "@/components/DragonBall";
import {
  ERA_ORDER,
  ERA_LABELS,
  ERA_ACCENT,
  applyChronology,
  timelineKey,
  DEFAULT_CHRONOLOGY_CONFIG,
  type Era,
  type ChronoOverride,
  type ChronologyConfig,
  type TimelineItem,
  type ResolvedTimelineItem,
} from "@/lib/chronology";
import { PlainField } from "@/components/editor/PlainField";

interface LoadResponse {
  config: ChronologyConfig;
  items: TimelineItem[];
}

async function loadData(): Promise<LoadResponse> {
  const r = await fetch("/api/chronologie-config", { credentials: "same-origin" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function saveData(
  config: ChronologyConfig,
): Promise<{ ok: boolean; config: ChronologyConfig }> {
  const r = await fetch("/api/chronologie-config", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(t || `HTTP ${r.status}`);
  }
  return r.json();
}

const toISO = (sec: number | null | undefined): string =>
  sec ? new Date(sec * 1000).toISOString().slice(0, 10) : "";
const fromISO = (s: string): number | undefined => {
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isNaN(t) ? undefined : Math.floor(t / 1000);
};

type Overrides = Record<string, ChronoOverride>;

export default function ChronologyEditor() {
  const query = useQuery({ queryKey: ["chronology-config"], queryFn: loadData });
  const [overrides, setOverrides] = useState<Overrides>({});
  const [eraOrder, setEraOrder] = useState<Era[]>([...ERA_ORDER]);
  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  // Filtres d'affichage (aides de navigation ; n'altèrent pas la config).
  const [q, setQ] = useState("");
  const [showEpisodes, setShowEpisodes] = useState(true);
  const [showMovies, setShowMovies] = useState(true);
  const [showManga, setShowManga] = useState(true);
  const [showHidden, setShowHidden] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // État du glisser-déposer : entrée saisie + indicateur d'insertion (avant/après
  // une entrée, ou en tête d'une ère quand on survole son en-tête).
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{ key: string; pos: "before" | "after" } | null>(null);
  const [dropEraTop, setDropEraTop] = useState<Era | null>(null);

  useEffect(() => {
    if (query.data) {
      setOverrides(query.data.config.overrides ?? {});
      setEraOrder(query.data.config.eraOrder ?? [...ERA_ORDER]);
    }
  }, [query.data]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const items = useMemo(() => query.data?.items ?? [], [query.data]);
  const rawByKey = useMemo(() => {
    const m = new Map<string, TimelineItem>();
    for (const it of items) m.set(timelineKey(it), it);
    return m;
  }, [items]);

  // Ordre officiel courant : on résout SANS masquer (pour voir/éditer les entrées
  // masquées), puis on style/filtre les masquées côté rendu.
  const resolved: ResolvedTimelineItem[] = useMemo(() => {
    const visibleOverrides: Overrides = {};
    for (const [k, v] of Object.entries(overrides)) {
      const { hidden: _hidden, ...rest } = v;
      visibleOverrides[k] = rest;
    }
    return applyChronology(items, { version: 1, eraOrder, overrides: visibleOverrides });
  }, [items, eraOrder, overrides]);

  const isHidden = useCallback((key: string) => overrides[key]?.hidden === true, [overrides]);

  const stats = useMemo(() => {
    const keys = Object.keys(overrides);
    return {
      total: items.length,
      curated: keys.length,
      hidden: keys.filter((k) => overrides[k]?.hidden).length,
      pinned: keys.filter((k) => typeof overrides[k]?.sort === "number").length,
    };
  }, [overrides, items.length]);

  // Réordonnancement fiable uniquement quand aucun filtre ne cache d'entrées
  // (sinon un glisser-déposer sauterait des voisins invisibles).
  const reorderEnabled = !q.trim() && showEpisodes && showMovies && showManga && showHidden;

  // ── Mutations de la config ────────────────────────────────────────────────
  const patchOverride = useCallback((key: string, patch: Partial<ChronoOverride>) => {
    setOverrides((prev) => {
      const cur: ChronoOverride = { ...prev[key] };
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === null || v === "") {
          delete (cur as Record<string, unknown>)[k];
        } else {
          (cur as Record<string, unknown>)[k] = v;
        }
      }
      const next = { ...prev };
      if (Object.keys(cur).length === 0) delete next[key];
      else next[key] = cur;
      return next;
    });
  }, []);

  const toggleHide = useCallback((key: string) => {
    setOverrides((prev) => {
      const cur: ChronoOverride = { ...prev[key] };
      if (cur.hidden) delete cur.hidden;
      else cur.hidden = true;
      const next = { ...prev };
      if (Object.keys(cur).length === 0) delete next[key];
      else next[key] = cur;
      return next;
    });
  }, []);

  const setEra = useCallback(
    (key: string, era: Era) => {
      const raw = rawByKey.get(key);
      setOverrides((prev) => {
        const cur: ChronoOverride = { ...prev[key] };
        // Changer d'ère invalide le rang manuel (il référait l'ancienne ère).
        delete cur.sort;
        if (raw && era === raw.era) delete cur.era;
        else cur.era = era;
        const next = { ...prev };
        if (Object.keys(cur).length === 0) delete next[key];
        else next[key] = cur;
        return next;
      });
    },
    [rawByKey],
  );

  // Monter/descendre au sein d'une ère → épingle l'ordre de TOUTE l'ère (chaque
  // entrée reçoit un rang `sort` = sa position). L'ère devient ainsi figée.
  const move = useCallback(
    (key: string, dir: -1 | 1) => {
      const target = resolved.find((r) => timelineKey(r) === key);
      if (!target) return;
      const groupKeys = resolved.filter((r) => r.era === target.era).map(timelineKey);
      const idx = groupKeys.indexOf(key);
      const j = idx + dir;
      if (j < 0 || j >= groupKeys.length) return;
      [groupKeys[idx], groupKeys[j]] = [groupKeys[j]!, groupKeys[idx]!];
      setOverrides((prev) => {
        const next = { ...prev };
        groupKeys.forEach((k, i) => {
          next[k] = { ...next[k], sort: i };
        });
        return next;
      });
    },
    [resolved],
  );

  // Cœur du glisser-déposer : place `draggedKey` dans l'ère `targetEra` à la
  // position `insertAt`. Épingle l'ordre de l'ère cible (chaque entrée reçoit son
  // rang `sort`) ; si l'entrée change d'ère, on pose l'override d'ère (ou on le
  // retire si on revient à l'ère auto) et on ré-épingle l'ère quittée. C'est ce
  // qui permet de MÉLANGER librement épisodes / films / tomes de manga.
  const applyReorder = useCallback(
    (draggedKey: string, targetEra: Era, insertAt: number) => {
      const dragged = resolved.find((r) => timelineKey(r) === draggedKey);
      if (!dragged) return;
      const sourceEra = dragged.era;
      const targetGroup = resolved
        .filter((r) => r.era === targetEra)
        .map(timelineKey)
        .filter((k) => k !== draggedKey);
      const at = Math.max(0, Math.min(insertAt, targetGroup.length));
      targetGroup.splice(at, 0, draggedKey);

      setOverrides((prev) => {
        const next: Overrides = { ...prev };
        const setField = (k: string, patch: Partial<ChronoOverride>) => {
          const cur: ChronoOverride = { ...next[k], ...patch };
          for (const kk of Object.keys(cur) as (keyof ChronoOverride)[]) {
            if (cur[kk] === undefined) delete cur[kk];
          }
          next[k] = cur;
        };
        // Épingle l'ère cible dans son nouvel ordre.
        targetGroup.forEach((k, i) => setField(k, { sort: i }));
        // Override d'ère sur l'entrée déplacée (retiré si retour à l'ère auto).
        const rawDragged = rawByKey.get(draggedKey);
        if (rawDragged && targetEra === rawDragged.era) {
          if (next[draggedKey]) delete next[draggedKey].era;
        } else {
          setField(draggedKey, { era: targetEra });
        }
        // Ré-épingle l'ère quittée pour préserver son ordre visuel.
        if (sourceEra !== targetEra) {
          resolved
            .filter((r) => r.era === sourceEra)
            .map(timelineKey)
            .filter((k) => k !== draggedKey)
            .forEach((k, i) => setField(k, { sort: i }));
        }
        for (const k of Object.keys(next)) {
          if (Object.keys(next[k]!).length === 0) delete next[k];
        }
        return next;
      });
    },
    [resolved, rawByKey],
  );

  // ── Handlers glisser-déposer natifs (cf. TierlistEditor : zéro dépendance) ──
  const onDragStartRow = useCallback(
    (key: string) => (e: React.DragEvent) => {
      if (!reorderEnabled) return;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", key);
      setDragKey(key);
    },
    [reorderEnabled],
  );
  const onDragEnd = useCallback(() => {
    setDragKey(null);
    setDropHint(null);
    setDropEraTop(null);
  }, []);
  const onDragOverRow = useCallback(
    (key: string) => (e: React.DragEvent) => {
      if (!dragKey || dragKey === key) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const r = e.currentTarget.getBoundingClientRect();
      const pos: "before" | "after" = e.clientY - r.top < r.height / 2 ? "before" : "after";
      setDropEraTop(null);
      setDropHint((h) => (h && h.key === key && h.pos === pos ? h : { key, pos }));
    },
    [dragKey],
  );
  const onDropRow = useCallback(
    (key: string, era: Era) => (e: React.DragEvent) => {
      e.preventDefault();
      const dropped = dragKey;
      if (!dropped || dropped === key) return onDragEnd();
      const group = resolved
        .filter((r) => r.era === era)
        .map(timelineKey)
        .filter((k) => k !== dropped);
      const idx = group.indexOf(key);
      const pos = dropHint?.key === key ? dropHint.pos : "before";
      const insertAt = idx < 0 ? group.length : pos === "after" ? idx + 1 : idx;
      applyReorder(dropped, era, insertAt);
      onDragEnd();
    },
    [dragKey, dropHint, resolved, applyReorder, onDragEnd],
  );
  const onDragOverEra = useCallback(
    (era: Era) => (e: React.DragEvent) => {
      if (!dragKey) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDropHint(null);
      setDropEraTop(era);
    },
    [dragKey],
  );
  const onDropEra = useCallback(
    (era: Era) => (e: React.DragEvent) => {
      e.preventDefault();
      const dropped = dragKey;
      if (!dropped) return onDragEnd();
      applyReorder(dropped, era, 0);
      onDragEnd();
    },
    [dragKey, applyReorder, onDragEnd],
  );

  const resetEntry = useCallback((key: string) => {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const moveEra = (era: Era, dir: -1 | 1) => {
    setEraOrder((prev) => {
      const i = prev.indexOf(era);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  };

  const save = useMutation({
    mutationFn: () => saveData({ version: 1, eraOrder, overrides }),
    onSuccess: (res) => {
      setOverrides(res.config.overrides ?? {});
      setEraOrder(res.config.eraOrder ?? [...ERA_ORDER]);
      setToast({ type: "success", msg: "Chronologie enregistrée. La page publique est à jour." });
    },
    onError: (e: Error) => setToast({ type: "error", msg: `Échec : ${e.message}` }),
  });

  // ── Rendu ─────────────────────────────────────────────────────────────────
  if (query.isLoading) {
    return (
      <div className="flex items-center gap-3 text-sm text-zinc-500">
        <DragonBallLoader size={28} /> Chargement de la chronologie…
      </div>
    );
  }
  if (query.isError) {
    return <div className="text-sm text-red-400">Erreur de chargement : {String(query.error)}</div>;
  }

  const needle = q.trim().toLowerCase();
  const rowVisible = (it: ResolvedTimelineItem): boolean => {
    if (it.kind === "episode" && !showEpisodes) return false;
    if (it.kind === "movie" && !showMovies) return false;
    if (it.kind === "manga" && !showManga) return false;
    if (!showHidden && isHidden(timelineKey(it))) return false;
    if (needle) {
      const hay = `${it.title} ${it.titleJa ?? ""} ${it.series}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  };

  // Groupé par ère (l'ordre résolu est déjà contigu par ère).
  const rows: React.ReactNode[] = [];
  let lastEra: Era | null = null;
  let eraIndex = 0;
  for (const it of resolved) {
    const key = timelineKey(it);
    if (it.era !== lastEra) {
      lastEra = it.era;
      eraIndex = 0;
      const group = resolved.filter((x) => x.era === it.era);
      const anyVisible = group.some(rowVisible);
      if (anyVisible) {
        rows.push(
          <EraHeader
            key={`h:${it.era}`}
            era={it.era}
            count={group.length}
            pos={eraOrder.indexOf(it.era)}
            total={eraOrder.length}
            onMove={(dir) => moveEra(it.era, dir)}
            isDropTarget={reorderEnabled && dropEraTop === it.era}
            onDragOver={reorderEnabled ? onDragOverEra(it.era) : undefined}
            onDrop={reorderEnabled ? onDropEra(it.era) : undefined}
          />,
        );
      }
    }
    const posInEra = eraIndex++;
    if (!rowVisible(it)) continue;
    rows.push(
      <EntryRow
        key={key}
        it={it}
        raw={rawByKey.get(key)}
        override={overrides[key]}
        hidden={isHidden(key)}
        expanded={expanded.has(key)}
        posInEra={posInEra}
        reorderEnabled={reorderEnabled}
        dragging={dragKey === key}
        dropBefore={dropHint?.key === key && dropHint.pos === "before"}
        dropAfter={dropHint?.key === key && dropHint.pos === "after"}
        onDragStart={onDragStartRow(key)}
        onDragEnd={onDragEnd}
        onDragOver={onDragOverRow(key)}
        onDrop={onDropRow(key, it.era)}
        onToggleExpand={() =>
          setExpanded((prev) => {
            const n = new Set(prev);
            if (n.has(key)) n.delete(key);
            else n.add(key);
            return n;
          })
        }
        onMove={(dir) => move(key, dir)}
        onToggleHide={() => toggleHide(key)}
        onSetEra={(era) => setEra(key, era)}
        onSet={(patch) => patchOverride(key, patch)}
        onReset={() => resetEntry(key)}
      />,
    );
  }

  const visibleCount = resolved.filter(rowVisible).length;

  return (
    <div className="space-y-4">
      {toast && (
        <div
          className={`fixed right-4 top-4 z-50 rounded-lg border px-4 py-3 text-sm shadow-xl ${
            toast.type === "success"
              ? "border-green-500/50 bg-dbz-card text-green-300"
              : "border-red-500/50 bg-dbz-card text-red-300"
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Barre d'action */}
      <div className="dbz-panel flex flex-wrap items-center gap-3 p-4">
        <div className="flex-1 min-w-[240px]">
          <h2 className="font-saiyan text-lg uppercase text-dbz-orange">Chronologie universelle</h2>
          <p className="text-xs text-zinc-400">
            Ordre officiel de <strong className="text-white">{stats.total}</strong> entrées ·{" "}
            {stats.curated} curatée{stats.curated > 1 ? "s" : ""} · {stats.hidden} masquée
            {stats.hidden > 1 ? "s" : ""} · {stats.pinned} épinglée{stats.pinned > 1 ? "s" : ""}.
            Les changements s'appliquent au public après enregistrement.
          </p>
        </div>
        <a
          href="/wiki/chronologie"
          target="_blank"
          rel="noreferrer"
          className="btn btn-ghost"
          title="Voir la frise publique"
        >
          <ExternalLink className="mr-1 h-4 w-4" /> Voir
        </a>
        <button
          type="button"
          onClick={() => {
            if (confirm("Réinitialiser TOUTE la curation (ordre, masquages, dates, notes) ?")) {
              setOverrides({});
              setEraOrder([...DEFAULT_CHRONOLOGY_CONFIG.eraOrder]);
            }
          }}
          className="btn btn-ghost text-amber-300"
        >
          <RotateCcw className="mr-1 h-4 w-4" /> Tout auto
        </button>
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="btn btn-primary"
        >
          <Save className="mr-1 h-4 w-4" /> {save.isPending ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>

      {/* Filtres */}
      <div className="card flex flex-wrap items-center gap-3 p-3">
        <div className="flex rounded-lg border border-zinc-700 overflow-hidden">
          <FilterToggle
            icon={<Tv className="h-3.5 w-3.5" />}
            label="Épisodes"
            on={showEpisodes}
            onClick={() => setShowEpisodes((v) => !v)}
          />
          <FilterToggle
            icon={<Film className="h-3.5 w-3.5" />}
            label="Films"
            on={showMovies}
            onClick={() => setShowMovies((v) => !v)}
          />
          <FilterToggle
            icon={<BookOpen className="h-3.5 w-3.5" />}
            label="Manga"
            on={showManga}
            onClick={() => setShowManga((v) => !v)}
          />
        </div>
        <button
          type="button"
          onClick={() => setShowHidden((v) => !v)}
          className={`btn btn-ghost px-2 ${showHidden ? "text-zinc-300" : "text-zinc-500"}`}
          title={showHidden ? "Masquées affichées" : "Masquées cachées"}
        >
          {showHidden ? <Eye className="mr-1 h-4 w-4" /> : <EyeOff className="mr-1 h-4 w-4" />}
          Masquées
        </button>
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher un titre / une série…"
            className="input w-full pl-9"
          />
        </div>
        <span className="text-xs text-zinc-500">{visibleCount} affichée(s)</span>
      </div>

      {reorderEnabled ? (
        <p className="flex items-center gap-2 rounded-lg border border-dbz-blue-light/25 bg-dbz-blue-light/5 px-3 py-2 text-[12px] text-dbz-blue-light/90">
          <GripVertical className="h-4 w-4 shrink-0" />
          Glisse-dépose une entrée par sa poignée pour la réordonner. Dépose-la dans une AUTRE ère
          (ou sur son en-tête) pour l'y déplacer — épisodes, films et tomes se mélangent librement.
        </p>
      ) : (
        <p className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[12px] text-amber-300/90">
          <Info className="h-4 w-4 shrink-0" />
          Le glisser-déposer est désactivé tant qu'un filtre masque des entrées. Réinitialise la
          recherche et affiche épisodes + films + manga + masquées pour réordonner.
        </p>
      )}

      <div className="space-y-1">{rows}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function FilterToggle({
  icon,
  label,
  on,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold transition-colors ${
        on ? "bg-dbz-orange text-black" : "bg-black/30 text-zinc-400 hover:text-white"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function EraHeader({
  era,
  count,
  pos,
  total,
  onMove,
  isDropTarget,
  onDragOver,
  onDrop,
}: {
  era: Era;
  count: number;
  pos: number;
  total: number;
  onMove: (dir: -1 | 1) => void;
  isDropTarget?: boolean;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
}) {
  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`flex items-center gap-3 rounded-md pt-5 pb-1 transition-colors ${
        isDropTarget ? "bg-white/[0.04] ring-1 ring-inset" : ""
      }`}
      style={isDropTarget ? { boxShadow: `inset 0 -2px 0 0 ${ERA_ACCENT[era]}` } : undefined}
    >
      <span className="h-4 w-1.5 rounded-full" style={{ backgroundColor: ERA_ACCENT[era] }} />
      <h3
        className="font-saiyan text-xl uppercase tracking-wide"
        style={{ color: ERA_ACCENT[era] }}
      >
        {ERA_LABELS[era]}
      </h3>
      <span className="text-[11px] text-zinc-500 font-mono">{count}</span>
      {isDropTarget && (
        <span className="text-[10px] font-semibold uppercase" style={{ color: ERA_ACCENT[era] }}>
          ↓ déposer en tête
        </span>
      )}
      <span className="flex-1 h-px" style={{ backgroundColor: `${ERA_ACCENT[era]}33` }} />
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => onMove(-1)}
          disabled={pos <= 0}
          className="text-zinc-500 hover:text-dbz-orange disabled:opacity-25"
          title="Monter l'ère"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onMove(1)}
          disabled={pos >= total - 1}
          className="text-zinc-500 hover:text-dbz-orange disabled:opacity-25"
          title="Descendre l'ère"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function EntryRow({
  it,
  raw,
  override,
  hidden,
  expanded,
  posInEra,
  reorderEnabled,
  dragging,
  dropBefore,
  dropAfter,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onToggleExpand,
  onMove,
  onToggleHide,
  onSetEra,
  onSet,
  onReset,
}: {
  it: ResolvedTimelineItem;
  raw: TimelineItem | undefined;
  override: ChronoOverride | undefined;
  hidden: boolean;
  expanded: boolean;
  posInEra: number;
  reorderEnabled: boolean;
  dragging: boolean;
  dropBefore: boolean;
  dropAfter: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onToggleExpand: () => void;
  onMove: (dir: -1 | 1) => void;
  onToggleHide: () => void;
  onSetEra: (era: Era) => void;
  onSet: (patch: Partial<ChronoOverride>) => void;
  onReset: () => void;
}) {
  const isMovie = it.kind === "movie";
  const isManga = it.kind === "manga";
  const accent = ERA_ACCENT[it.era];
  const curated = override && Object.keys(override).length > 0;

  // Brouillons locaux pour titre/note → commit onBlur (évite de recalculer l'ordre
  // à chaque frappe sur ~750 lignes).
  const [titleDraft, setTitleDraft] = useState(override?.title ?? "");
  const [noteDraft, setNoteDraft] = useState(override?.note ?? "");
  useEffect(() => setTitleDraft(override?.title ?? ""), [override?.title]);
  useEffect(() => setNoteDraft(override?.note ?? ""), [override?.note]);

  return (
    <div
      onDragOver={reorderEnabled ? onDragOver : undefined}
      onDrop={reorderEnabled ? onDrop : undefined}
      className={`relative rounded-lg border transition-colors ${
        dragging
          ? "opacity-40 border-dbz-orange"
          : hidden
            ? "border-zinc-800 bg-black/20 opacity-50"
            : isMovie
              ? "border-dbz-orange/25 bg-dbz-orange/[0.05]"
              : isManga
                ? "border-pink-400/25 bg-pink-500/[0.05]"
                : "border-zinc-800 bg-white/[0.02]"
      }`}
      style={{ borderLeftColor: accent, borderLeftWidth: 3 }}
    >
      {/* Indicateurs d'insertion du glisser-déposer */}
      {dropBefore && (
        <span
          className="pointer-events-none absolute -top-[3px] left-0 right-0 z-10 h-[3px] rounded-full"
          style={{ backgroundColor: accent }}
        />
      )}
      {dropAfter && (
        <span
          className="pointer-events-none absolute -bottom-[3px] left-0 right-0 z-10 h-[3px] rounded-full"
          style={{ backgroundColor: accent }}
        />
      )}
      <div className="flex items-center gap-3 px-3 py-2">
        {/* Poignée de glisser-déposer + réordonnancement fin */}
        <div className="flex items-center">
          <span
            draggable={reorderEnabled}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            className={`shrink-0 ${
              reorderEnabled
                ? "cursor-grab text-zinc-600 hover:text-dbz-orange active:cursor-grabbing"
                : "cursor-not-allowed text-zinc-800"
            }`}
            title={
              reorderEnabled ? "Glisser pour réordonner / mélanger" : "Désactivé (filtres actifs)"
            }
            aria-label="Glisser pour réordonner"
          >
            <GripVertical className="h-5 w-5" />
          </span>
          <div className="flex flex-col">
            <button
              type="button"
              onClick={() => onMove(-1)}
              disabled={!reorderEnabled || posInEra === 0}
              className="text-zinc-500 hover:text-dbz-orange disabled:opacity-25"
              title="Monter"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onMove(1)}
              disabled={!reorderEnabled}
              className="text-zinc-500 hover:text-dbz-orange disabled:opacity-25"
              title="Descendre"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Marqueur : vignette d'épisode, couverture (film/tome) ou pastille numéro */}
        <div className="flex w-16 shrink-0 items-center justify-center">
          {isMovie || isManga ? (
            it.image ? (
              <img
                src={assetUrl(it.image)}
                alt=""
                loading="lazy"
                className="h-12 w-8 rounded object-cover"
              />
            ) : (
              <span
                className={`flex h-12 w-8 items-center justify-center rounded ${
                  isManga ? "bg-pink-500/15 text-pink-300" : "bg-dbz-orange/15 text-dbz-orange"
                }`}
              >
                {isManga ? <BookOpen className="h-4 w-4" /> : <Film className="h-4 w-4" />}
              </span>
            )
          ) : it.image ? (
            <div className="relative h-9 w-16 overflow-hidden rounded bg-black/40">
              <img
                src={assetUrl(it.image)}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
              />
              <span
                className="absolute left-0.5 top-0.5 rounded bg-black/75 px-1 text-[9px] font-mono font-bold"
                style={{ color: accent }}
              >
                {it.number ?? "?"}
              </span>
            </div>
          ) : (
            <span
              className="flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-mono font-bold text-black"
              style={{ backgroundColor: accent }}
              title={`${it.series} — épisode`}
            >
              {it.number ?? "?"}
            </span>
          )}
        </div>

        {/* Titre + méta */}
        <button type="button" onClick={onToggleExpand} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-2">
            {isMovie && (
              <span className="rounded bg-dbz-orange px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-black">
                Film
              </span>
            )}
            {isManga && (
              <span className="rounded bg-pink-500 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-black">
                Tome {it.number ?? "?"}
              </span>
            )}
            <span className="truncate font-display font-semibold text-[13px] text-white">
              {it.title || "(sans titre)"}
            </span>
            {curated && (
              <span className="rounded bg-dbz-blue-light/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-dbz-blue-light">
                curatée
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-mono">
            <span>{it.series}</span>
            {it.date && <span>{toISO(it.date)}</span>}
            {it.note && <span className="text-dbz-yellow/70 not-italic normal-case">note</span>}
          </div>
        </button>

        {/* Ère */}
        <select
          value={it.era}
          onChange={(e) => onSetEra(e.target.value as Era)}
          className="input py-1 text-xs w-[7.5rem]"
          title="Ère"
        >
          {ERA_ORDER.map((era) => (
            <option key={era} value={era}>
              {ERA_LABELS[era]}
            </option>
          ))}
        </select>

        {/* Masquer */}
        <button
          type="button"
          onClick={onToggleHide}
          className={`btn btn-ghost px-2 ${hidden ? "text-zinc-500" : "text-emerald-400"}`}
          title={hidden ? "Entrée masquée — réafficher" : "Masquer de la frise publique"}
        >
          {hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>

        <button
          type="button"
          onClick={onToggleExpand}
          className="btn btn-ghost px-2"
          aria-label="Déplier ou replier cette ère"
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      </div>

      {expanded && (
        <div className="grid gap-3 border-t border-zinc-800 p-3 sm:grid-cols-2">
          <label className="text-xs text-zinc-400">
            Date de diffusion / sortie
            <input
              type="date"
              value={toISO(it.date)}
              onChange={(e) =>
                onSet({ date: e.target.value ? fromISO(e.target.value) : undefined })
              }
              className="input mt-1"
            />
            {raw?.date != null && (
              <span className="mt-0.5 block text-[10px] text-zinc-600">
                auto : {toISO(raw.date)}
              </span>
            )}
          </label>
          <label className="text-xs text-zinc-400">
            Titre (surcharge)
            <input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => {
                const v = titleDraft.trim();
                onSet({ title: v && v !== raw?.title ? v : undefined });
              }}
              placeholder={raw?.title ?? "Titre"}
              className="input mt-1"
            />
          </label>
          <label className="text-xs text-zinc-400 sm:col-span-2">
            Note éditoriale (affichée sous l'entrée)
            <PlainField
              className="mt-1"
              value={noteDraft}
              onChange={setNoteDraft}
              minRows={2}
              maxRows={8}
              placeholder="Ex. « À regarder après le film 3 », contexte canon/filler…"
            />
          </label>
          <div className="sm:col-span-2 flex items-center justify-between">
            <span className="text-[10px] text-zinc-600 font-mono">{timelineKey(it)}</span>
            <div className="flex items-center gap-2">
              <a
                href={it.href}
                target="_blank"
                rel="noreferrer"
                className="btn btn-ghost px-2 py-1 text-xs"
              >
                <ExternalLink className="mr-1 h-3 w-3" /> Fiche
              </a>
              <button
                type="button"
                onClick={onReset}
                disabled={!curated}
                className="btn btn-ghost px-2 py-1 text-xs text-amber-300 disabled:opacity-30"
                title="Réinitialiser cette entrée (retour à l'auto)"
              >
                <RotateCcw className="mr-1 h-3 w-3" /> Réinitialiser
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
