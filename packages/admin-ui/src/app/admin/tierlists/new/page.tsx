import Link from "next/link";
import type { Metadata } from "next";
import { TierlistEditor } from "@/components/tierlist/TierlistEditor";
import { requireAdmin } from "@/lib/session";
import {
  TIERLIST_TEMPLATES,
  emptyTiers,
  getAdminCharacterPool,
  getTierlistPool,
  getTierlistTemplate,
} from "@/lib/tierlists";
import { saveOfficialTierlist } from "../_actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Nouvelle tier list officielle" };

// Pseudo-template admin : pool complet des personnages (sans cap de template).
const ALL_KEY = "all";

export default async function NewOfficialTierlistPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const key = sp.template;

  // Étape 1 — choix du pool de cartes (depuis la DB wiki).
  if (!key) {
    return (
      <div className="w-full max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-4xl font-saiyan text-dbz-orange">TIER LIST OFFICIELLE</h1>
          <p className="text-sm text-white/50 mt-1">
            Choisis un pool de cartes pour commencer. Les cartes viennent du wiki Dragon Ball FR ; tu pourras aussi
            uploader tes propres images dans l'éditeur.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Link
            href={`/admin/tierlists/new?template=${ALL_KEY}`}
            className="dbz-panel block p-5 transition-colors hover:border-dbz-orange/60"
          >
            <h2 className="text-lg font-bold text-white">Pool complet</h2>
            <p className="mt-1 text-[13px] text-white/55">
              Tous les personnages du wiki avec illustration (jusqu'à 400 cartes).
            </p>
          </Link>
          {TIERLIST_TEMPLATES.map(t => (
            <Link
              key={t.key}
              href={`/admin/tierlists/new?template=${t.key}`}
              className="dbz-panel block p-5 transition-colors hover:border-dbz-orange/60"
            >
              <h2 className="text-lg font-bold text-white">{t.title}</h2>
              <p className="mt-1 text-[13px] text-white/55">{t.description}</p>
            </Link>
          ))}
        </div>
        <Link href="/admin/tierlists" className="inline-block text-sm text-white/50 hover:text-white/80">
          ← Retour à la modération
        </Link>
      </div>
    );
  }

  // Étape 2 — éditeur sur le pool choisi.
  const isAll = key === ALL_KEY;
  const tpl = isAll ? undefined : getTierlistTemplate(key);
  if (!isAll && !tpl) {
    return (
      <div className="w-full max-w-4xl mx-auto">
        <div className="dbz-panel p-8 text-center text-white/60">
          Template inconnu.{" "}
          <Link href="/admin/tierlists/new" className="text-dbz-orange hover:underline">
            Recommencer
          </Link>
        </div>
      </div>
    );
  }

  const pool = isAll ? await getAdminCharacterPool() : await getTierlistPool(tpl!.key);
  const allowEmpty = isAll ? false : tpl!.source === "none";
  const defaultTitle = isAll ? "Tier list officielle" : tpl!.title;
  const templateKey = isAll ? null : tpl!.key;

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-saiyan text-dbz-orange">{defaultTitle.toUpperCase()}</h1>
        <p className="text-sm text-white/50 mt-1">
          Glisse/tape les cartes dans les tiers, règle la curation, puis enregistre.
        </p>
      </div>

      {pool.length === 0 && !allowEmpty ? (
        <div className="dbz-panel p-8 text-center text-white/60">Pool de cartes indisponible pour ce thème.</div>
      ) : (
        <TierlistEditor
          admin
          onSave={saveOfficialTierlist}
          templateKey={templateKey}
          defaultTitle={defaultTitle}
          defaultDescription=""
          pool={pool}
          initialTiers={emptyTiers()}
          initialOfficial
          initialPublished
        />
      )}

      <Link href="/admin/tierlists/new" className="inline-block text-sm text-white/50 hover:text-white/80">
        ← Changer de pool
      </Link>
    </div>
  );
}
