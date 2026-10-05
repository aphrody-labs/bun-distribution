"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alerte,
  Alimentation,
  AlimentationCoupee,
  Chargement,
  CocheCercle,
  Corbeille,
  Croix,
  Enregistrer,
  Plus,
  Recherche,
  Sac,
} from "@/components/icones";
import { type FormEvent, useMemo, useState } from "react";
import { api } from "@aphrody/admin-ui/client";
import { RoleBadge } from "@aphrody/admin-ui/components/admin/RoleSelect";
import { RolePicker } from "@aphrody/admin-ui/components/admin/RolePicker";
import { cn } from "@/lib/utils";
import { PlainField } from "@/components/editor/PlainField";
import { formatZeni } from "@/lib/zeni";

export interface ShopItem {
  key: string;
  type: "card" | "badge" | "color" | "title" | "banner";
  name: string;
  description: string | null;
  price: number;
  roleId: string | null;
  role_id?: string | null;
  meta: string | null;
  enabled: boolean | number;
}

const TYPE_META: Record<ShopItem["type"], { label: string; color: string; kanji: string }> = {
  title: { label: "Titre", color: "text-purple-400", kanji: "号" },
  badge: { label: "Badge", color: "text-fuchsia-400", kanji: "章" },
  card: { label: "Carte de profil", color: "text-amber-400", kanji: "札" },
  banner: { label: "Bannière", color: "text-emerald-400", kanji: "旗" },
  color: { label: "Couleur (rôle)", color: "text-blue-400", kanji: "色" },
};

const BADGE_PRESETS = [
  { label: "Tortue (亀)", path: "badges/badge-kame.svg" },
  { label: "Kaiô (界)", path: "badges/badge-kaio.svg" },
  { label: "Shenron (龍)", path: "badges/badge-shenron.svg" },
  { label: "Zéni (銭)", path: "badges/badge-zeni.svg" },
];

const CARD_THEME_PRESETS = [
  { id: "default", name: "DB Classic", accent: "#F3E603", banner: "assets/banners/banner-17.jpg" },
  { id: "goku", name: "Son Goku", accent: "#F85B1A", banner: "assets/banners/banner-08.jpg" },
  {
    id: "vegeta",
    name: "Prince Vegeta",
    accent: "#2955DC",
    banner: "assets/banners/banner-03.png",
  },
  { id: "kaio", name: "Kaio-ken", accent: "#FA0011", banner: "assets/banners/banner-10.jpg" },
  { id: "ssj", name: "Super Saiyan", accent: "#F9EE54", banner: "assets/banners/banner-04.jpg" },
  {
    id: "blue",
    name: "Super Saiyan Blue",
    accent: "#00E5FF",
    banner: "assets/banners/banner-15.jpg",
  },
  {
    id: "rose",
    name: "Super Saiyan Rosé",
    accent: "#FF4FB0",
    banner: "assets/banners/banner-16.png",
  },
  {
    id: "ultra",
    name: "Ultra Instinct",
    accent: "#E5E9F0",
    banner: "assets/banners/banner-02.jpg",
  },
];

const FALLBACK_TYPE_META = { label: "Inconnu", color: "text-zinc-400", kanji: "物" };

