import type { Metadata } from "next";
import {
  Activity,
  Database,
  ExternalLink,
  ImageIcon,
  ShieldCheck,
} from "lucide-react";
import { requireAdmin } from "@/lib/session";
import {
  getBxcImportStats,
  listBxcCampaigns,
  listBxcHarvestAssets,
  listRecentBxcImports,
} from "@/lib/bxc-campaigns";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Campagnes BXC",
  description: "Suivi des collectes BXC et revue des médias avant publication.",
};

function formatDate(value: Date | null): string {
  if (!value || Number.isNaN(value.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "—";
  return new Intl.NumberFormat("fr-FR", {
    style: "unit",
    unit: "megabyte",
    maximumFractionDigits: 1,
  }).format(bytes / 1024 / 1024);
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

const STATE_LABEL = {
  running: "Collecte active",
  idle: "En attente",
  unknown: "État inconnu",
} as const;

export default async function BxcCampaignsPage() {
  await requireAdmin();
  const [campaigns, imports, importStats, assets] = await Promise.all([
    listBxcCampaigns(),
    listRecentBxcImports(),
    getBxcImportStats(),
    listBxcHarvestAssets(),
  ]);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-7 pb-10">
      <header className="overflow-hidden rounded-2xl border border-dbz-orange/30 bg-[radial-gradient(circle_at_85%_0%,rgba(243,132,24,.2),transparent_38%),#171511] px-6 py-7 md:px-8">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[.22em] text-dbz-orange">
              BXC · zone de réception
            </p>
            <h1 className="mt-2 font-saiyan text-3xl text-white md:text-4xl">
              Campagnes & médias en revue
            </h1>
            <p className="mt-3 text-sm leading-6 text-white/65">
              Les crawls restent des sources candidates : cette surface rend
              leur état, leurs données importées et leurs assets visibles au
              staff, sans publication automatique ni attribution inventée.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-200">
            <ShieldCheck className="h-4 w-4" /> Publication sous contrôle
            éditorial
          </div>
        </div>
      </header>

      <section
        className="grid gap-3 sm:grid-cols-3"
        aria-label="Synthèse des campagnes"
      >
        <article className="dbz-panel p-4">
          <Activity className="h-5 w-5 text-dbz-orange" />
          <p className="mt-3 font-saiyan text-3xl text-white">
            {campaigns.filter((c) => c.state === "running").length}
          </p>
          <p className="mt-1 text-xs uppercase tracking-wider text-white/50">
            collecte
            {campaigns.filter((c) => c.state === "running").length > 1
              ? "s"
              : ""}{" "}
            active
            {campaigns.filter((c) => c.state === "running").length > 1
              ? "s"
              : ""}
          </p>
        </article>
        <article className="dbz-panel p-4">
          <Database className="h-5 w-5 text-dbz-blue-light" />
          <p className="mt-3 font-saiyan text-3xl text-white">
            {importStats.total.toLocaleString("fr-FR")}
          </p>
          <p className="mt-1 text-xs uppercase tracking-wider text-white/50">
            enregistrements importés · {formatDate(importStats.latestAt)}
          </p>
        </article>
        <article className="dbz-panel p-4">
          <ImageIcon className="h-5 w-5 text-dbz-yellow" />
          <p className="mt-3 font-saiyan text-3xl text-white">
            {assets.length}
          </p>
          <p className="mt-1 text-xs uppercase tracking-wider text-white/50">
            assets en quarantaine de revue
          </p>
        </article>
      </section>

      <section
        className="dbz-panel overflow-hidden"
        aria-labelledby="campaigns-title"
      >
        <div className="border-b border-white/10 px-5 py-4">
          <h2 id="campaigns-title" className="font-saiyan text-xl text-white">
            Campagnes détectées
          </h2>
          <p className="mt-1 text-sm text-white/50">
            L’état vient de l’unité systemd quand elle existe, sinon de la
            dernière écriture SQLite.
          </p>
        </div>
        <div className="divide-y divide-white/8">
          {campaigns.map((campaign) => (
            <div
              key={campaign.id}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
            >
              <div>
                <p className="font-semibold text-white">{campaign.label}</p>
                <p className="mt-1 font-mono text-xs text-white/45">
                  {campaign.id}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-4 text-xs text-white/60">
                <span>
                  {campaign.pages == null
                    ? "—"
                    : `${campaign.successfulPages?.toLocaleString("fr-FR") ?? 0}/${campaign.pages.toLocaleString("fr-FR")} pages HTTP 2xx`}
                </span>
                {campaign.completedRequests != null && (
                  <span>
                    {campaign.completedRequests.toLocaleString("fr-FR")}{" "}
                    traitées ·{" "}
                    {campaign.queuedPages?.toLocaleString("fr-FR") ?? 0} en file
                    {campaign.failedRequests
                      ? ` · ${campaign.failedRequests} en échec`
                      : ""}
                  </span>
                )}
                <span>{formatBytes(campaign.databaseBytes)}</span>
                <span>{formatDate(campaign.updatedAt)}</span>
                <span
                  className={`rounded-full px-2.5 py-1 font-semibold ${campaign.state === "running" ? "bg-emerald-400/15 text-emerald-200" : "bg-white/8 text-white/65"}`}
                >
                  {STATE_LABEL[campaign.state]}
                </span>
              </div>
            </div>
          ))}
          {campaigns.length === 0 && (
            <p className="px-5 py-8 text-sm text-white/55">
              Aucune campagne BXC locale détectée. Le cockpit reste disponible
              dès qu’une file est montée.
            </p>
          )}
        </div>
      </section>

      <div className="grid gap-7 lg:grid-cols-[1.05fr_.95fr]">
        <section
          className="dbz-panel overflow-hidden"
          aria-labelledby="imports-title"
        >
          <div className="border-b border-white/10 px-5 py-4">
            <h2 id="imports-title" className="font-saiyan text-xl text-white">
              Dernières données importées
            </h2>
            <p className="mt-1 text-sm text-white/50">
              Le contenu est indexé comme référence externe, jamais élevé au
              rang de canon par ce flux.
            </p>
          </div>
          <ul className="divide-y divide-white/8">
            {imports.map((record) => (
              <li key={record.url} className="px-5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="line-clamp-2 text-sm font-medium text-white">
                    {record.title}
                  </p>
                  <span className="shrink-0 rounded bg-white/8 px-2 py-1 text-[11px] text-white/60">
                    {record.kind}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-white/45">
                  <span>HTTP {record.httpStatus}</span>
                  <span>{formatDate(record.fetchedAt)}</span>
                  <a
                    className="inline-flex items-center gap-1 hover:text-dbz-orange"
                    href={record.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Source <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </li>
            ))}
            {imports.length === 0 && (
              <li className="px-5 py-8 text-sm text-white/55">
                En attente de la première synchronisation PostgreSQL.
              </li>
            )}
          </ul>
        </section>
        <section
          className="dbz-panel overflow-hidden"
          aria-labelledby="assets-title"
        >
          <div className="border-b border-white/10 px-5 py-4">
            <h2 id="assets-title" className="font-saiyan text-xl text-white">
              Aperçu des assets récoltés
            </h2>
            <p className="mt-1 text-sm text-white/50">
              Aperçus privés, accompagnés de leur URL BXC quand elle est
              disponible : choisir une attribution et rattacher l’asset avant
              toute utilisation publique.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-px bg-white/10 sm:grid-cols-3">
            {assets.slice(0, 12).map((asset) => (
              <figure key={asset.key} className="group bg-dbz-bg p-2">
                <img
                  className="aspect-[4/3] w-full object-cover"
                  src={`/api/admin/bxc-harvest/${encodeURIComponent(asset.key)}`}
                  alt=""
                />
                <figcaption className="mt-2 text-xs text-white/60">
                  <p className="truncate" title={asset.name}>
                    {asset.name} · {formatBytes(asset.bytes)}
                  </p>
                  {asset.sourceUrl ? (
                    <a
                      className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-dbz-orange hover:text-white"
                      href={asset.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      title={asset.sourceUrl}
                    >
                      {hostOf(asset.sourceUrl)}{" "}
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                  ) : (
                    <p className="mt-1 text-white/35">Provenance à compléter</p>
                  )}
                </figcaption>
              </figure>
            ))}
            {assets.length === 0 && (
              <p className="col-span-full bg-dbz-bg px-5 py-8 text-sm text-white/55">
                Aucun asset BXC local à prévisualiser.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
