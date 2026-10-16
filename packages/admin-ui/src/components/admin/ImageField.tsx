"use client";

import { FolderOpen, ImageOff, Loader2, Search, Upload, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
} from "react";
import { api } from "@aphrody/admin-ui/client";
import { assetUrl } from "@/lib/assets";

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
const MAX_BYTES = 50 * 1024 * 1024;

interface Props {
  /** Valeur courante (chemin DB `./assets/...`, `/wiki/...` ou URL http). */
  value: string;
  onChange: (value: string) => void;
  /** Sous-dossier wiki cible pour l'upload (slug). Défaut `uploads`. */
  subdir?: string;
  /** Nom de colonne (pour l'a11y / placeholder). */
  column?: string;
}

interface GalleryFile {
  path: string;
  url: string;
  name: string;
}

/**
 * Champ image réutilisable pour les éditeurs `/admin` : glisser-déposer depuis
 * le PC, parcourir, coller (presse-papier), saisie manuelle d'URL/chemin, et
 * sélection dans la galerie des images déjà uploadées. L'upload passe par
 * `POST /api/admin/upload` (admin-gated, relais vers le bot) et stocke le chemin
 * DB renvoyé (`./assets/wiki/<subdir>/<uuid>.<ext>`).
 */
export function ImageField({
  value,
  onChange,
  subdir = "uploads",
  column,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Garde anti-concurrence (ref → pas de dépendance/closure obsolète dans upload).
  const busyRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const preview = value ? assetUrl(value) : "";

  const upload = useCallback(
    async (file: File) => {
      setError(null);
      // MIME client = indicatif seulement (vide pour certains drag-drop/presse-papier) ;
      // la vérité est la signature binaire vérifiée côté serveur (magic-bytes).
      if (file.type && !file.type.startsWith("image/")) {
        setError("Le fichier n'est pas une image.");
        return;
      }
      if (file.size > MAX_BYTES) {
        setError("Image trop lourde (max 50 Mo).");
        return;
      }
      if (busyRef.current) return;
      busyRef.current = true;
      setUploading(true);
      try {
        const fd = new FormData();
        fd.append("file", file, file.name);
        fd.append("subdir", subdir);
        const res = await fetch("/api/admin/upload", {
          method: "POST",
          body: fd,
          credentials: "same-origin",
        });
        const data = (await res.json().catch(() => ({}))) as {
          path?: string;
          error?: string;
        };
        if (!res.ok || !data.path) {
          throw new Error(data.error ?? `Upload échoué (${res.status}).`);
        }
        onChange(data.path);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload échoué.");
      } finally {
        setUploading(false);
        busyRef.current = false;
      }
    },
    [onChange, subdir],
  );

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) {
        void upload(file);
        return;
      }
      // Un visuel peut aussi arriver depuis un navigateur, un DAM ou un tableur :
      // dans ce cas le navigateur ne fournit pas de File mais une URL glissée.
      const url = e.dataTransfer
        .getData("text/uri-list")
        .split("\n")
        .find((line) => line && !line.startsWith("#"))
        ?.trim();
      if (url && /^https?:\/\//i.test(url)) {
        onChange(url);
        setError(null);
        return;
      }
      setError(
        "Déposez une image depuis votre ordinateur ou un lien d’image http(s).",
      );
    },
    [onChange, upload],
  );

  const onPaste = useCallback(
    (e: ClipboardEvent<HTMLDivElement>) => {
      const file = Array.from(e.clipboardData.files).find((f) =>
        f.type.startsWith("image/"),
      );
      if (file) {
        e.preventDefault();
        void upload(file);
        return;
      }
      const url =
        e.clipboardData.getData("text/uri-list").trim() ||
        e.clipboardData.getData("text/plain").trim();
      if (/^https?:\/\//i.test(url)) {
        e.preventDefault();
        onChange(url);
        setError(null);
      }
    },
    [onChange, upload],
  );

  return (
    <div className="space-y-2">
      {/* Zone glisser-déposer / coller / parcourir */}
      <div
        role="button"
        tabIndex={0}
        aria-label={`Déposer ou choisir une image${column ? ` pour ${column}` : ""}`}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragging) setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          // Ignore les dragleave vers un élément enfant (sinon flicker du surlignage).
          if (!e.currentTarget.contains(e.relatedTarget as Node | null))
            setDragging(false);
        }}
        onDrop={onDrop}
        onPaste={onPaste}
        className={`relative flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed p-3 transition-colors focus:outline-none focus:ring-2 focus:ring-dbz-orange/50 ${
          dragging
            ? "border-dbz-orange bg-dbz-orange/10"
            : "border-dbz-border/70 hover:border-dbz-orange/60 hover:bg-dbz-orange/5"
        }`}
      >
        {/* Aperçu */}
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded border border-dbz-border bg-black/30">
          {uploading ? (
            <Loader2 className="h-5 w-5 animate-spin text-dbz-orange" />
          ) : preview ? (
            // key={preview} → remonte un <img> neuf à chaque changement de source,
            // sinon le display:none posé par onError sur l'ancienne source resterait.
            <img
              key={preview}
              src={preview}
              alt=""
              className="h-full w-full object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <ImageOff className="h-5 w-5 text-white/50" />
          )}
        </div>

        {/* Texte d'invite */}
        <div className="min-w-0 flex-1">
          <p className="text-sm text-white/80">
            {uploading ? (
              "Envoi en cours…"
            ) : dragging ? (
              "Relâchez pour envoyer l'image"
            ) : (
              <>
                <span className="font-semibold text-dbz-orange">
                  Glisser-déposer
                </span>{" "}
                une image ou son lien, coller, ou cliquer pour parcourir
              </>
            )}
          </p>
          <p className="truncate text-[11px] text-white/50">
            {value
              ? value
              : "Image ou lien https · PNG · JPG · WebP · GIF — max 50 Mo"}
          </p>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = "";
          }}
        />
      </div>

      {/* Actions secondaires */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-ghost h-7 px-2 text-xs"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          <Upload className="h-3 w-3" />
          Parcourir
        </button>
        <button
          type="button"
          className="btn btn-ghost h-7 px-2 text-xs"
          onClick={() => setGalleryOpen(true)}
          disabled={uploading}
        >
          <FolderOpen className="h-3 w-3" />
          Galerie
        </button>
        {value && (
          <button
            type="button"
            className="btn btn-ghost h-7 px-2 text-xs text-red-400 hover:border-red-500/50 hover:bg-red-500/10"
            onClick={() => {
              onChange("");
              setError(null);
            }}
            disabled={uploading}
          >
            <X className="h-3 w-3" />
            Effacer
          </button>
        )}
      </div>

      {/* Saisie manuelle d'URL / chemin (fallback) */}
      <input
        className="input font-mono text-xs"
        value={value}
        placeholder="./assets/… ou https:/…"
        onChange={(e) => onChange(e.target.value)}
      />

      {error && <p className="text-xs text-red-400">{error}</p>}

      {galleryOpen && (
        <GalleryPicker
          onClose={() => setGalleryOpen(false)}
          onPick={(path) => {
            onChange(path);
            setError(null);
            setGalleryOpen(false);
          }}
        />
      )}
    </div>
  );
}

