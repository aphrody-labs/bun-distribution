"use client";

/**
 * Éditeur des bannières de pages (/admin/banners).
 *
 * Deux sections :
 *   1. Heroes de landing (épisodes, films, sagas…)
 *   2. Bannières par série (DB, DBZ, Kai…) — billboards des vues série / modales
 *
 * Upload drag-drop via ImageField (→ assets/wiki/banners/). Galerie officielle
 * Toei/DB via /api/admin/banner-library. Enregistrement via PUT /api/banner-config.
 *
 * Deep-link : `?page=episodes` ou `?series=DBZ` scroll/highlight la ligne.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Bibliotheque, Enregistrer, Illustration, Reinitialiser } from "@/components/icones";
import { DragonBallLoader } from "@/components/DragonBall";
import { ImageField } from "@aphrody/admin-ui/components/admin/ImageField";
import { assetUrl } from "@/lib/assets";
import {
  DEFAULT_PAGE_BANNERS,
  PAGE_HERO_KEYS,
  PAGE_HERO_LABELS,
  SERIES_BANNER_KEYS,
  SERIES_BANNER_LABELS,
  type PageBannersConfig,
  type PageHeroKey,
  type SeriesBannerKey,
} from "@/lib/page-banners";

async function loadBanners(): Promise<{ banners: PageBannersConfig }> {
  const r = await fetch("/api/banner-config", { credentials: "same-origin" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function saveBanners(
  banners: PageBannersConfig,
): Promise<{ ok: boolean; banners: PageBannersConfig }> {
  const r = await fetch("/api/banner-config", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(banners),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(t || `HTTP ${r.status}`);
  }
  return r.json();
}

function previewUrl(path: string): string {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  return assetUrl(path);
}

function BannerRow({
  id,
  label,
  hint,
  value,
  defaultValue,
  onChange,
  highlighted,
  onOpenLibrary,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  defaultValue: string;
  onChange: (v: string) => void;
  highlighted?: boolean;
  onOpenLibrary?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isCustom = value.trim() !== defaultValue.trim();
  const preview = previewUrl(value);

  useEffect(() => {
    if (highlighted && ref.current) {
      ref.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlighted]);

  return (
    <div
      ref={ref}
      id={id}
      className={`dbz-panel overflow-hidden ${highlighted ? "ring-2 ring-dbz-orange/70" : ""}`}
    >
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
        <div className="relative h-20 w-full shrink-0 overflow-hidden rounded border border-dbz-border bg-black/40 sm:w-36">
          {preview ? (
            <img src={preview} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-white/20">
              <Illustration className="h-6 w-6" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-white">{label}</div>
              {hint && <div className="text-[11px] text-white/50">{hint}</div>}
            </div>
            <div className="flex items-center gap-2">
              {onOpenLibrary && (
                <button
                  type="button"
                  onClick={onOpenLibrary}
                  className="btn btn-ghost h-7 px-2 text-xs"
                >
                  <Bibliotheque className="h-3.5 w-3.5" />
                  Galerie
                </button>
              )}
              {isCustom && (
                <span className="rounded bg-dbz-orange/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-dbz-orange">
                  Personnalisé
                </span>
              )}
            </div>
          </div>
          <ImageField value={value} onChange={onChange} subdir="banners" column={label} />
          {isCustom && (
            <button
              type="button"
              onClick={() => onChange(defaultValue)}
              className="inline-flex items-center gap-1 text-[11px] text-white/50 hover:text-dbz-orange"
            >
              <Reinitialiser className="h-3 w-3" />
              Revenir au défaut
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

type LibraryItem = { value: string; url: string; name: string; group: string };

export function BannersEditor() {
  const searchParams = useSearchParams();
  const focusPage = searchParams.get("page");
  const focusSeries = searchParams.get("series");
  const query = useQuery({ queryKey: ["banner-config"], queryFn: loadBanners });
  const lib = useQuery({
    queryKey: ["banner-library"],
    queryFn: async () => {
      const r = await fetch("/api/admin/banner-library", { credentials: "same-origin" });
      if (!r.ok) return [] as LibraryItem[];
      const j = (await r.json()) as { items: LibraryItem[] };
      return j.items ?? [];
    },
    staleTime: 60_000,
  });
  const [config, setConfig] = useState<PageBannersConfig | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [libTarget, setLibTarget] = useState<
    { kind: "page"; key: PageHeroKey } | { kind: "series"; key: SeriesBannerKey } | null
  >(null);

  useEffect(() => {
    if (query.data?.banners) setConfig(structuredClone(query.data.banners));
  }, [query.data]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const save = useMutation({
    mutationFn: () => saveBanners(config as PageBannersConfig),
    onSuccess: (res) => {
      setConfig(res.banners);
      setToast({ type: "success", msg: "Bannières enregistrées — pages revalidées." });
    },
    onError: (e: Error) => setToast({ type: "error", msg: `Échec : ${e.message}` }),
  });

  const resetAll = () => {
    if (!confirm("Réinitialiser toutes les bannières aux valeurs par défaut ?")) return;
    setConfig(structuredClone(DEFAULT_PAGE_BANNERS));
  };

  if (query.isLoading || !config) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <DragonBallLoader />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="dbz-panel p-8 text-center text-sm text-red-300">
        Impossible de charger la config : {(query.error as Error).message}
      </div>
    );
  }

  const setPage = (key: PageHeroKey, v: string) =>
    setConfig((c) => (c ? { ...c, pages: { ...c.pages, [key]: v } } : c));
  const setSeries = (key: SeriesBannerKey, v: string) =>
    setConfig((c) => (c ? { ...c, series: { ...c.series, [key]: v } } : c));

  const pickFromLib = (value: string) => {
    if (!libTarget) return;
    if (libTarget.kind === "page") setPage(libTarget.key, value);
    else setSeries(libTarget.key, value);
    setLibTarget(null);
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8">
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

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-saiyan text-2xl uppercase tracking-wider text-dbz-orange">
            Bannières des pages
          </h1>
          <p className="mt-1 max-w-xl text-sm text-white/50">
            Change le fond des billboards et heros (épisodes, films, sagas…). Upload, URL, ou
            galerie officielle Toei. Les pages publiques se mettent à jour après enregistrement.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={resetAll} className="btn btn-ghost">
            <Reinitialiser className="h-4 w-4" />
            Tout réinitialiser
          </button>
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="btn btn-primary"
          >
            <Enregistrer className="h-4 w-4" />
            {save.isPending ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="font-saiyan text-lg uppercase text-dbz-yellow">Pages (heroes)</h2>
        <p className="text-xs text-white/50">
          Image large en tête de chaque landing wiki / catalogue.
        </p>
        <div className="space-y-3">
          {PAGE_HERO_KEYS.map((key) => (
            <BannerRow
              key={key}
              id={`page-${key}`}
              label={PAGE_HERO_LABELS[key]}
              hint={key}
              value={config.pages[key] ?? ""}
              defaultValue={DEFAULT_PAGE_BANNERS.pages[key]}
              onChange={(v) => setPage(key, v)}
              highlighted={focusPage === key}
              onOpenLibrary={() => setLibTarget({ kind: "page", key })}
            />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-saiyan text-lg uppercase text-dbz-yellow">Séries</h2>
        <p className="text-xs text-white/50">
          Utilisées par les vues série (ex. /wiki/episodes/serie/DBZ) et les aperçus sans image
          d&apos;épisode.
        </p>
        <div className="space-y-3">
          {SERIES_BANNER_KEYS.map((key) => (
            <BannerRow
              key={key}
              id={`series-${key}`}
              label={SERIES_BANNER_LABELS[key]}
              hint={key}
              value={config.series[key] ?? ""}
              defaultValue={DEFAULT_PAGE_BANNERS.series[key] ?? DEFAULT_PAGE_BANNERS.fallback}
              onChange={(v) => setSeries(key, v)}
              highlighted={focusSeries === key}
              onOpenLibrary={() => setLibTarget({ kind: "series", key })}
            />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-saiyan text-lg uppercase text-dbz-yellow">Repli global</h2>
        <BannerRow
          id="fallback"
          label="Bannière par défaut"
          hint="fallback — séries inconnues"
          value={config.fallback}
          defaultValue={DEFAULT_PAGE_BANNERS.fallback}
          onChange={(v) => setConfig((c) => (c ? { ...c, fallback: v } : c))}
        />
      </section>

      <div className="flex justify-end border-t border-dbz-border/40 pt-4">
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="btn btn-primary"
        >
          <Enregistrer className="h-4 w-4" />
          {save.isPending ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>

      {libTarget && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-4 backdrop-blur">
          <div className="dbz-panel flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-dbz-border/50 p-4">
              <p className="font-saiyan text-sm uppercase text-dbz-orange">
                Galerie ·{" "}
                {libTarget.kind === "page"
                  ? PAGE_HERO_LABELS[libTarget.key]
                  : SERIES_BANNER_LABELS[libTarget.key]}
              </p>
              <button type="button" className="btn btn-ghost" onClick={() => setLibTarget(null)}>
                Fermer
              </button>
            </div>
            <div className="overflow-y-auto p-4">
              {lib.isLoading ? (
                <p className="py-8 text-center text-sm text-white/50">Chargement…</p>
              ) : (lib.data?.length ?? 0) === 0 ? (
                <p className="py-8 text-center text-sm text-white/50">
                  Aucune image (toei / dbofficial / wiki/banners).
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                  {(lib.data ?? []).map((it) => (
                    <button
                      key={it.value}
                      type="button"
                      onClick={() => pickFromLib(it.value)}
                      className="group overflow-hidden rounded-lg border border-dbz-border bg-black/30 text-left hover:border-dbz-orange"
                      title={it.name}
                    >
                      <img
                        src={it.url}
                        alt=""
                        className="aspect-[16/7] w-full object-cover opacity-80 group-hover:opacity-100"
                        loading="lazy"
                      />
                      <p className="truncate px-2 py-1 text-[10px] text-white/50">{it.name}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
