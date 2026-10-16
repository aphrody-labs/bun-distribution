import { assetCdnUrl } from "../_lib";
import { AdminHeader } from "../_Header";
import { DbAddButton } from "@aphrody/admin-ui/components/admin/DbCrud";
import { GalerieMedias } from "@aphrody/admin-ui/components/admin/GalerieMedias";
import {
  getAssetStats,
  listAssetBuckets,
  listAssetLicences,
  listAssets,
  TRIS_ASSETS,
  type TriAssets,
} from "@/lib/wiki-admin";
import Link from "next/link";

export const dynamic = "force-dynamic";

const TABLE = "db_assets";
const PAR_PAGE = 60;

/** Libellés des buckets connus ; un bucket inconnu s'affiche sous son propre nom. */
const LIBELLES: Record<string, string> = {
  characters: "Personnages",
  planets: "Cosmologie",
  transformations: "Transformations",
  "anime-posters": "Affiches anime",
  kitsu: "Kitsu",
  bandai: "Bandai",
  dbofficial: "DB Officiel",
  toei: "Toei",
  shueisha: "Shueisha",
  shonenjump: "Shonen Jump",
  viz: "Viz",
  kanzenshuu: "Kanzenshuu",
  ".": "Hors bucket (uploads)",
};

type Asset = {
  id: number;
  path: string;
  source_id: string | null;
  attribution: string | null;
  license_key: string | null;
  role: string | null;
  bytes: number | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  entity_type: string | null;
  entity_id: number | null;
  sha256: string | null;
};

type Params = {
  bucket?: string;
  q?: string;
  licence?: string;
  vue?: string;
  tri?: string;
  page?: string;
};

/** Conserve les filtres courants en changeant une seule clé — sinon chaque clic les perd. */
const lien = (params: Params, modif: Partial<Params>) => {
  const fusion = { ...params, ...modif };
  const qs = new URLSearchParams();
  for (const [cle, val] of Object.entries(fusion)) if (val) qs.set(cle, String(val));
  const s = qs.toString();
  return `/admin/db-universe/assets${s ? `?${s}` : ""}`;
};

