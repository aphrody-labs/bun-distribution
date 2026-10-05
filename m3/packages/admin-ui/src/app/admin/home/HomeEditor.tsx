"use client";

/**
 * Éditeur de la page d'accueil (/admin/home).
 *
 * Personnalisation complète du deck cinématique de la home :
 *  - Héro : pool de clips (ordre / ajout / suppression / titre / accroche / ère),
 *    texte d'accroche (lede), libellé + lien du bouton principal, nombre de clips
 *    flottants (desktop / tablette) ;
 *  - Sections : ordre, activation, clip de fond, ère (grade couleur), libellé de
 *    nav, kanji, exergue, titre, sous-titre ; cartes d'action pour « Le terrain » ;
 *
 * Écrit un document JSON unique via PUT /api/home-config (gate admin) qui revalide
 * `/`. Repli : sans config en DB, la home reste identique aux défauts du code.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ChevronBas,
  ChevronHaut,
  Corbeille,
  Enregistrer,
  Film,
  LienExterne,
  Oeil,
  OeilBarre,
  Plus,
  Reinitialiser,
} from "@/components/icones";
import { assetUrl } from "@/lib/assets";
import { DragonBallLoader } from "@/components/DragonBall";
import { MarkdownField } from "@aphrody/admin-ui/components/admin/MarkdownField";
import { ImageField } from "@aphrody/admin-ui/components/admin/ImageField";
import {
  DEFAULT_HOME_CONFIG,
  DEFAULT_PLAY_CARDS,
  ERA_ACCENT,
  ERAS,
  type Era,
  type HomeConfig,
  type HomeBlockHeading,
  type HomeCanonConfig,
  type HomeCatalogueConfig,
  type HomeScene,
  type HomeClip,
  type HomeJourneyConfig,
  type HomeJourneyDestination,
  type HomeSectionConfig,
  type PlayCard,
} from "@/lib/home-scenes";
import { PlainField } from "@/components/editor/PlainField";
import { errorMessageFromBody, seedConfig } from "./home-config-client";

interface LoadResponse {
  config: HomeConfig;
  clips: HomeClip[];
}

async function loadConfig(): Promise<LoadResponse> {
  const r = await fetch("/api/home-config", { credentials: "same-origin" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function saveConfig(patch: HomeConfig): Promise<{ ok: boolean; config: HomeConfig }> {
  const r = await fetch("/api/home-config", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(errorMessageFromBody(t, r.status));
  }
  return r.json();
}

const applyClip = (scene: HomeScene, clip: HomeClip): HomeScene => ({
  ...scene,
  id: clip.id,
  video: clip.video,
  poster: clip.poster ?? undefined,
  image: clip.poster ?? scene.image,
});

const move = <T,>(arr: T[], from: number, dir: -1 | 1): T[] => {
  const to = from + dir;
  if (to < 0 || to >= arr.length) return arr;
  const next = arr.slice();
  [next[from], next[to]] = [next[to], next[from]];
  return next;
};

// ── Sélecteur de clip (grille de vignettes poster) ───────────────────────────
function ClipGrid({
  clips,
  current,
  onPick,
}: {
  clips: HomeClip[];
  current?: string;
  onPick: (c: HomeClip) => void;
}) {
  return (
    <div className="mt-2 grid max-h-64 grid-cols-3 gap-2 overflow-y-auto rounded-lg border border-zinc-800 bg-black/40 p-2 sm:grid-cols-4 lg:grid-cols-6">
      {clips.map((c) => {
        const selected = current === c.video;
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onPick(c)}
            title={c.id}
            className={`group relative aspect-video overflow-hidden rounded border transition-colors ${
              selected
                ? "border-dbz-orange ring-2 ring-dbz-orange/50"
                : "border-zinc-700 hover:border-dbz-orange"
            }`}
          >
            {c.poster ? (
              <img
                src={assetUrl(c.poster)}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover opacity-80 transition-opacity group-hover:opacity-100"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center bg-zinc-900 text-[9px] text-zinc-500">
                <Film className="h-4 w-4" />
              </span>
            )}
            <span className="absolute inset-x-0 bottom-0 truncate bg-black/70 px-1 py-0.5 text-[8px] text-white/80">
              {c.id}
            </span>
          </button>
        );
      })}
      {clips.length === 0 && (
        <p className="col-span-full p-2 text-xs text-zinc-500">Aucun clip disponible.</p>
      )}
    </div>
  );
}

// ── Édition du fond d'une scène (clip + ère) ─────────────────────────────────
function SceneBackground({
  scene,
  clips,
  onChange,
}: {
  scene: HomeScene;
  clips: HomeClip[];
  onChange: (s: HomeScene) => void;
}) {
  const [picking, setPicking] = useState(false);
  const thumb = scene.poster ?? scene.image;
  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="relative h-12 w-20 shrink-0 overflow-hidden rounded border border-zinc-700 bg-black/40">
          {thumb ? (
            <img src={assetUrl(thumb)} alt="" className="h-full w-full object-cover" />
          ) : null}
        </span>
        <div className="min-w-0 flex-1">
          <code className="block truncate text-[11px] text-zinc-400">{scene.video ?? "—"}</code>
          <button
            type="button"
            onClick={() => setPicking((v) => !v)}
            className="btn btn-ghost mt-1 px-2 py-1 text-xs"
          >
            <Film className="mr-1 h-3 w-3" />
            {picking ? "Fermer" : "Changer le clip"}
          </button>
        </div>
        <label className="shrink-0 text-xs text-zinc-400">
          Ère
          <select
            className="input ml-2 py-1 text-xs"
            value={scene.era}
            onChange={(e) => {
              const era = e.target.value as Era;
              onChange({ ...scene, era, accent: ERA_ACCENT[era] });
            }}
          >
            {ERAS.map((era) => (
              <option key={era} value={era}>
                {era}
              </option>
            ))}
          </select>
        </label>
      </div>
      {picking && (
        <ClipGrid
          clips={clips}
          current={scene.video}
          onPick={(c) => {
            onChange(applyClip(scene, c));
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}

// ── Éditeur des cartes du « Terrain » ────────────────────────────────────────
function CardsEditor({
  cards,
  onChange,
}: {
  cards: PlayCard[];
  onChange: (c: PlayCard[]) => void;
}) {
  const set = (i: number, patch: Partial<PlayCard>) =>
    onChange(cards.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div className="mt-3 rounded-lg border border-zinc-800 bg-black/30 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Cartes d'action ({cards.length})
        </h4>
        <button
          type="button"
          onClick={() =>
            onChange([...cards, { href: "/", title: "Nouvelle carte", desc: "", kanji: "◆" }])
          }
          className="btn btn-ghost px-2 py-1 text-xs"
        >
          <Plus className="mr-1 h-3 w-3" /> Ajouter
        </button>
      </div>
      <div className="space-y-2">
        {cards.map((c, i) => (
          <div key={i} className="grid grid-cols-[3rem_1fr_1fr_auto] items-center gap-2">
            <input
              className="input py-1 text-center text-sm"
              value={c.kanji}
              onChange={(e) => set(i, { kanji: e.target.value })}
              title="Kanji"
            />
            <input
              className="input py-1 text-sm"
              value={c.title}
              onChange={(e) => set(i, { title: e.target.value })}
              placeholder="Titre"
            />
            <input
              className="input py-1 text-sm"
              value={c.desc}
              onChange={(e) => set(i, { desc: e.target.value })}
              placeholder="Description"
            />
            <div className="flex items-center gap-1">
              <input
                className="input w-24 py-1 font-mono text-xs"
                value={c.href}
                onChange={(e) => set(i, { href: e.target.value })}
                placeholder="/lien"
              />
              <button
                type="button"
                onClick={() => onChange(cards.filter((_, j) => j !== i))}
                className="btn btn-ghost px-1 text-red-400"
                title="Supprimer"
              >
                <Corbeille className="h-3 w-3" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Carte de section ──────────────────────────────────────────────────────────
function SectionCard({
  section,
  index,
  total,
  clips,
  onChange,
  onMove,
  onDelete,
}: {
  section: HomeSectionConfig;
  index: number;
  total: number;
  clips: HomeClip[];
  onChange: (patch: Partial<HomeSectionConfig>) => void;
  onMove: (dir: -1 | 1) => void;
  onDelete?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const isCustom = section.isCustom === true;
  const gated = !isCustom && (section.id === "personnages" || section.id === "sagas");
  return (
    <div className={`card p-0 ${section.enabled ? "" : "opacity-60"}`}>
      <div className="flex items-center gap-2 p-3">
        <div className="flex flex-col">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            className="text-zinc-500 hover:text-dbz-orange disabled:opacity-30"
            title="Monter"
          >
            <ChevronHaut className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            className="text-zinc-500 hover:text-dbz-orange disabled:opacity-30"
            title="Descendre"
          >
            <ChevronBas className="h-4 w-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-2 text-left"
        >
          <span className="badge font-mono">{section.id}</span>
          <span className="font-semibold">{section.navLabel}</span>
          <span className="text-lg leading-none text-dbz-yellow/70">{section.kanji}</span>
          {gated && (
            <span className="badge badge-warning text-[10px]" title="Route /wiki fermée en bêta">
              route fermée
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => onChange({ enabled: !section.enabled })}
          className={`btn btn-ghost px-2 ${section.enabled ? "text-emerald-400" : "text-zinc-500"}`}
          title={section.enabled ? "Section visible" : "Section masquée"}
        >
          {section.enabled ? <Oeil className="h-4 w-4" /> : <OeilBarre className="h-4 w-4" />}
        </button>
        {isCustom && (
          <button
            type="button"
            onClick={() => onDelete?.()}
            className="btn btn-ghost px-2 text-red-400"
            title="Supprimer cette section"
          >
            <Corbeille className="h-4 w-4" />
          </button>
        )}
        <button type="button" onClick={() => setOpen((v) => !v)} className="btn btn-ghost px-2">
          <ChevronBas className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>

      {open && (
        <div className="space-y-3 border-t border-zinc-800 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-zinc-400">
              Libellé de navigation{isCustom && <span className="ml-0.5 text-red-400">*</span>}
              <input
                className={`input mt-1 ${
                  isCustom && !section.navLabel.trim() ? "border-red-500/60" : ""
                }`}
                value={section.navLabel}
                onChange={(e) => onChange({ navLabel: e.target.value })}
              />
            </label>
            <label className="text-xs text-zinc-400">
              Kanji
              <input
                className="input mt-1"
                value={section.kanji}
                onChange={(e) => onChange({ kanji: e.target.value })}
              />
            </label>
            <label className="text-xs text-zinc-400">
              Exergue (numéro —)
              <input
                className="input mt-1"
                value={section.eyebrow}
                onChange={(e) => onChange({ eyebrow: e.target.value })}
              />
            </label>
            <label className="text-xs text-zinc-400">
              Titre{isCustom && <span className="ml-0.5 text-red-400">*</span>}
              <input
                className={`input mt-1 ${
                  isCustom && !section.title.trim() ? "border-red-500/60" : ""
                }`}
                value={section.title}
                onChange={(e) => onChange({ title: e.target.value })}
              />
            </label>
          </div>
          <label className="block text-xs text-zinc-400">
            Sous-titre
            <PlainField
              value={section.subtitle}
              onChange={(v) => onChange({ subtitle: v })}
              minRows={2}
              maxRows={8}
            />
          </label>
          {isCustom && (
            <div className="block text-xs text-zinc-400">
              Contenu (éditeur riche — mise en forme, images/gifs, embeds, aperçu live ; même moteur
              que le wiki)
              <div className="mt-1">
                <MarkdownField
                  value={section.body ?? ""}
                  onChange={(v) => onChange({ body: v })}
                  preview
                />
              </div>
            </div>
          )}
          <div>
            <span className="text-xs text-zinc-400">Clip de fond</span>
            <SceneBackground
              scene={section.scene}
              clips={clips}
              onChange={(scene) => onChange({ scene })}
            />
          </div>
          {section.id === "play" && (
            <CardsEditor
              cards={section.cards ?? [...DEFAULT_PLAY_CARDS]}
              onChange={(cards) => onChange({ cards })}
            />
          )}
        </div>
      )}
    </div>
  );
}

function BlockHeadingEditor({
  value,
  onChange,
}: {
  value: HomeBlockHeading;
  onChange: (patch: Partial<HomeBlockHeading>) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs text-zinc-400">
        Exergue
        <input
          className="input mt-1"
          value={value.eyebrow}
          onChange={(event) => onChange({ eyebrow: event.target.value })}
        />
      </label>
      <label className="text-xs text-zinc-400">
        Titre
        <input
          className="input mt-1"
          value={value.title}
          onChange={(event) => onChange({ title: event.target.value })}
        />
      </label>
      <label className="text-xs text-zinc-400 sm:col-span-2">
        Sous-titre
        <PlainField
          value={value.subtitle}
          onChange={(subtitle) => onChange({ subtitle })}
          minRows={2}
          maxRows={6}
        />
      </label>
    </div>
  );
}

const CATALOGUE_LABELS: Record<HomeCatalogueConfig["destinations"][number]["href"], string> = {
  "/wiki/episodes": "Épisodes",
  "/wiki/films": "Films",
  "/wiki/manga": "Manga",
  "/wiki/databooks": "Databooks",
};

function CatalogueEditor({
  value,
  onChange,
}: {
  value: HomeCatalogueConfig;
  onChange: (value: HomeCatalogueConfig) => void;
}) {
  return (
    <div className={`card p-4 ${value.enabled ? "" : "opacity-60"}`}>
      <div className="mb-4 flex items-start gap-3">
        <div className="flex-1">
          <h3 className="font-semibold text-dbz-yellow">Catalogue média</h3>
          <p className="text-xs text-zinc-500">Rails alimentés par les données réelles du wiki.</p>
        </div>
        <button
          type="button"
          onClick={() => onChange({ ...value, enabled: !value.enabled })}
          className={`btn btn-ghost px-2 ${value.enabled ? "text-emerald-400" : "text-zinc-500"}`}
          title={value.enabled ? "Bloc visible" : "Bloc masqué"}
        >
          {value.enabled ? <Oeil className="h-4 w-4" /> : <OeilBarre className="h-4 w-4" />}
        </button>
      </div>
      <BlockHeadingEditor value={value} onChange={(patch) => onChange({ ...value, ...patch })} />
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {value.destinations.map((destination, index) => (
          <label
            key={destination.href}
            className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-black/30 p-3 text-sm"
          >
            <input
              type="checkbox"
              checked={destination.enabled}
              onChange={(event) =>
                onChange({
                  ...value,
                  destinations: value.destinations.map((entry, destinationIndex) =>
                    destinationIndex === index
                      ? { ...entry, enabled: event.target.checked }
                      : entry,
                  ),
                })
              }
            />
            <span>{CATALOGUE_LABELS[destination.href]}</span>
            <code className="ml-auto text-[10px] text-zinc-600">{destination.href}</code>
          </label>
        ))}
      </div>
    </div>
  );
}

function JourneyDestinationEditor({
  destination,
  index,
  total,
  onChange,
  onMove,
}: {
  destination: HomeJourneyDestination;
  index: number;
  total: number;
  onChange: (patch: Partial<HomeJourneyDestination>) => void;
  onMove: (direction: -1 | 1) => void;
}) {
  return (
    <div
      className={`rounded-xl border border-zinc-800 bg-black/30 p-3 ${destination.enabled ? "" : "opacity-60"}`}
    >
      <div className="mb-3 flex items-center gap-2">
        <div className="flex flex-col">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            className="text-zinc-500 hover:text-dbz-orange disabled:opacity-30"
            title="Monter"
          >
            <ChevronHaut className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            className="text-zinc-500 hover:text-dbz-orange disabled:opacity-30"
            title="Descendre"
          >
            <ChevronBas className="h-4 w-4" />
          </button>
        </div>
        <strong className="flex-1 text-sm">{destination.label}</strong>
        <code className="text-[10px] text-zinc-500">{destination.href}</code>
        <button
          type="button"
          onClick={() => onChange({ enabled: !destination.enabled })}
          className={`btn btn-ghost px-2 ${destination.enabled ? "text-emerald-400" : "text-zinc-500"}`}
          title={destination.enabled ? "Panneau visible" : "Panneau masqué"}
        >
          {destination.enabled ? <Oeil className="h-4 w-4" /> : <OeilBarre className="h-4 w-4" />}
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs text-zinc-400">
          Titre
          <input
            className="input mt-1"
            value={destination.label}
            onChange={(event) => onChange({ label: event.target.value })}
          />
        </label>
        <label className="text-xs text-zinc-400">
          Exergue
          <input
            className="input mt-1"
            value={destination.kicker}
            onChange={(event) => onChange({ kicker: event.target.value })}
          />
        </label>
        <label className="text-xs text-zinc-400">
          Kanji
          <input
            className="input mt-1"
            value={destination.kanji}
            onChange={(event) => onChange({ kanji: event.target.value })}
          />
        </label>
        <label className="text-xs text-zinc-400">
          Bouton
          <input
            className="input mt-1"
            value={destination.cta}
            onChange={(event) => onChange({ cta: event.target.value })}
          />
        </label>
        <label className="text-xs text-zinc-400 sm:col-span-2">
          Description
          <input
            className="input mt-1"
            value={destination.note}
            onChange={(event) => onChange({ note: event.target.value })}
          />
        </label>
        <div className="sm:col-span-2">
          <p className="mb-1 text-xs text-zinc-400">Image</p>
          <ImageField
            value={destination.image}
            onChange={(image) => onChange({ image })}
            subdir="home"
            column="image de destination"
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          <input
            type="color"
            value={destination.accent}
            onChange={(event) => onChange({ accent: event.target.value })}
          />{" "}
          Accent
        </label>
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          <input
            type="checkbox"
            checked={destination.wide}
            onChange={(event) => onChange({ wide: event.target.checked })}
          />{" "}
          Panneau large
        </label>
      </div>
    </div>
  );
}

function CanonEditor({
  value,
  onChange,
}: {
  value: HomeCanonConfig;
  onChange: (next: HomeCanonConfig) => void;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-zinc-200">Arbitre de canonicité</h4>
          <p className="text-xs text-zinc-500">
            La barre « est-ce canon ? », les cinq rangs et quelques sujets tranchés. La doctrine
            elle-même s'édite dans /admin/ia?tab=canon.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(event) => onChange({ ...value, enabled: event.target.checked })}
          />
          Visible
        </label>
      </div>
      <div className="mt-3">
        <BlockHeadingEditor value={value} onChange={(patch) => onChange({ ...value, ...patch })} />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-zinc-400">
          Sujets tranchés affichés (0-12)
          <input
            className="input mt-1"
            type="number"
            min={0}
            max={12}
            value={value.sujets}
            onChange={(event) => onChange({ ...value, sujets: Number(event.target.value) || 0 })}
          />
        </label>
        <label className="text-xs text-zinc-400">
          Exemple dans la barre
          <input
            className="input mt-1"
            value={value.placeholder}
            onChange={(event) => onChange({ ...value, placeholder: event.target.value })}
          />
        </label>
      </div>
    </div>
  );
}

function JourneyEditor({
  value,
  onChange,
}: {
  value: HomeJourneyConfig;
  onChange: (value: HomeJourneyConfig) => void;
}) {
  return (
    <div className={`card p-4 ${value.enabled ? "" : "opacity-60"}`}>
      <div className="mb-4 flex items-start gap-3">
        <div className="flex-1">
          <h3 className="font-semibold text-dbz-yellow">Menu complet</h3>
          <p className="text-xs text-zinc-500">
            Un panneau éditable pour chaque destination hors catalogue.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange({ ...value, enabled: !value.enabled })}
          className={`btn btn-ghost px-2 ${value.enabled ? "text-emerald-400" : "text-zinc-500"}`}
          title={value.enabled ? "Bloc visible" : "Bloc masqué"}
        >
          {value.enabled ? <Oeil className="h-4 w-4" /> : <OeilBarre className="h-4 w-4" />}
        </button>
      </div>
      <BlockHeadingEditor value={value} onChange={(patch) => onChange({ ...value, ...patch })} />
      <div className="mt-4 space-y-2">
        {value.destinations.map((destination, index) => (
          <JourneyDestinationEditor
            key={destination.href}
            destination={destination}
            index={index}
            total={value.destinations.length}
            onChange={(patch) =>
              onChange({
                ...value,
                destinations: value.destinations.map((entry, destinationIndex) =>
                  destinationIndex === index ? { ...entry, ...patch } : entry,
                ),
              })
            }
            onMove={(direction) =>
              onChange({ ...value, destinations: move(value.destinations, index, direction) })
            }
          />
        ))}
      </div>
    </div>
  );
}

export default function HomeEditor() {
  const query = useQuery({
    queryKey: ["home-config"],
    queryFn: loadConfig,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const [config, setConfig] = useState<HomeConfig | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  useEffect(() => {
    setConfig((cur) => seedConfig(cur, query.data?.config));
  }, [query.data]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const clips = useMemo(() => query.data?.clips ?? [], [query.data]);

  const save = useMutation({
    mutationFn: () => saveConfig(config as HomeConfig),
    onSuccess: (res) => {
      setConfig(res.config);
      setToast({ type: "success", msg: "Home enregistrée. La page publique est mise à jour." });
    },
    onError: (e: Error) => setToast({ type: "error", msg: `Échec : ${e.message}` }),
  });

  if (query.isError && !config) {
    return <div className="text-sm text-red-400">Erreur de chargement : {String(query.error)}</div>;
  }
  if (query.isLoading || !config) {
    return (
      <div className="flex items-center gap-3 text-sm text-zinc-500">
        <DragonBallLoader size={28} /> Chargement de la configuration…
      </div>
    );
  }
  const patchHero = (patch: Partial<HomeConfig["hero"]>) =>
    setConfig((c) => (c ? { ...c, hero: { ...c.hero, ...patch } } : c));
  const patchSection = (i: number, patch: Partial<HomeSectionConfig>) =>
    setConfig((c) =>
      c ? { ...c, sections: c.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) } : c,
    );
  const moveSection = (i: number, dir: -1 | 1) =>
    setConfig((c) => (c ? { ...c, sections: move(c.sections, i, dir) } : c));

  const deleteSection = (i: number) =>
    setConfig((c) => (c ? { ...c, sections: c.sections.filter((_, j) => j !== i) } : c));

  // Enregistrement gardé : une section personnalisée doit avoir un titre ET un
  // libellé de navigation non vides (sinon la home publique affiche un <h2> vide
  // et un point de nav sans libellé → mauvais a11y). Les sections built-in ont
  // toujours des libellés par défaut, donc seules les custom sont vérifiées.
  const handleSave = () => {
    if (!config) return;
    const invalid = config.sections.find(
      (s) => s.isCustom && (!s.title.trim() || !s.navLabel.trim()),
    );
    if (invalid) {
      const name = invalid.navLabel.trim() || invalid.title.trim() || invalid.id;
      setToast({
        type: "error",
        msg: `Section personnalisée « ${name} » : le titre et le libellé de navigation sont obligatoires.`,
      });
      return;
    }
    save.mutate();
  };

  const addSection = () =>
    setConfig((c) => {
      if (!c) return c;
      // Préfixe `custom-` OBLIGATOIRE (garantit qu'il ne collisionne jamais avec
      // un id built-in) + suffixe aléatoire (anti-collision même-ms).
      const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const scene = structuredClone(DEFAULT_HOME_CONFIG.sections[0].scene);
      return {
        ...c,
        sections: [
          ...c.sections,
          {
            id,
            isCustom: true,
            enabled: true,
            navLabel: "Nouvelle section",
            kanji: "◆",
            eyebrow: "Section",
            title: "Nouvelle section",
            subtitle: "",
            body: "",
            scene,
          },
        ],
      };
    });

  const heroScenes = config.hero.scenes;

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
        <div className="flex-1">
          <h2 className="font-saiyan text-lg uppercase text-dbz-orange">Page d'accueil</h2>
          <p className="text-xs text-zinc-400">
            Réorganise les sections, change les clips de fond et le contenu de chaque panneau. Les
            changements s'appliquent au site public après enregistrement.
          </p>
        </div>
        <a href="/" target="_blank" rel="noreferrer" className="btn btn-ghost" title="Voir la home">
          <LienExterne className="mr-1 h-4 w-4" /> Voir
        </a>
        <button
          type="button"
          onClick={() => {
            if (confirm("Réinitialiser toute la home aux valeurs par défaut ?")) {
              setConfig(structuredClone(DEFAULT_HOME_CONFIG));
            }
          }}
          className="btn btn-ghost text-amber-300"
        >
          <Reinitialiser className="mr-1 h-4 w-4" /> Défauts
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={save.isPending}
          className="btn btn-primary"
        >
          <Enregistrer className="mr-1 h-4 w-4" />{" "}
          {save.isPending ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>

      {/* ── Héro ── */}
      <div className="card p-4">
        <h3 className="mb-3 font-semibold text-dbz-yellow">Héro (premier panneau)</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs text-zinc-400 sm:col-span-3">
            Accroche (lede)
            <PlainField
              value={config.hero.lede}
              onChange={(v) => patchHero({ lede: v })}
              minRows={2}
              maxRows={8}
            />
          </label>
          <label className="text-xs text-zinc-400">
            Bouton — libellé
            <input
              className="input mt-1"
              value={config.hero.ctaLabel}
              onChange={(e) => patchHero({ ctaLabel: e.target.value })}
            />
          </label>
          <label className="text-xs text-zinc-400">
            Bouton — lien
            <input
              className="input mt-1 font-mono"
              value={config.hero.ctaHref}
              onChange={(e) => patchHero({ ctaHref: e.target.value })}
            />
          </label>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-zinc-400">
            Clips flottants — desktop (0–8)
            <input
              type="number"
              min={0}
              max={8}
              className="input mt-1"
              value={config.clips.desktop}
              onChange={(e) =>
                setConfig((c) =>
                  c ? { ...c, clips: { ...c.clips, desktop: Number(e.target.value) } } : c,
                )
              }
            />
          </label>
          <label className="text-xs text-zinc-400">
            Clips flottants — tablette (0–6)
            <input
              type="number"
              min={0}
              max={6}
              className="input mt-1"
              value={config.clips.tablet}
              onChange={(e) =>
                setConfig((c) =>
                  c ? { ...c, clips: { ...c.clips, tablet: Number(e.target.value) } } : c,
                )
              }
            />
          </label>
        </div>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
              Pool de scènes / clips ({heroScenes.length})
            </h4>
            <button
              type="button"
              onClick={() =>
                patchHero({
                  scenes: [
                    ...heroScenes,
                    clips[0]
                      ? applyClip(
                          {
                            id: "new",
                            image: "",
                            title: "Nouvelle scène",
                            kicker: "",
                            era: "origin",
                            accent: ERA_ACCENT.origin,
                          },
                          clips[0],
                        )
                      : {
                          id: "new",
                          image: "",
                          title: "Nouvelle scène",
                          kicker: "",
                          era: "origin",
                          accent: ERA_ACCENT.origin,
                        },
                  ],
                })
              }
              className="btn btn-ghost px-2 py-1 text-xs"
            >
              <Plus className="mr-1 h-3 w-3" /> Ajouter une scène
            </button>
          </div>
          <div className="space-y-3">
            {heroScenes.map((sc, i) => (
              <div
                key={`${sc.id}-${i}`}
                className="rounded-lg border border-zinc-800 bg-black/30 p-3"
              >
                <div className="mb-2 flex items-center gap-2">
                  <span className="badge font-mono text-[10px]">#{i + 1}</span>
                  <input
                    className="input flex-1 py-1 text-sm"
                    value={sc.title}
                    onChange={(e) =>
                      patchHero({
                        scenes: heroScenes.map((s, j) =>
                          j === i ? { ...s, title: e.target.value } : s,
                        ),
                      })
                    }
                    placeholder="Titre (légende)"
                  />
                  <input
                    className="input flex-1 py-1 text-sm"
                    value={sc.kicker}
                    onChange={(e) =>
                      patchHero({
                        scenes: heroScenes.map((s, j) =>
                          j === i ? { ...s, kicker: e.target.value } : s,
                        ),
                      })
                    }
                    placeholder="Accroche (légende)"
                  />
                  <button
                    type="button"
                    onClick={() => patchHero({ scenes: move(heroScenes, i, -1) })}
                    disabled={i === 0}
                    className="text-zinc-500 hover:text-dbz-orange disabled:opacity-30"
                  >
                    <ChevronHaut className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => patchHero({ scenes: move(heroScenes, i, 1) })}
                    disabled={i === heroScenes.length - 1}
                    className="text-zinc-500 hover:text-dbz-orange disabled:opacity-30"
                  >
                    <ChevronBas className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => patchHero({ scenes: heroScenes.filter((_, j) => j !== i) })}
                    className="btn btn-ghost px-1 text-red-400"
                    title="Supprimer"
                  >
                    <Corbeille className="h-3 w-3" />
                  </button>
                </div>
                <SceneBackground
                  scene={sc}
                  clips={clips}
                  onChange={(scene) =>
                    patchHero({ scenes: heroScenes.map((s, j) => (j === i ? scene : s)) })
                  }
                />
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-zinc-500">
            Les {config.clips.desktop} premières scènes servent aussi de clips flottants sur
            desktop.
          </p>
        </div>
      </div>

      {/* ── Catalogue et destinations du menu ── */}
      <div className="space-y-2">
        <div>
          <h3 className="font-semibold text-dbz-yellow">Après le deck cinématique</h3>
          <p className="text-xs text-zinc-500">
            Ces blocs prolongent l'accueil avec les rails du catalogue puis une porte d'entrée pour
            chaque page du menu complet. Les routes restent fixes pour éviter les liens cassés.
          </p>
        </div>
        <CatalogueEditor
          value={config.catalogue}
          onChange={(catalogue) =>
            setConfig((current) => (current ? { ...current, catalogue } : current))
          }
        />
        <JourneyEditor
          value={config.journey}
          onChange={(journey) =>
            setConfig((current) => (current ? { ...current, journey } : current))
          }
        />
        <CanonEditor
          value={config.canon}
          onChange={(canon) => setConfig((current) => (current ? { ...current, canon } : current))}
        />
      </div>

      {/* ── Sections ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-dbz-yellow">Sections (ordre du scroll)</h3>
          <button type="button" onClick={addSection} className="btn btn-ghost px-2 py-1 text-xs">
            <Plus className="mr-1 h-3 w-3" /> Ajouter une section
          </button>
        </div>
        {config.sections.map((s, i) => (
          <SectionCard
            key={s.id}
            section={s}
            index={i}
            total={config.sections.length}
            clips={clips}
            onChange={(patch) => patchSection(i, patch)}
            onMove={(dir) => moveSection(i, dir)}
            onDelete={() => deleteSection(i)}
          />
        ))}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={save.isPending}
          className="btn btn-primary"
        >
          <Enregistrer className="mr-1 h-4 w-4" />{" "}
          {save.isPending ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}
