import { PageShell } from "@/components/kit";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { MyTierlistManager } from "@/components/tierlist/MyTierlistManager";
import { listTierlistsByAuthor } from "@/lib/tierlists";
import { requireUser } from "@/lib/session";
import { UserNav } from "@/components/user/UserNav";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	title: "Mes tierlists",
	robots: { index: false },
};

export default async function MesTierlistsPage() {
	const me = await requireUser("/tierlists/mes");
	const lists = me.user ? await listTierlistsByAuthor(me.user.id, 50).catch(() => []) : [];

	return (
		<PageShell width="narrow" className="pb-28">
			<UserNav />
			<PageHeader
				eyebrow="Tierlists"
				title="Mes tierlists"
				subtitle="Gère et supprime tes classements."
			/>
			<div className="mb-8 flex justify-center gap-4">
				<Link
					href="/tierlists/creer"
					className="rounded-lg bg-dbz-orange px-5 py-2.5 text-sm font-bold text-black transition-opacity hover:opacity-90"
				>
					Créer une tierlist
				</Link>
				<Link
					href="/tierlists"
					className="rounded-lg border border-white/15 px-5 py-2.5 text-sm font-bold text-white/80 transition-colors hover:border-white/40"
				>
					Toutes les tierlists
				</Link>
			</div>
			<MyTierlistManager
				initial={lists.map((t) => ({ id: t.id, slug: t.slug, title: t.title, tiers: t.tiers }))}
			/>
		</PageShell>
	);
}