export default async function AdminAssetsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const bucket = sp.bucket ?? "";
  const recherche = sp.q ?? "";
  const licence = sp.licence ?? "";
  const vue = (["orphelins", "doublons"].includes(sp.vue ?? "") ? sp.vue : "tous") as
    | "tous"
    | "orphelins"
    | "doublons";
  const page = Math.max(1, Number(sp.page) || 1);
  const tri = (TRIS_ASSETS.some((t) => t.cle === sp.tri) ? sp.tri : "naturel") as TriAssets;

  const [{ lignes, total }, buckets, licences, stats] = await Promise.all([
    listAssets({ bucket, recherche, licence, vue, tri, page, parPage: PAR_PAGE }),
    listAssetBuckets(),
    listAssetLicences(),
    getAssetStats(),
  ]);

  const assets = lignes as unknown as Asset[];
  const pages = Math.max(1, Math.ceil(total / PAR_PAGE));
  const libelle = (b: string) => LIBELLES[b] ?? b;

  return (
    <div className="w-full max-w-7xl mx-auto">
      <AdminHeader
        title="Médias & images"
        subtitle={`${total} média${total > 1 ? "s" : ""} sur ${stats.total} · page ${page}/${pages}`}
      />

      {/* Ce que le corpus a dans le ventre, mesuré — pas déclaré. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
        {[
          { valeur: String(stats.total), etiquette: "fichiers" },
          { valeur: `${(stats.octets / 1024 / 1024).toFixed(0)} Mo`, etiquette: "poids total" },
          {
            valeur: String(stats.orphelins),
            etiquette: "non rattachés",
            lien: lien({}, { vue: "orphelins" }),
          },
          {
            valeur: String(stats.doublonsEnTrop),
            etiquette: "fichiers en double",
            lien: lien({}, { vue: "doublons" }),
          },
        ].map((c) => {
          const contenu = (
            <>
              <div className="font-saiyan text-2xl text-dbz-orange leading-none">{c.valeur}</div>
              <div className="text-[11px] uppercase tracking-widest text-white/50 mt-1">
                {c.etiquette}
              </div>
            </>
          );
          return c.lien ? (
            <Link
              key={c.etiquette}
              href={c.lien}
              className="dbz-panel p-3 hover:border-dbz-orange/60 transition-colors"
            >
              {contenu}
            </Link>
          ) : (
            <div key={c.etiquette} className="dbz-panel p-3">
              {contenu}
            </div>
          );
        })}
      </div>

      {/* Recherche + filtres : formulaire GET, la page reste server-only et l'URL partageable. */}
      <form method="GET" className="flex flex-wrap items-center gap-2 mb-4">
        {bucket ? <input type="hidden" name="bucket" value={bucket} /> : null}
        {vue !== "tous" ? <input type="hidden" name="vue" value={vue} /> : null}
        <input
          type="search"
          name="q"
          defaultValue={recherche}
          placeholder="Chemin, rôle, attribution, source…"
          className="flex-1 min-w-[220px] bg-dbz-bg border-2 border-dbz-border px-3 py-2 text-white placeholder:text-white/35 focus:border-dbz-orange outline-none"
        />
        <select
          name="licence"
          defaultValue={licence}
          className="bg-dbz-bg border-2 border-dbz-border px-3 py-2 text-white focus:border-dbz-orange outline-none"
        >
          <option value="">Toutes licences</option>
          {licences.map((l) => (
            <option key={l.licence} value={l.licence}>
              {l.licence} ({l.total})
            </option>
          ))}
        </select>
        <select
          name="tri"
          defaultValue={tri}
          className="bg-dbz-bg border-2 border-dbz-border px-3 py-2 text-white focus:border-dbz-orange outline-none"
          aria-label="Ordre de tri"
        >
          {TRIS_ASSETS.map((t) => (
            <option key={t.cle} value={t.cle}>
              {t.libelle}
            </option>
          ))}
        </select>
        <button type="submit" className="dbz-button-ghost !text-xs cible-44">
          Filtrer
        </button>
        {recherche || licence || vue !== "tous" || bucket || tri !== "naturel" ? (
          <Link
            href="/admin/db-universe/assets"
            className="text-xs text-white/50 hover:text-white cible-44"
          >
            Réinitialiser
          </Link>
        ) : null}
        <DbAddButton table={TABLE} label="Ajouter un média" />
      </form>

      {/* Buckets mesurés en base : aucun média ne peut être invisible faute d'être listé ici. */}
      <nav className="mb-5 flex flex-wrap gap-2" aria-label="Catégorie d'assets">
        <Link
          href={lien(sp, { bucket: "", page: "" })}
          className={`px-3 py-1.5 border-2 font-saiyan tracking-widest text-xs uppercase transition-colors ${
            bucket === ""
              ? "border-dbz-orange bg-dbz-orange/15 text-dbz-orange"
              : "border-dbz-blue-light/30 text-white/70 hover:border-dbz-orange/60 hover:text-white"
          }`}
        >
          Tous ({stats.total})
        </Link>
        {buckets.map((b) => (
          <Link
            key={b.bucket}
            href={lien(sp, { bucket: b.bucket, page: "" })}
            className={`px-3 py-1.5 border-2 font-saiyan tracking-widest text-xs uppercase transition-colors ${
              b.bucket === bucket
                ? "border-dbz-orange bg-dbz-orange/15 text-dbz-orange"
                : "border-dbz-blue-light/30 text-white/70 hover:border-dbz-orange/60 hover:text-white"
            }`}
          >
            {libelle(b.bucket)} ({b.total})
          </Link>
        ))}
      </nav>

      {vue !== "tous" ? (
        <p className="text-sm text-dbz-orange/90 mb-4">
          Vue restreinte :{" "}
          {vue === "orphelins"
            ? "médias rattachés à aucune fiche. Ce n'est pas une anomalie en soi : des buckets entiers (toei, dbofficial, shueisha…) sont des bannières et des visuels d'actualité, qui n'illustrent aucune fiche par nature. Les buckets de fiches, eux, sont rattachés à 100 %"
            : `médias dont le sha256 est partagé par au moins deux lignes — les ${total} lignes affichées forment ${stats.doublonsEnTrop} doublons réels, chaque groupe étant montré en entier`}
          {" · "}
          <Link href={lien(sp, { vue: "", page: "" })} className="underline hover:text-white">
            revenir à tout
          </Link>
        </p>
      ) : null}

      {assets.length === 0 ? (
        <div className="dbz-panel p-12 text-center">
          <p className="font-saiyan text-xl uppercase text-white/50 mb-1">Aucun média</p>
          <p className="text-white/50 text-sm">Aucun fichier ne correspond à ces filtres.</p>
        </div>
      ) : (
        <GalerieMedias
          bucket={bucket}
          medias={assets.map((a) => ({
            id: a.id,
            chemin: a.path,
            url: assetCdnUrl(a.path),
            role: a.role,
            licence: a.license_key,
            attribution: a.attribution,
            octets: a.bytes,
            largeur: a.width,
            hauteur: a.height,
            typeEntite: a.entity_type,
            idEntite: a.entity_id,
          }))}
        />
      )}

      {pages > 1 ? (
        <nav className="mt-8 flex items-center justify-center gap-3" aria-label="Pagination">
          {page > 1 ? (
            <Link
              href={lien(sp, { page: String(page - 1) })}
              className="dbz-button-ghost !text-xs cible-44"
            >
              Précédent
            </Link>
          ) : null}
          <span className="text-xs text-white/50">
            Page {page} / {pages}
          </span>
          {page < pages ? (
            <Link
              href={lien(sp, { page: String(page + 1) })}
              className="dbz-button-ghost !text-xs cible-44"
            >
              Suivant
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
