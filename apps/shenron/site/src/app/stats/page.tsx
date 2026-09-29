import { PageShell } from "@/components/kit";
import type { Metadata } from "next";
import Link from "next/link";
import { Etincelle, Groupe, Oeil, Tendance } from "@/components/icones";
import { PageHeader } from "@/components/PageHeader";
import { getShenronStats } from "@/lib/shenron";
import { getPublicActivitySafe, prettyPath } from "@/lib/analytics";
import { ogMeta } from "@/lib/og";

// `getShenronStats` (bot, live) → 30 s. La section audience (getPublicActivity)
// n'expose que des agrégats NON-SENSIBLES → CDN/ISR-safe (aucun cookie/header,
// aucune donnée par visiteur, aucun referrer).
export const revalidate = 30;

export const metadata: Metadata = {
	title: "Statistiques",
	description:
		"Dragon Ball France en chiffres : la communauté du bot (guerriers, XP, Zénis) et l'activité du site (visiteurs, pages vues, pages populaires). Anonymisé, en direct.",
	...ogMeta({
		title: "Statistiques — Dragon Ball France",
		description:
			"La communauté DBFR en chiffres : bot Discord et audience du site. Données anonymisées, en direct.",
		type: "website",
		canonical: "/stats",
	}),
};

const nf = new Intl.NumberFormat("fr-FR");

export default async function StatsPage() {
	const [stats, activity] = await Promise.all([getShenronStats(), getPublicActivitySafe()]);
	const maxViews = Math.max(1, ...activity.popularPages.map((p) => p.views));

	return (
		<PageShell width="narrow">
			<PageHeader
				eyebrow="Le site en chiffres"
				title="Statistiques"
				subtitle="Le bot Discord et l'audience du site, en direct et anonymisés."
			/>

			{/* --- Communauté du bot Discord --- */}
			<h2 className="font-saiyan text-2xl text-dbz-orange uppercase mb-5">Communauté Discord</h2>
			{!stats || stats.users === 0 ? (
				<div className="dbz-panel p-8 text-center">
					<p className="text-2xl font-saiyan text-red-500 uppercase">Bot inaccessible</p>
				</div>
			) : (
				<div className="grid grid-cols-2 md:grid-cols-3 gap-4">
					<StatCard
						label="Guerriers"
						value={stats.users.toLocaleString("fr-FR")}
						color="text-dbz-orange"
					/>
					<StatCard
						label="XP cumulé"
						value={stats.totalXp.toLocaleString("fr-FR")}
						color="text-dbz-yellow"
					/>
					<StatCard
						label="Zéni circulant"
						value={stats.totalZeni.toLocaleString("fr-FR")}
						suffix="Ƶ"
						color="text-dbz-yellow"
					/>
					<StatCard
						label="Succès débloqués"
						value={stats.achievementsUnlocked.toLocaleString("fr-FR")}
						color="text-dbz-blue-light"
					/>
					<StatCard
						label="Items boutique"
						value={stats.shopItems.toLocaleString("fr-FR")}
						color="text-dbz-orange"
					/>
					<StatCard
						label="Items inventaires"
						value={stats.inventoryItems.toLocaleString("fr-FR")}
						color="text-dbz-blue-light"
					/>
				</div>
			)}

			{/* --- Activité du site (audience web, anonymisée) --- */}
			<h2 className="font-saiyan text-2xl text-dbz-orange uppercase mt-14 mb-2">
				Activité du site
			</h2>
			<p className="text-sm text-white/50 mb-5">
				L'audience web de Dragon Ball France, anonymisée (jamais d'adresse IP) et en direct.
			</p>
			<div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
				<AudienceTile
					icon={<Groupe className="h-5 w-5" />}
					value={nf.format(activity.visitorsThisMonth)}
					label="Visiteurs ce mois"
				/>
				<AudienceTile
					icon={<Oeil className="h-5 w-5" />}
					value={nf.format(activity.pageviewsThisMonth)}
					label="Pages vues ce mois"
				/>
				<AudienceTile
					icon={<Tendance className="h-5 w-5" />}
					value={nf.format(activity.visitorsAllTime)}
					label="Visiteurs au total"
				/>
			</div>

			{/* --- Pages les plus explorées --- */}
			{activity.popularPages.length > 0 && (
				<section className="mt-10">
					<h3 className="font-saiyan text-xl text-dbz-yellow uppercase mb-4 flex items-center gap-2">
						<Etincelle className="h-5 w-5 text-dbz-orange" />
						Pages les plus explorées
					</h3>
					<ol className="space-y-2">
						{activity.popularPages.map((p, i) => (
							<li key={p.path}>
								<Link
									href={p.path}
									className="group flex items-center gap-4 dbz-panel px-4 py-3 hover:border-dbz-orange/60 transition-colors"
								>
									<span className="font-saiyan text-xl text-dbz-yellow/70 w-6 shrink-0 text-center">
										{i + 1}
									</span>
									<div className="min-w-0 flex-1">
										<span className="block text-white group-hover:text-dbz-orange transition-colors truncate">
											{prettyPath(p.path)}
										</span>
										<span className="mt-1.5 block h-1 max-w-[280px] overflow-hidden rounded-full bg-dbz-bg">
											<span
												className="block h-full bg-gradient-to-r from-dbz-orange to-dbz-yellow"
												style={{ width: `${Math.round((p.views / maxViews) * 100)}%` }}
											/>
										</span>
									</div>
									<span className="shrink-0 font-mono text-sm text-white/50">
										{nf.format(p.views)} vues
									</span>
								</Link>
							</li>
						))}
					</ol>
				</section>
			)}

			<footer className="mt-12 text-center text-xs text-gray-500 uppercase tracking-widest">
				Mise à jour en temps réel · données anonymisées (RGPD)
			</footer>
		</PageShell>
	);
}

function StatCard({
	label,
	value,
	suffix,
	color,
}: {
	label: string;
	value: string | number;
	suffix?: string;
	color: string;
}) {
	return (
		<div className="dbz-panel p-6 text-center">
			<div className={`text-5xl font-saiyan ${color} mb-2`}>
				{value}
				{suffix && <span className="text-2xl text-dbz-blue-light ml-1">{suffix}</span>}
			</div>
			<div className="text-xs font-bold uppercase tracking-widest text-dbz-blue-light">{label}</div>
		</div>
	);
}

function AudienceTile({
	icon,
	value,
	label,
}: {
	icon: React.ReactNode;
	value: string;
	label: string;
}) {
	return (
		<div className="dbz-panel px-5 py-6 text-center">
			<div className="mb-3 flex justify-center text-dbz-orange">{icon}</div>
			<p className="font-saiyan text-3xl text-white leading-none">{value}</p>
			<p className="mt-2 text-xs uppercase tracking-wider text-white/50">{label}</p>
		</div>
	);
}
