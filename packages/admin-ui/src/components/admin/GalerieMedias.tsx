"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { DbRowActions } from "@aphrody/admin-ui/components/admin/DbCrud";

/**
 * Grille de médias de l'admin : visionneuse plein écran, rattachement aux fiches
 * du wiki et dépôt de fichiers en lot.
 *
 * Aucune route serveur nouvelle : le dépôt passe par `/api/admin/upload` (qui
 * vérifie déjà la signature binaire du fichier, pas son Content-Type), et
 * l'enregistrement comme le rattachement par `/api/wiki-admin/db_assets`, dont
 * `entityType`/`entityId` sont déjà des colonnes mutables. Ajouter un chemin
 * d'écriture parallèle aurait dupliqué la garde admin et le versionnage.
 */

export type Media = {
  id: number;
  chemin: string;
  url: string;
  role: string | null;
  licence: string | null;
  attribution: string | null;
  octets: number | null;
  largeur: number | null;
  hauteur: number | null;
  typeEntite: string | null;
  idEntite: number | null;
};

const TYPES: { cle: string; libelle: string }[] = [
  { cle: "character", libelle: "Personnage" },
  { cle: "planet", libelle: "Planète" },
  { cle: "saga", libelle: "Saga" },
  { cle: "transformation", libelle: "Transformation" },
  { cle: "technique", libelle: "Technique" },
  { cle: "race", libelle: "Race" },
  { cle: "movie", libelle: "Film" },
  { cle: "episode", libelle: "Épisode" },
  { cle: "game", libelle: "Jeu" },
  { cle: "databook", libelle: "Databook" },
];

const poids = (octets: number | null) =>
  octets == null
    ? null
    : octets >= 1024 * 1024
      ? `${(octets / 1024 / 1024).toFixed(1)} Mo`
      : `${Math.round(octets / 1024)} Ko`;

