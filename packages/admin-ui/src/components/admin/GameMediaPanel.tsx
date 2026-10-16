"use client";

/**
 * Panneau studio : galerie médias d'un jeu (jsonb `media`).
 * Chaque slot = type (image | youtube) + url + légende optionnelle.
 * Save dédiée (jsonb exclu de SmartField / buildSubmitBody).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Chargement,
  ChevronBas,
  ChevronHaut,
  Corbeille,
  Enregistrer,
  Film,
  Illustration,
  Plus,
} from "@shenron/ui/icones";
import { useEffect, useMemo, useRef, useState } from "react";
import { ImageField } from "@aphrody/admin-ui/components/admin/ImageField";
import { apiAt } from "@aphrody/admin-ui/client";
import { extractYoutubeId, youtubeEmbedUrl, youtubeThumbUrl } from "../../lib/youtube";
import { crudBase } from "@/lib/wiki-tables";

export type GameMediaDraft = {
  _key: string;
  type: "image" | "youtube";
  url: string;
  caption: string;
};

let keySeq = 0;
function newKey(): string {
  keySeq += 1;
  return `gm-${Date.now().toString(36)}-${keySeq}`;
}

/** Nettoie une URL YouTube → `https://youtu.be/<id>` (retire ?si= / tracking). */
function normalizeYoutubeUrl(raw: string): string {
  const id = extractYoutubeId(raw);
  return id ? `https://youtu.be/${id}` : raw.trim();
}

function normalizeMedia(raw: unknown): GameMediaDraft[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
    .map(p => {
      const type = p.type === "youtube" ? "youtube" : "image";
      const url = typeof p.url === "string" ? p.url : "";
      return {
        _key: newKey(),
        type,
        // Normalise les liens YouTube déjà en base (query tracking, etc.).
        url: type === "youtube" && url ? normalizeYoutubeUrl(url) : url,
        caption: typeof p.caption === "string" ? p.caption : "",
      };
    });
}

function snapshot(items: GameMediaDraft[]): string {
  return JSON.stringify(
    items.map(p => ({
      type: p.type,
      url: p.url.trim(),
      caption: p.caption.trim() || null,
    })),
  );
}

function emptyItem(type: "image" | "youtube" = "image"): GameMediaDraft {
  return { _key: newKey(), type, url: "", caption: "" };
}