type MainTab = "all" | "titles_and_badges" | "card" | "banner" | "color";

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="card w-full max-w-sm space-y-4 border border-red-500/40">
        <div className="flex items-start gap-3">
          <Alerte className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
          <div>
            <h3 className="font-semibold text-white">{title}</h3>
            <p className="mt-1 text-sm text-zinc-400">{message}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="ml-auto btn btn-ghost px-1 py-1"
            aria-label="Fermer"
          >
            <Croix className="h-4 w-4" />
          </button>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn btn-ghost">
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="btn btn-primary bg-red-600 hover:bg-red-500 border-red-500"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function parseMeta(metaStr: string | null): Record<string, unknown> | null {
  if (!metaStr) return null;
  try {
    return JSON.parse(metaStr) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export default function ShopPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ShopItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [creatingDefaultType, setCreatingDefaultType] = useState<ShopItem["type"]>("title");
  const [search, setSearch] = useState("");
  const [mainTab, setMainTab] = useState<MainTab>("titles_and_badges");
  const [subFilter, setSubFilter] = useState<"all" | "title" | "badge">("all");
  const [confirmDelete, setConfirmDelete] = useState<ShopItem | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  const items = useQuery({
    queryKey: ["shop", "items"],
    queryFn: async () => {
      const res = await api.get<{ rows: ShopItem[]; total: number }>(
        "/database/shop_items?limit=500",
      );
      // Normaliser roleId et enabled pour chaque ligne
      const rows = (res.rows ?? []).map((r) => ({
        ...r,
        roleId: r.roleId ?? r.role_id ?? null,
        enabled: Boolean(r.enabled),
      }));
      return { rows, total: rows.length };
    },
  });

  const remove = useMutation({
    mutationFn: async (key: string) => {
      try {
        return await api.delete(`/shop/${encodeURIComponent(key)}`);
      } catch {
        return await api.delete(`/database/shop_items/${encodeURIComponent(key)}`);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shop"] });
      showSuccess("Article supprimé de la boutique.");
    },
  });

  const toggleEnabled = useMutation({
    mutationFn: async (item: ShopItem) => {
      const newEnabled = !item.enabled;
      try {
        return await api.patch(`/shop/${encodeURIComponent(item.key)}`);
      } catch {
        return await api.put(`/database/shop_items/${encodeURIComponent(item.key)}`, {
          enabled: newEnabled,
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shop"] });
      showSuccess("Visibilité mise à jour.");
    },
  });

  const openCreate = (type: ShopItem["type"] = "title") => {
    setCreatingDefaultType(type);
    setEditing(null);
    setCreating(true);
  };

  const allRows = useMemo(() => items.data?.rows ?? [], [items.data?.rows]);

  const filtered = useMemo(() => {
    return allRows.filter((r) => {
      // Onglet Titres & Badges fusionnés
      if (mainTab === "titles_and_badges") {
        if (r.type !== "title" && r.type !== "badge") return false;
        if (subFilter !== "all" && r.type !== subFilter) return false;
      } else if (mainTab !== "all") {
        if (r.type !== mainTab) return false;
      }

      if (search) {
        const s = search.toLowerCase();
        if (!r.key.toLowerCase().includes(s) && !r.name.toLowerCase().includes(s)) return false;
      }
      return true;
    });
  }, [allRows, mainTab, subFilter, search]);

  const stats = useMemo(() => {
    return {
      total: allRows.length,
      enabled: allRows.filter((r) => Boolean(r.enabled)).length,
      byType: allRows.reduce(
        (acc, r) => {
          acc[r.type] = (acc[r.type] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      ),
      titlesAndBadges: allRows.filter((r) => r.type === "title" || r.type === "badge").length,
    };
  }, [allRows]);

  return (
    <div className="space-y-4">
      {confirmDelete && (
        <ConfirmDialog
          title={`Supprimer « ${confirmDelete.name} » ?`}
          message="Cet article sera supprimé de la boutique. Les membres qui l'ont déjà acheté conserveront leur exemplaire dans leur inventaire."
          confirmLabel="Supprimer définitivement"
          onConfirm={() => {
            remove.mutate(confirmDelete.key);
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {/* En-tête de la Boutique */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sac className="h-5 w-5 text-brand-400" />
            <h2 className="text-lg font-semibold">Gestion de la Boutique Shenron</h2>
            <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
              {stats.total} articles · {stats.enabled} actifs
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-secondary text-xs"
              onClick={() => openCreate("badge")}
            >
              <Plus className="h-3 w-3" /> Nouveau Badge
            </button>
            <button
              type="button"
              className="btn btn-secondary text-xs"
              onClick={() => openCreate("title")}
            >
              <Plus className="h-3 w-3" /> Nouveau Titre
            </button>
            <button
              type="button"
              className="btn btn-primary text-xs"
              onClick={() => openCreate("card")}
            >
              <Plus className="h-3 w-3" /> Créer un article
            </button>
          </div>
        </div>

        <p className="text-xs text-zinc-400">
          Gérez les cosmétiques achetables avec des Zénis. Un article masqué reste en base pour les
          inventaires existants mais n&apos;apparaît plus à la vente.
        </p>

        {/* Onglets principaux de navigation avec fusion Titres & Badges */}
        <div className="flex flex-wrap gap-2 border-t border-zinc-800 pt-3">
          <button
            type="button"
            onClick={() => {
              setMainTab("titles_and_badges");
              setSubFilter("all");
            }}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition",
              mainTab === "titles_and_badges"
                ? "bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm"
                : "text-zinc-400 hover:text-white hover:bg-zinc-800/60",
            )}
          >
            <span className="font-saiyan text-sm text-purple-400">号/章</span>
            <span>Titres & Badges</span>
            <span className="ml-1 rounded-full bg-purple-500/30 px-1.5 py-0.2 text-[10px] text-purple-200">
              {stats.titlesAndBadges}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setMainTab("card")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition",
              mainTab === "card"
                ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm"
                : "text-zinc-400 hover:text-white hover:bg-zinc-800/60",
            )}
          >
            <span className="font-saiyan text-sm text-amber-400">札</span>
            <span>Cartes de profil</span>
            <span className="ml-1 rounded-full bg-zinc-800 px-1.5 py-0.2 text-[10px] text-zinc-400">
              {stats.byType.card ?? 0}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setMainTab("banner")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition",
              mainTab === "banner"
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm"
                : "text-zinc-400 hover:text-white hover:bg-zinc-800/60",
            )}
          >
            <span className="font-saiyan text-sm text-emerald-400">旗</span>
            <span>Bannières</span>
            <span className="ml-1 rounded-full bg-zinc-800 px-1.5 py-0.2 text-[10px] text-zinc-400">
              {stats.byType.banner ?? 0}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setMainTab("color")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition",
              mainTab === "color"
                ? "bg-blue-500/20 text-blue-300 border border-blue-500/40 shadow-sm"
                : "text-zinc-400 hover:text-white hover:bg-zinc-800/60",
            )}
          >
            <span className="font-saiyan text-sm text-blue-400">色</span>
            <span>Couleurs</span>
            <span className="ml-1 rounded-full bg-zinc-800 px-1.5 py-0.2 text-[10px] text-zinc-400">
              {stats.byType.color ?? 0}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setMainTab("all")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition",
              mainTab === "all"
                ? "bg-zinc-700 text-white border border-zinc-600 shadow-sm"
                : "text-zinc-400 hover:text-white hover:bg-zinc-800/60",
            )}
          >
            <span>Tous les types</span>
            <span className="ml-1 rounded-full bg-zinc-800 px-1.5 py-0.2 text-[10px] text-zinc-400">
              {stats.total}
            </span>
          </button>
        </div>

        {/* Sous-section dédiée quand Titres & Badges est sélectionné */}
        {mainTab === "titles_and_badges" && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-purple-500/20 bg-purple-950/20 p-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-purple-300">
                Distinctions honorifiques :
              </span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setSubFilter("all")}
                  className={cn(
                    "rounded px-2.5 py-1 text-xs transition",
                    subFilter === "all"
                      ? "bg-purple-600 text-white font-medium"
                      : "bg-black/30 text-zinc-400 hover:text-white",
                  )}
                >
                  Tous ({stats.titlesAndBadges})
                </button>
                <button
                  type="button"
                  onClick={() => setSubFilter("title")}
                  className={cn(
                    "rounded px-2.5 py-1 text-xs transition",
                    subFilter === "title"
                      ? "bg-purple-600 text-white font-medium"
                      : "bg-black/30 text-zinc-400 hover:text-white",
                  )}
                >
                  Titres ({stats.byType.title ?? 0})
                </button>
                <button
                  type="button"
                  onClick={() => setSubFilter("badge")}
                  className={cn(
                    "rounded px-2.5 py-1 text-xs transition",
                    subFilter === "badge"
                      ? "bg-fuchsia-600 text-white font-medium"
                      : "bg-black/30 text-zinc-400 hover:text-white",
                  )}
                >
                  Badges ({stats.byType.badge ?? 0})
                </button>
              </div>
            </div>
            <span className="text-[11px] text-zinc-400">
              Badges d&apos;emblèmes (Kame, Kaiô...) et Titres textuels honorifiques (Budokai,
              Capsule...)
            </span>
          </div>
        )}

        {/* Barre de recherche et compteur */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="relative max-w-sm flex-1">
            <Recherche className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
            <input
              className="input w-full pl-9 text-xs"
              placeholder="Rechercher par nom ou identifiant (slug)…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="text-xs text-zinc-500">
            {filtered.length} article{filtered.length !== 1 ? "s" : ""} affiché
            {filtered.length !== 1 ? "s" : ""}
          </div>
        </div>
      </div>

      {/* Message de succès */}
      {successMsg && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">
          <CocheCercle className="h-4 w-4 shrink-0" />
          {successMsg}
        </div>
      )}

      {/* État de chargement */}
      {items.isLoading && (
        <div className="flex items-center gap-2 py-8 text-center text-sm text-zinc-500 justify-center">
          <Chargement className="h-5 w-5 animate-spin" />
          Chargement du catalogue boutique…
        </div>
      )}

      {/* Grille d'articles */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((item) => {
          const meta = parseMeta(item.meta);
          const isEnabled = Boolean(item.enabled);
          const badgePath = (meta?.badgePath as string) || null;
          const bannerPath = (meta?.bannerPath as string) || (meta?.bgFile as string) || null;
          const cardAccent = (meta?.accent as string) || null;

          return (
            <div
              key={item.key}
              className={cn(
                "card flex flex-col justify-between transition-colors border-zinc-800/80 hover:border-zinc-700",
                !isEnabled && "opacity-60 bg-zinc-950/40",
              )}
            >
              <div>
                {/* En-tête carte : type & statut */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="font-saiyan text-xs opacity-75">
                      {(TYPE_META[item.type] ?? FALLBACK_TYPE_META).kanji}
                    </span>
                    <span
                      className={`text-xs font-semibold uppercase tracking-wide ${(TYPE_META[item.type] ?? FALLBACK_TYPE_META).color}`}
                    >
                      {(TYPE_META[item.type] ?? FALLBACK_TYPE_META).label}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {isEnabled ? (
                      <span className="badge badge-success text-[10px]">Actif</span>
                    ) : (
                      <span className="badge badge-error text-[10px]">Masqué</span>
                    )}
                  </div>
                </div>

                {/* Aperçu visuel selon le type */}
                <div className="my-2.5 overflow-hidden rounded-lg border border-zinc-800/60 bg-black/40">
                  {item.type === "badge" && (
                    <div className="flex h-20 items-center justify-center bg-gradient-to-b from-fuchsia-950/20 to-black/60 p-2">
                      {badgePath ? (
                        <img
                          src={`/${badgePath.replace(/^\/?/, "")}`}
                          alt={item.name}
                          className="h-14 w-14 object-contain transition-transform hover:scale-110"
                        />
                      ) : (
                        <span className="font-saiyan text-3xl text-fuchsia-400">
                          {item.name.match(/[\u3400-\u9FFF]/)?.[0] ?? "章"}
                        </span>
                      )}
                    </div>
                  )}

                  {item.type === "title" && (
                    <div className="flex h-20 flex-col items-center justify-center bg-gradient-to-b from-purple-950/20 to-black/60 p-3 text-center">
                      <span className="text-[10px] uppercase tracking-widest text-purple-400/70 font-mono">
                        Titre honorifique
                      </span>
                      <span className="mt-1 font-serif italic font-bold text-sm text-amber-200 line-clamp-1">
                        « {item.name} »
                      </span>
                    </div>
                  )}

                  {item.type === "banner" && (
                    <div className="relative h-20 bg-black/80">
                      {bannerPath ? (
                        <img
                          src={`/${bannerPath.replace(/^assets\//, "")}`}
                          alt={item.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-xs text-zinc-600">
                          Bannière sans image
                        </div>
                      )}
                    </div>
                  )}

                  {item.type === "card" && (
                    <div
                      className="relative flex h-20 items-center justify-between overflow-hidden p-3"
                      style={{
                        background: cardAccent
                          ? `linear-gradient(135deg, ${cardAccent}33, #0a0a0c)`
                          : "#121215",
                        borderLeft: cardAccent ? `4px solid ${cardAccent}` : undefined,
                      }}
                    >
                      {bannerPath && (
                        <img
                          src={`/${bannerPath.replace(/^assets\//, "")}`}
                          alt=""
                          className="absolute inset-0 h-full w-full object-cover opacity-30"
                        />
                      )}
                      <div className="relative z-10">
                        <span className="text-[10px] uppercase tracking-wider text-amber-300/80">
                          Fond de carte
                        </span>
                        <p className="text-xs font-bold text-white truncate">{item.name}</p>
                      </div>
                      <span className="relative z-10 font-saiyan text-2xl text-amber-400">札</span>
                    </div>
                  )}

                  {item.type === "color" && (
                    <div className="flex h-20 items-center justify-center p-2 bg-black/50">
                      <div className="flex items-center gap-2 rounded-full border border-white/10 bg-zinc-900/80 px-3 py-1.5">
                        <span
                          className="h-3.5 w-3.5 rounded-full"
                          style={{
                            background: item.name.toLowerCase().includes("rouge")
                              ? "#ef4444"
                              : item.name.toLowerCase().includes("bleu")
                                ? "#3b82f6"
                                : item.name.toLowerCase().includes("vert")
                                  ? "#22c55e"
                                  : item.name.toLowerCase().includes("orange")
                                    ? "#f97316"
                                    : item.name.toLowerCase().includes("violet") ||
                                        item.name.toLowerCase().includes("rose")
                                      ? "#a855f7"
                                      : item.name.toLowerCase().includes("noir")
                                        ? "#18181b"
                                        : item.name.toLowerCase().includes("blanc")
                                          ? "#fafafa"
                                          : "#eab308",
                          }}
                        />
                        <span className="text-xs font-medium text-white">{item.name}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Titre & slug */}
                <h3 className="font-semibold text-white leading-tight truncate">{item.name}</h3>
                <code className="block truncate text-[10px] text-zinc-500 mt-0.5">{item.key}</code>

                {item.description && (
                  <p className="mt-1.5 line-clamp-2 text-xs text-zinc-400">{item.description}</p>
                )}
              </div>

              {/* Prix, Rôle & Actions */}
              <div className="mt-3 pt-2 border-t border-zinc-800/70">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="badge badge-warning text-xs font-mono">
                      {formatZeni(item.price ?? 0)}
                    </span>
                    {item.roleId && <RoleBadge roleId={item.roleId} />}
                  </div>

                  {/* Toggle rapide d'activation */}
                  <button
                    type="button"
                    onClick={() => toggleEnabled.mutate(item)}
                    disabled={toggleEnabled.isPending}
                    className={cn(
                      "btn btn-ghost px-2 py-1 text-[11px]",
                      isEnabled
                        ? "text-emerald-400 hover:text-emerald-300"
                        : "text-zinc-500 hover:text-zinc-300",
                    )}
                    title={isEnabled ? "Désactiver (masquer)" : "Activer (rendre visible)"}
                  >
                    {isEnabled ? (
                      <Alimentation className="h-3.5 w-3.5" />
                    ) : (
                      <AlimentationCoupee className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>

                <div className="mt-2 flex items-center gap-1">
                  <button
                    type="button"
                    className="btn btn-ghost flex-1 text-xs py-1.5"
                    onClick={() => setEditing(item)}
                  >
                    Modifier
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost px-2 text-red-400 hover:text-red-300"
                    title="Supprimer cet article"
                    onClick={() => setConfirmDelete(item)}
                  >
                    <Corbeille className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && !items.isLoading && (
          <div className="col-span-full card text-center text-zinc-500 py-12">
            {search
              ? "Aucun article ne correspond à cette recherche."
              : "Aucun article dans cette section."}
          </div>
        )}
      </div>

      {/* Modal d'édition / création */}
      {(editing || creating) && (
        <ShopItemEditor
          item={editing}
          defaultType={creatingDefaultType}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["shop"] });
            showSuccess(editing ? "Article modifié avec succès." : "Article créé avec succès.");
          }}
        />
      )}
    </div>
  );
}

function ShopItemEditor({
  item,
  defaultType = "title",
  onClose,
  onSaved,
}: {
  item: ShopItem | null;
  defaultType?: ShopItem["type"];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isCreate = !item;
  const [draft, setDraft] = useState<ShopItem>(
    item ?? {
      key: "",
      type: defaultType,
      name: "",
      description: "",
      price: 100,
      roleId: null,
      meta: null,
      enabled: true,
    },
  );
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async (payload: ShopItem) => {
      const data = {
        key: payload.key,
        type: payload.type,
        name: payload.name,
        description: payload.description || null,
        price: Number(payload.price) || 0,
        roleId: payload.roleId || null,
        role_id: payload.roleId || null,
        meta: payload.meta || null,
        enabled: Boolean(payload.enabled),
      };

      if (isCreate) {
        try {
          return await api.post("/shop", data);
        } catch {
          return await api.post("/database/shop_items", data);
        }
      }
      try {
        return await api.put(`/shop/${encodeURIComponent(payload.key)}`, data);
      } catch {
        return await api.put(`/database/shop_items/${encodeURIComponent(payload.key)}`, data);
      }
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (err) => setError((err as Error).message),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!draft.key || !draft.name) {
      setError("L'identifiant et le nom sont obligatoires.");
      return;
    }
    if (!/^[a-z0-9_-]+$/.test(draft.key)) {
      setError(
        "L'identifiant doit contenir uniquement des lettres minuscules, chiffres, tirets ou underscores.",
      );
      return;
    }
    if (draft.meta) {
      try {
        JSON.parse(draft.meta);
      } catch {
        setError("Le champ Méta doit contenir du JSON valide.");
        return;
      }
    }
    save.mutate(draft);
  };

  const applyBadgePreset = (preset: { label: string; path: string }) => {
    const metaObj = { badgePath: preset.path };
    setDraft({
      ...draft,
      meta: JSON.stringify(metaObj),
      name: draft.name || preset.label,
    });
  };

  const applyCardPreset = (preset: (typeof CARD_THEME_PRESETS)[0]) => {
    const metaObj = {
      themeId: preset.id,
      bannerPath: preset.banner,
      accent: preset.accent,
    };
    setDraft({
      ...draft,
      meta: JSON.stringify(metaObj),
      name: draft.name || `Carte ${preset.name}`,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <form
        onSubmit={submit}
        className="card w-full max-w-2xl space-y-3.5 max-h-[90vh] overflow-y-auto border border-zinc-700 bg-[#12110e]"
      >
        <div className="flex items-center gap-2 border-b border-zinc-800 pb-3">
          <div className="flex items-center gap-2">
            <span className="font-saiyan text-lg text-brand-400">
              {(TYPE_META[draft.type] ?? FALLBACK_TYPE_META).kanji}
            </span>
            <h3 className="text-lg font-semibold">
              {isCreate ? "Créer un article" : `Modifier « ${draft.name} »`}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto btn btn-ghost px-2"
            aria-label="Fermer"
          >
            <Croix className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div className="rounded border border-red-500/40 bg-red-500/10 p-2.5 text-xs text-red-400">
            {error}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">
              Identifiant unique (slug)
              <span className="ml-1 text-zinc-500">— minuscules et tirets</span>
            </label>
            <input
              className="input w-full font-mono text-xs"
              value={draft.key}
              onChange={(e) => setDraft({ ...draft, key: e.target.value })}
              disabled={!isCreate}
              placeholder={
                draft.type === "title"
                  ? "title_budokai"
                  : draft.type === "badge"
                    ? "badge_kame"
                    : "card_goku"
              }
            />
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1">Type d&apos;article</label>
            <select
              className="input w-full"
              value={draft.type}
              onChange={(e) => setDraft({ ...draft, type: e.target.value as ShopItem["type"] })}
            >
              <optgroup label="Distinctions (Unifié)">
                <option value="title">📜 Titre honorifique</option>
                <option value="badge">🏅 Badge d&apos;emblème</option>
              </optgroup>
              <optgroup label="Profil & Style">
                <option value="card">札 Carte de profil</option>
                <option value="banner">旗 Bannière</option>
                <option value="color">🎨 Couleur (rôle)</option>
              </optgroup>
            </select>
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs text-zinc-400 mb-1">Nom affiché dans la boutique</label>
            <input
              className="input w-full"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder={
                draft.type === "title" ? "Champion du Tenkaichi Budokai" : "Nom du cosmétique"
              }
            />
          </div>

          {/* Raccourcis / Presets rapides pour Badges */}
          {draft.type === "badge" && (
            <div className="sm:col-span-2 rounded-lg border border-fuchsia-500/30 bg-fuchsia-950/20 p-2.5">
              <span className="text-[11px] font-semibold text-fuchsia-300 block mb-1.5">
                Emblèmes vectoriels officiels prédéfinis :
              </span>
              <div className="flex flex-wrap gap-1.5">
                {BADGE_PRESETS.map((bp) => (
                  <button
                    key={bp.path}
                    type="button"
                    onClick={() => applyBadgePreset(bp)}
                    className="rounded border border-fuchsia-500/40 bg-black/40 px-2 py-1 text-xs text-fuchsia-200 hover:bg-fuchsia-500/20"
                  >
                    {bp.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Raccourcis / Presets rapides pour Cartes */}
          {draft.type === "card" && (
            <div className="sm:col-span-2 rounded-lg border border-amber-500/30 bg-amber-950/20 p-2.5">
              <span className="text-[11px] font-semibold text-amber-300 block mb-1.5">
                Thèmes de cartes prédéfinis (moteur CardService) :
              </span>
              <div className="flex flex-wrap gap-1.5">
                {CARD_THEME_PRESETS.map((cp) => (
                  <button
                    key={cp.id}
                    type="button"
                    onClick={() => applyCardPreset(cp)}
                    className="rounded border border-amber-500/40 bg-black/40 px-2 py-1 text-xs text-amber-200 hover:bg-amber-500/20"
                  >
                    {cp.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="sm:col-span-2">
            <label className="block text-xs text-zinc-400 mb-1">Description (optionnelle)</label>
            <PlainField
              value={draft.description ?? ""}
              onChange={(v) => setDraft({ ...draft, description: v })}
              minRows={2}
              maxRows={6}
              placeholder="Détails, origine canon ou citation…"
            />
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1">Prix en zénis</label>
            <input
              className="input w-full font-mono"
              type="number"
              min={0}
              value={draft.price}
              onChange={(e) => setDraft({ ...draft, price: Number(e.target.value) || 0 })}
            />
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1">Visibilité dans la boutique</label>
            <button
              type="button"
              className={`btn ${draft.enabled ? "btn-primary" : "btn-ghost"} w-full justify-center`}
              onClick={() => setDraft({ ...draft, enabled: !draft.enabled })}
            >
              {draft.enabled ? (
                <>
                  <Alimentation className="h-3.5 w-3.5" /> Visible (actif)
                </>
              ) : (
                <>
                  <AlimentationCoupee className="h-3.5 w-3.5" /> Masqué (inactif)
                </>
              )}
            </button>
          </div>

          {/* Rôle Discord associé : disponible pour couleurs, titres ET badges */}
          {(draft.type === "color" || draft.type === "title" || draft.type === "badge") && (
            <div className="sm:col-span-2">
              <label className="block text-xs text-zinc-400 mb-1">
                Rôle Discord attribué à l&apos;achat / équipement
                <span className="ml-1 text-zinc-500">
                  {draft.type === "color"
                    ? "(obligatoire pour couleur)"
                    : "(optionnel pour titre/badge)"}
                </span>
              </label>
              <RolePicker
                value={draft.roleId ?? ""}
                onChange={(v) => setDraft({ ...draft, roleId: v || null })}
              />
            </div>
          )}

          <div className="sm:col-span-2">
            <label className="block text-xs text-zinc-400 mb-1">
              Données Méta (JSON optionnel)
              <span className="ml-1 text-zinc-500">— badgePath, bannerPath, themeId, accent…</span>
            </label>
            <PlainField
              value={draft.meta ?? ""}
              onChange={(v) => setDraft({ ...draft, meta: v || null })}
              minRows={3}
              maxRows={10}
              monospace
              spellCheck={false}
              placeholder='{"badgePath": "badges/badge-kame.svg"}'
            />
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-zinc-800 pt-3">
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>
            <Enregistrer className="h-3.5 w-3.5" />
            {save.isPending
              ? "Enregistrement…"
              : isCreate
                ? "Créer l'article"
                : "Enregistrer les modifications"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Annuler
          </button>
        </div>
      </form>
    </div>
  );
}
