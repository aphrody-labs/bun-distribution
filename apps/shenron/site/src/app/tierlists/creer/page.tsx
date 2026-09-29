import { PageShell } from "@/components/kit";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { TierlistEditor } from "@/components/tierlist/TierlistEditor";
import {
	TIERLIST_TEMPLATES,
	emptyTiers,
	getTierlistPool,
	getTierlistTemplate,
} from "@/lib/tierlists";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	title: "Créer une tierlist",
	robots: { index: false },
};

export default async function CreerTierlistPage({
	searchParams,
}: {
	searchParams: Promise<{ template?: string }>;
}) {
	await requireUser("/tierlists/creer");
	const sp = await searchParams;
	const tpl = sp.template ? getTierlistTemplate(sp.template) : undefined;

	// Étape 1 — choix du template (pool d'images).
	if (!tpl) {
		return (
			<PageShell width="prose">
				<PageHeader
					eyebrow="Tierlists"
					title="Créer une tierlist"
					subtitle="Choisis un thème pour commencer."
				/>
				<div className="grid gap-4 sm:grid-cols-2">
					{TIERLIST_TEMPLATES.map((t) => (
						<Link
							key={t.key}
							href={`/tierlists/creer?template=${t.key}`}
							className="dbz-panel block p-5 transition-colors hover:border-dbz-orange/60"
						>
							<h2 className="text-lg font-bold text-white">{t.title}</h2>
							<p className="mt-1 text-[13px] text-white/55">{t.description}</p>
						</Link>
					))}
				</div>
				<p className="mt-8 text-center text-[13px] text-white/50">
					Les cartes proviennent du wiki Dragon Ball FR.
				</p>
			</PageShell>
		);
	}

	// Étape 2 — éditeur sur le pool du template.
	const pool = await getTierlistPool(tpl.key);
	// Le template « libre » part d'une page blanche : on autorise un pool vide.
	const allowEmpty = tpl.source === "none";

	return (
		<div className="container w-full mx-auto max-w-4xl px-4 py-12">
			<PageHeader eyebrow="Tierlists" title="Ton classement" subtitle={tpl.title} size="md" />
			{pool.length === 0 && !allowEmpty ? (
				<div className="dbz-panel p-8 text-center text-white/60">
					Pool d'images indisponible pour ce thème. Réessaie plus tard.
				</div>
			) : (
				<TierlistEditor
					templateKey={tpl.key}
					defaultTitle={tpl.title}
					defaultDescription=""
					pool={pool}
					initialTiers={emptyTiers()}
				/>
			)}
			<p className="mt-6 text-center text-[13px] text-white/50">
				<Link href="/tierlists/creer" className="hover:text-white/70">
					← Changer de thème
				</Link>
			</p>
		</div>
	);
}