export function GameMediaPanel({ gameId }: { gameId: string }) {
  const client = apiAt(crudBase("db_games"));
  const qc = useQueryClient();
  const [items, setItems] = useState<GameMediaDraft[]>([]);
  const [savedSnap, setSavedSnap] = useState("[]");
  const [toast, setToast] = useState<string | null>(null);

  // Pas de rafraîchissement en arrière-plan : le panneau est l'état maître une
  // fois hydraté. Avec les défauts du dashboard (staleTime 30 s + refetch au
  // retour de focus), un aller-retour vers un autre onglet ré-hydratait la liste
  // et effaçait sans un mot les médias ajoutés depuis le dernier enregistrement.
  const row = useQuery({
    queryKey: ["wiki-studio", "db_games", gameId, "media"],
    queryFn: () => client.get<Record<string, unknown>>(`/db_games/${encodeURIComponent(gameId)}`),
    refetchOnWindowFocus: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const hydrateId = useRef<string | null>(null);
  useEffect(() => {
    if (!row.data || hydrateId.current === gameId) return;
    hydrateId.current = gameId;
    const next = normalizeMedia(row.data.media);
    setItems(next);
    setSavedSnap(snapshot(next));
  }, [row.data, gameId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  const dirty = useMemo(() => snapshot(items) !== savedSnap, [items, savedSnap]);
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const save = useMutation({
    mutationFn: async () => {
      const cleaned = items
        .map((p, idx) => {
          let url = p.url.trim();
          if (!url) return null;
          // YouTube : refuse les liens invalides + stocke l'URL canonique.
          if (p.type === "youtube") {
            const id = extractYoutubeId(url);
            if (!id) {
              throw new Error(`Lien YouTube invalide (#${idx + 1}). Colle un watch?v= ou youtu.be/…`);
            }
            url = `https://youtu.be/${id}`;
          }
          const out: {
            type: "image" | "youtube";
            url: string;
            caption?: string;
          } = {
            type: p.type,
            url,
          };
          const cap = p.caption.trim();
          if (cap) out.caption = cap;
          return out;
        })
        .filter((x): x is NonNullable<typeof x> => x != null);
      return client.put(`/db_games/${encodeURIComponent(gameId)}`, {
        media: cleaned,
      });
    },
    onSuccess: () => {
      // Re-normalise l'état local (URLs YouTube nettoyées) pour coller au save.
      // Le calcul est fait ICI et non dans l'updater de `setItems` : un updater
      // doit rester pur, et `setSavedSnap` y était un effet de bord que React
      // peut rejouer.
      const next = items.map(p =>
        p.type === "youtube" && p.url.trim() ? { ...p, url: normalizeYoutubeUrl(p.url) } : p,
      );
      setItems(next);
      setSavedSnap(snapshot(next));
      qc.invalidateQueries({ queryKey: ["wiki-studio", "db_games", gameId] });
      setToast("Galerie enregistrée — cache public revalidé.");
    },
    onError: (e: Error) => setToast(`Erreur : ${e.message}`),
  });

  const update = (i: number, patch: Partial<GameMediaDraft>) =>
    setItems(arr => arr.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  /** Change le type sans perdre l'URL (évite le wipe accidentel au clic). */
  const setType = (i: number, type: "image" | "youtube") => {
    setItems(arr =>
      arr.map((p, j) => {
        if (j !== i || p.type === type) return p;
        // Si on repasse en youtube et l'URL ressemble déjà à un lien YT, on normalise.
        if (type === "youtube" && p.url.trim() && extractYoutubeId(p.url)) {
          return { ...p, type, url: normalizeYoutubeUrl(p.url) };
        }
        return { ...p, type };
      }),
    );
  };

  const move = (i: number, dir: -1 | 1) =>
    setItems(arr => {
      const j = i + dir;
      if (j < 0 || j >= arr.length) return arr;
      const next = arr.slice();
      const current = next[i];
      const target = next[j];
      if (current === undefined || target === undefined) return arr;
      next[i] = target;
      next[j] = current;
      return next;
    });

  const remove = (i: number) => {
    const item = items[i];
    if (item?.url.trim() && typeof window !== "undefined" && !window.confirm("Supprimer ce média de la galerie ?")) {
      return;
    }
    setItems(arr => arr.filter((_, j) => j !== i));
  };

  if (row.isLoading) {
    return (
      <div className="dbz-panel flex items-center gap-2 p-5 text-sm text-white/50">
        <Chargement className="h-4 w-4 animate-spin" /> Chargement de la galerie…
      </div>
    );
  }

  if (row.isError) {
    return <div className="dbz-panel p-5 text-sm text-red-400">Impossible de charger la galerie de ce jeu.</div>;
  }

  const filled = items.filter(p => p.url.trim()).length;

  return (
    <div className="dbz-panel space-y-4 p-5">
      {toast && (
        <div
          role="status"
          className="rounded border border-dbz-orange/40 bg-dbz-orange/10 px-3 py-2 text-xs text-dbz-orange"
        >
          {toast}
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-saiyan text-sm uppercase tracking-wider text-dbz-orange">Galerie médias</h3>
          <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-white/50">
            Style Steam : screenshots et trailers YouTube sous la description. Ajoute des{" "}
            <strong className="text-white/60">images</strong> (upload) ou des{" "}
            <strong className="text-white/60">liens YouTube</strong> (gameplay / trailer).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dirty && (
            <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-300">
              Non enregistré
            </span>
          )}
          <span className="rounded border border-dbz-border/50 bg-white/[0.03] px-2 py-1 text-[10px] uppercase tracking-wider text-white/50">
            {filled}/{items.length} média{items.length > 1 ? "s" : ""}
          </span>
          <button
            type="button"
            className="btn btn-ghost h-8 gap-1 px-2 text-xs"
            onClick={() => setItems(arr => [...arr, emptyItem("image")])}
          >
            <Illustration className="h-3.5 w-3.5" /> Image
          </button>
          <button
            type="button"
            className="btn btn-ghost h-8 gap-1 px-2 text-xs"
            onClick={() => setItems(arr => [...arr, emptyItem("youtube")])}
          >
            <Film className="h-3.5 w-3.5" /> YouTube
          </button>
          <button
            type="button"
            className="btn btn-primary h-8 gap-1 px-3 text-xs"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? (
              <Chargement className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Enregistrer className="h-3.5 w-3.5" />
            )}
            Enregistrer
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="py-6 text-center text-sm italic text-white/50">
          Aucun média — ajoute une image ou un trailer YouTube.
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((item, i) => (
            <li key={item._key} className="rounded-lg border border-dbz-border/40 bg-black/25 p-3 sm:p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-dbz-blue-light">#{i + 1}</span>
                {/* Toggle type : fond plein sur l'actif (lisible même si le thème
								    recolorie --dbz-orange en bleu). aria-pressed pour a11y. */}
                <div
                  className="inline-flex rounded-md border border-dbz-border/60 bg-black/40 p-0.5"
                  role="group"
                  aria-label="Type de média"
                >
                  {(["image", "youtube"] as const).map(t => {
                    const on = item.type === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setType(i, t)}
                        className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                          on ? "bg-dbz-orange text-black shadow-sm" : "text-white/50 hover:bg-white/5 hover:text-white"
                        }`}
                      >
                        {t === "image" ? <Illustration className="h-3 w-3" /> : <Film className="h-3 w-3" />}
                        {t === "image" ? "Image" : "YouTube"}
                      </button>
                    );
                  })}
                </div>
                <div className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    className="btn btn-ghost h-7 w-7 p-0"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    aria-label={`Monter le média n° ${i + 1}`}
                  >
                    <ChevronHaut className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost h-7 w-7 p-0"
                    disabled={i === items.length - 1}
                    onClick={() => move(i, 1)}
                    aria-label={`Descendre le média n° ${i + 1}`}
                  >
                    <ChevronBas className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost h-7 px-2 text-red-400 hover:border-red-500/50 hover:bg-red-500/10"
                    onClick={() => remove(i)}
                    aria-label={`Supprimer le média n° ${i + 1}`}
                  >
                    <Corbeille className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {item.type === "image" ? (
                <ImageField value={item.url} onChange={url => update(i, { url })} subdir="games-media" column="media" />
              ) : (
                <YoutubeField value={item.url} onChange={url => update(i, { url })} />
              )}

              <label className="mt-3 block">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-dbz-blue-light">
                  Légende (optionnel)
                </span>
                <input
                  type="text"
                  value={item.caption}
                  onChange={e => update(i, { caption: e.target.value })}
                  placeholder="Ex. Trailer de lancement, gameplay Super Saiyan…"
                  className="w-full rounded-md border border-dbz-border bg-dbz-bg px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-dbz-orange focus:outline-none"
                />
              </label>
            </li>
          ))}
        </ul>
      )}

      {items.length > 0 && (
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-dbz-orange hover:text-white"
          onClick={() => setItems(arr => [...arr, emptyItem("image")])}
        >
          <Plus className="h-3.5 w-3.5" /> Ajouter un média
        </button>
      )}
    </div>
  );
}

/**
 * Champ YouTube avec aperçu vignette live (vérifie que l'id est valide).
 * type=text (pas url) pour accepter youtu.be / watch?v= / id brut sans
 * validation HTML5 trop stricte.
 */
function YoutubeField({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const trimmed = value.trim();
  const id = trimmed ? extractYoutubeId(trimmed) : null;
  const thumb = id ? youtubeThumbUrl(id) : null;
  const embed = id ? youtubeEmbedUrl(id) : null;
  const invalid = trimmed.length > 0 && !id;

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-dbz-blue-light">
          URL YouTube
        </span>
        <input
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={e => onChange(e.target.value)}
          onBlur={() => {
            if (id) onChange(`https://youtu.be/${id}`);
          }}
          placeholder="https://youtu.be/… ou youtube.com/watch?v=…"
          className={`w-full rounded-md border bg-dbz-bg px-3 py-2 font-mono text-sm text-white placeholder:text-white/25 focus:outline-none ${
            invalid ? "border-red-500/60 focus:border-red-400" : "border-dbz-border focus:border-dbz-orange"
          }`}
        />
        {invalid && (
          <p className="mt-1 text-[11px] text-red-400">
            Lien YouTube non reconnu — colle un lien watch, youtu.be, embed ou shorts.
          </p>
        )}
      </label>

      {/* Aperçu live : vignette + lien embed (prouve que l'id marche). */}
      {id && thumb && (
        <div className="flex flex-wrap items-start gap-3 rounded-lg border border-white/[0.06] bg-black/30 p-2">
          <a
            href={embed ?? `https://youtu.be/${id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="group relative block h-20 w-36 shrink-0 overflow-hidden rounded-md border border-white/10 bg-black"
            title="Ouvrir la vidéo"
          >
            <img
              src={thumb}
              alt=""
              className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
            />
            <span className="absolute inset-0 flex items-center justify-center bg-black/35">
              <span className="rounded-full bg-black/70 p-2 text-white">
                <Film className="h-4 w-4" />
              </span>
            </span>
          </a>
          <div className="min-w-0 flex-1 py-1">
            <p className="text-[11px] font-display font-semibold uppercase tracking-wider text-dbz-orange">Aperçu OK</p>
            <p className="mt-0.5 break-all font-mono text-[11px] text-white/50">id&nbsp;: {id}</p>
            <p className="mt-1 text-[11px] text-white/50">La vignette YouTube s&apos;affiche → le lien est valide.</p>
          </div>
        </div>
      )}
    </div>
  );
}