/** Galerie des images déjà uploadées (wiki) — `GET /api/assets/list?dir=wiki`. */
function GalleryPicker({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (path: string) => void;
}) {
  const [files, setFiles] = useState<GalleryFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let alive = true;
    api
      .get<{ files: GalleryFile[] }>("/assets/list?dir=wiki")
      .then((data) => {
        if (alive) setFiles(data.files ?? []);
      })
      .catch((e: Error) => {
        if (alive) setError(e.message || "Chargement de la galerie échoué.");
      });
    return () => {
      alive = false;
    };
  }, []);

  const shown = (files ?? [])
    .filter((f) =>
      filter ? f.name.toLowerCase().includes(filter.toLowerCase()) : true,
    )
    .slice(0, 240);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur"
      onClick={onClose}
    >
      <div
        className="dbz-panel flex max-h-[85vh] w-full max-w-4xl flex-col p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-3">
          <h3 className="font-saiyan text-lg uppercase text-dbz-orange">
            Galerie d'images
          </h3>
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-white/50" />
            <input
              className="input h-8 w-56 pl-7 text-xs"
              placeholder="Filtrer par nom…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost px-2"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {error ? (
          <p className="py-12 text-center text-sm text-red-400">{error}</p>
        ) : files === null ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-white/50">
            <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
          </div>
        ) : shown.length === 0 ? (
          <p className="py-12 text-center text-sm text-white/50">
            Aucune image trouvée.
          </p>
        ) : (
          <div className="grid flex-1 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4 md:grid-cols-6">
            {shown.map((f) => (
              <button
                key={f.path}
                type="button"
                title={f.name}
                onClick={() => onPick(f.path)}
                className="group overflow-hidden rounded border border-dbz-border bg-black/30 transition-colors hover:border-dbz-orange"
              >
                <span className="block aspect-square">
                  <img
                    src={assetUrl(f.path)}
                    alt={f.name}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  />
                </span>
                <span className="block truncate px-1 py-0.5 text-[9px] text-white/50">
                  {f.name}
                </span>
              </button>
            ))}
          </div>
        )}
        <p className="mt-2 shrink-0 text-[10px] text-white/50">
          {files && shown.length < files.length
            ? `${shown.length} sur ${files.length} affichées — affinez le filtre.`
            : files
              ? `${files.length} image(s).`
              : ""}
        </p>
      </div>
    </div>
  );
}
