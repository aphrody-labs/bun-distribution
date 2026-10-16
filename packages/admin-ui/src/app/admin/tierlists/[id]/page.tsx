import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { TierlistEditor } from "@/components/tierlist/TierlistEditor";
import { requireAdmin } from "@/lib/session";
import { getAdminCharacterPool, getTierlistForAdmin } from "@/lib/tierlists";
import { saveOfficialTierlist } from "../_actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Éditer une tier list" };

export default async function EditTierlistPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const tl = await getTierlistForAdmin(id);
  if (!tl) notFound();

  // Réserve = pool complet des personnages MOINS les cartes déjà placées dans
  // les tiers (sinon doublons : l'éditeur dédoublonne par id au déplacement).
  const placed = new Set(tl.tiers.flatMap((t) => t.items.map((i) => i.id)));
  const pool = (await getAdminCharacterPool()).filter((c) => !placed.has(c.id));

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-saiyan text-dbz-orange">ÉDITER</h1>
          <p className="text-sm text-white/50 mt-1">
            « {tl.title} » · par {tl.author?.username ?? "—"}
          </p>
        </div>
        {tl.published && (
          <Link
            href={`/tierlists/${tl.slug}`}
            target="_blank"
            className="text-sm text-dbz-blue-light hover:text-dbz-yellow"
          >
            Voir en ligne ↗
          </Link>
        )}
      </div>

      <TierlistEditor
        admin
        onSave={saveOfficialTierlist}
        tierlistId={tl.id}
        templateKey={tl.templateKey}
        defaultTitle={tl.title}
        defaultDescription={tl.description ?? ""}
        pool={pool}
        initialTiers={tl.tiers}
        initialOfficial={tl.official}
        initialFeatured={tl.featured}
        initialPublished={tl.published}
      />

      <Link
        href="/admin/tierlists"
        className="inline-block text-sm text-white/50 hover:text-white/80"
      >
        ← Retour à la modération
      </Link>
    </div>
  );
}