export function GalerieMedias({ medias, bucket }: { medias: Media[]; bucket: string }) {
  const router = useRouter();
  const [ouvert, setOuvert] = useState<number | null>(null);
  const [zoom, setZoom] = useState(false);
  const [selection, setSelection] = useState<Set<number>>(new Set());
  const [occupe, setOccupe] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [depotActif, setDepotActif] = useState(false);

  const basculer = (id: number) =>
    setSelection((s) => {
      const copie = new Set(s);
      if (copie.has(id)) copie.delete(id);
      else copie.add(id);
      return copie;
    });

  // ── Visionneuse ────────────────────────────────────────────────────────────
  const deplacer = useCallback(
    (pas: number) => {
      setOuvert((i) => (i === null ? null : (i + pas + medias.length) % medias.length));
      setZoom(false);
    },
    [medias.length],
  );

  useEffect(() => {
    if (ouvert === null) return;
    const touche = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOuvert(null);
      else if (e.key === "ArrowRight") deplacer(1);
      else if (e.key === "ArrowLeft") deplacer(-1);
      else if (e.key === " ") {
        e.preventDefault();
        setZoom((z) => !z);
      }
    };
    window.addEventListener("keydown", touche);
    // Le fond ne doit pas défiler sous la visionneuse.
    const avant = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", touche);
      document.body.style.overflow = avant;
    };
  }, [ouvert, deplacer]);

  // ── Dépôt en lot ───────────────────────────────────────────────────────────
  const champFichiers = useRef<HTMLInputElement>(null);

  async function deposer(fichiers: FileList | null) {
    if (!fichiers?.length) return;
    setErreur(null);
    let poses = 0;
    for (const [index, fichier] of Array.from(fichiers).entries()) {
      setOccupe(`Dépôt ${index + 1}/${fichiers.length} — ${fichier.name}`);
      try {
        const corps = new FormData();
        corps.append("file", fichier);
        corps.append("subdir", "galerie");
        const envoi = await fetch("/api/admin/upload", { method: "POST", body: corps });
        const donnees = (await envoi.json()) as { path?: string; error?: string };
        if (!envoi.ok || !donnees.path) throw new Error(donnees.error ?? "dépôt refusé");

        const creation = await fetch("/api/wiki-admin/db_assets", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            path: donnees.path,
            licenseKey: "FAIR-USE-EDITORIAL",
            attribution: `Déposé depuis la galerie — ${fichier.name}`,
            mimeType: fichier.type || null,
            role: "still",
          }),
        });
        if (!creation.ok) throw new Error("enregistrement refusé");
        poses++;
      } catch (e) {
        setErreur(`${fichier.name} : ${(e as Error).message}`);
      }
    }
    setOccupe(null);
    if (champFichiers.current) champFichiers.current.value = "";
    if (poses) router.refresh();
  }

  // ── Rattachement ───────────────────────────────────────────────────────────
  const [type, setType] = useState("character");
  const [recherche, setRecherche] = useState("");
  const [resultats, setResultats] = useState<{ id: number; nom: string }[]>([]);

  useEffect(() => {
    if (recherche.trim().length < 2) {
      setResultats([]);
      return;
    }
    const minuteur = setTimeout(async () => {
      const r = await fetch(
        `/api/admin/entites?type=${type}&q=${encodeURIComponent(recherche)}`,
      ).catch(() => null);
      if (!r?.ok) return;
      setResultats(((await r.json()) as { entites: { id: number; nom: string }[] }).entites);
    }, 250);
    return () => clearTimeout(minuteur);
  }, [type, recherche]);

  async function rattacher(idEntite: number | null) {
    setOccupe(idEntite === null ? "Détachement…" : "Rattachement…");
    setErreur(null);
    for (const id of selection) {
      const r = await fetch(`/api/wiki-admin/db_assets/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entityType: idEntite === null ? null : type,
          entityId: idEntite,
        }),
      }).catch(() => null);
      if (!r?.ok) setErreur(`Échec sur le média #${id}`);
    }
    setOccupe(null);
    setSelection(new Set());
    setRecherche("");
    router.refresh();
  }

  const media = ouvert === null ? null : medias[ouvert];

  return (
    <>
      {/* Dépôt en lot : fichiers multiples par dialogue ou glisser-déposer. */}
      <div
        className={`dbz-panel mb-4 flex flex-wrap items-center gap-3 border-2 border-dashed p-3 transition-colors ${
          depotActif ? "border-dbz-orange bg-dbz-orange/10" : "border-dbz-border"
        }`}
        onDragOver={(event) => {
          event.preventDefault();
          setDepotActif(true);
        }}
        onDragLeave={(event: DragEvent<HTMLDivElement>) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setDepotActif(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDepotActif(false);
          void deposer(event.dataTransfer.files);
        }}
      >
        <input
          ref={champFichiers}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          onChange={(e) => deposer(e.target.files)}
          className="text-sm text-white/70 file:mr-3 file:border-2 file:border-dbz-border file:bg-dbz-bg file:px-3 file:py-2 file:text-white file:cursor-pointer hover:file:border-dbz-orange"
        />
        <span className="text-xs text-white/45">
          Déposez plusieurs images ici ou choisissez-les · PNG, JPG, WebP, GIF · 50 Mo maxi chacune
        </span>
      </div>

      {/*
       * Barre de sélection collante. Le `sticky` et son décalage portent sur une
       * enveloppe, pas sur `.dbz-panel` : la surface ne garde que son dessin, et
       * l'écart se lit d'un coup — 4 rem d'en-tête de site collant (`h-16`) plus
       * une demi-marge. `z-20` passe sous cet en-tête (`z-50`) et au-dessus de la
       * grille de médias.
       */}
      {selection.size > 0 ? (
        <div className="sticky top-[4.5rem] z-20 mb-4">
          <div className="dbz-panel p-3 flex flex-wrap items-center gap-2">
            <strong className="font-saiyan text-dbz-orange text-sm">
              {selection.size} sélectionné{selection.size > 1 ? "s" : ""}
            </strong>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="bg-dbz-bg border-2 border-dbz-border px-2 py-2 text-white"
            >
              {TYPES.map((t) => (
                <option key={t.cle} value={t.cle}>
                  {t.libelle}
                </option>
              ))}
            </select>
            <div className="relative flex-1 min-w-[200px]">
              <input
                type="search"
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
                placeholder="Chercher la fiche à rattacher…"
                className="w-full bg-dbz-bg border-2 border-dbz-border px-3 py-2 text-white placeholder:text-white/35 focus:border-dbz-orange outline-none"
              />
              {resultats.length > 0 ? (
                <ul className="absolute z-30 left-0 right-0 mt-1 max-h-64 overflow-auto border-2 border-dbz-orange bg-dbz-bg">
                  {resultats.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => rattacher(r.id)}
                        className="w-full text-left px-3 py-2 text-sm text-white hover:bg-dbz-orange/20"
                      >
                        {r.nom} <span className="text-white/40">#{r.id}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => rattacher(null)}
              className="dbz-button-ghost !text-xs cible-44"
            >
              Détacher
            </button>
            <button
              type="button"
              onClick={() => setSelection(new Set())}
              className="text-xs text-white/50 hover:text-white cible-44"
            >
              Annuler
            </button>
          </div>
        </div>
      ) : null}

      {occupe ? <p className="text-sm text-dbz-orange mb-3">{occupe}</p> : null}
      {erreur ? <p className="text-sm text-red-400 mb-3">{erreur}</p> : null}

      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
        {medias.map((m, index) => (
          <figure key={m.id} className="group flex flex-col">
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setOuvert(index);
                  setZoom(false);
                }}
                className="block w-full"
                title={m.chemin}
              >
                {/* `contain` et non `cover` : une galerie d'archive ne rogne pas ses pièces. */}
                <div
                  className={`relative aspect-square bg-dbz-bg border-2 overflow-hidden transition-colors ${
                    selection.has(m.id)
                      ? "border-dbz-orange"
                      : "border-dbz-border group-hover:border-dbz-orange/60"
                  }`}
                >
                  <Image
                    src={m.url}
                    alt={m.role ?? m.chemin}
                    fill
                    sizes="(max-width: 768px) 50vw, 16vw"
                    className="object-contain"
                    unoptimized
                  />
                </div>
              </button>
              <label className="absolute top-1 left-1 flex items-center justify-center w-7 h-7 bg-black/70 border border-white/30 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selection.has(m.id)}
                  onChange={() => basculer(m.id)}
                  aria-label={`Sélectionner le média ${m.id}`}
                  className="w-4 h-4 accent-[var(--dbz-orange)]"
                />
              </label>
            </div>
            <figcaption className="mt-1.5 space-y-1">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] text-white/55 font-mono truncate" title={m.chemin}>
                  #{m.id}
                  {m.role ? ` · ${m.role}` : ""}
                </span>
                <DbRowActions table="db_assets" id={m.id} />
              </div>
              <div className="flex flex-wrap gap-1">
                {m.typeEntite ? (
                  <span className="text-[9px] px-1 py-0.5 border border-dbz-blue-light/40 text-white/60">
                    {m.typeEntite} #{m.idEntite}
                  </span>
                ) : null}
                {m.largeur && m.hauteur ? (
                  <span className="text-[9px] px-1 py-0.5 border border-white/15 text-white/45">
                    {m.largeur}×{m.hauteur}
                  </span>
                ) : null}
                {poids(m.octets) ? (
                  <span className="text-[9px] px-1 py-0.5 border border-white/15 text-white/45">
                    {poids(m.octets)}
                  </span>
                ) : null}
              </div>
            </figcaption>
          </figure>
        ))}
      </div>

      {/* Visionneuse */}
      {media ? (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex flex-col"
          role="dialog"
          aria-modal="true"
          aria-label={`Média ${media.id}`}
        >
          <div className="flex items-center justify-between gap-3 p-3 text-sm text-white/70">
            <span className="font-mono truncate">
              #{media.id} · {media.chemin}
            </span>
            <span className="shrink-0 text-white/40">
              {(ouvert ?? 0) + 1} / {medias.length} · {bucket || "tous"}
            </span>
            <button
              type="button"
              onClick={() => setOuvert(null)}
              className="dbz-button-ghost !text-xs cible-44 shrink-0"
            >
              Fermer (Échap)
            </button>
          </div>

          <button
            type="button"
            onClick={() => setZoom((z) => !z)}
            className={`flex-1 min-h-0 relative ${zoom ? "overflow-auto cursor-zoom-out" : "cursor-zoom-in"}`}
            aria-label={zoom ? "Réduire" : "Agrandir"}
          >
            {/* En zoom on sert l'image à sa taille propre, sinon on l'ajuste à l'écran. */}
            {zoom ? (
              <img src={media.url} alt={media.chemin} className="max-w-none mx-auto" />
            ) : (
              <Image
                src={media.url}
                alt={media.chemin}
                fill
                sizes="100vw"
                className="object-contain"
                unoptimized
              />
            )}
          </button>

          <div className="flex items-center justify-between gap-3 p-3">
            <button
              type="button"
              onClick={() => deplacer(-1)}
              className="dbz-button-ghost !text-xs cible-44"
            >
              ← Précédent
            </button>
            <p className="text-xs text-white/50 text-center truncate">
              {[
                media.attribution,
                media.licence,
                media.largeur && media.hauteur ? `${media.largeur}×${media.hauteur}` : null,
                poids(media.octets),
                media.typeEntite ? `${media.typeEntite} #${media.idEntite}` : "non rattaché",
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <button
              type="button"
              onClick={() => deplacer(1)}
              className="dbz-button-ghost !text-xs cible-44"
            >
              Suivant →
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
