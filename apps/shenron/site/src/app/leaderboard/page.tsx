import { PageShell } from "@/components/kit";
import type { Metadata } from "next";
import Link from "next/link";
import { getShenronLeaderboard } from "@/lib/shenron";
import { PageHeader } from "@/components/PageHeader";
import { ogMeta } from "@/lib/og";
import { formatZeni } from "@/lib/zeni";
import { Avatar } from "@/components/Avatar";

export const metadata: Metadata = {
	title: "Classement",
	description:
		"Les tops XP et zéni du serveur Dragon Ball France, au total ou pour le mois en cours.",
	...ogMeta({
		title: "Classement — DBFR",
		description: "Les tops XP et zéni du serveur Dragon Ball France.",
		canonical: "/leaderboard",
	}),
};

export const revalidate = 60;

export default async function LeaderboardPage({
	searchParams,
}: {
	searchParams: Promise<{ metric?: string; period?: string }>;
}) {
	const query = await searchParams;
	const metric = query.metric === "zeni" ? "zeni" : "xp";
	const period = query.period === "month" ? "month" : "general";
	const entries = await getShenronLeaderboard(100, true, 60, metric, period);
	const scoreLabel = metric === "zeni" ? "Zéni" : "XP";
	const periodLabel = period === "month" ? "ce mois-ci" : "depuis le début";

	return (
		<PageShell width="prose">
			<PageHeader
				eyebrow="Communauté Discord"
				title="Classement des guerriers"
				subtitle={`Top 100 guerriers · ${scoreLabel} ${periodLabel}`}
			/>

			<div className="mb-8 flex flex-wrap gap-2" aria-label="Filtres du classement">
				{(["xp", "zeni"] as const).map((m) => (
					<Link
						key={m}
						href={`/leaderboard?metric=${m}&period=${period}`}
						aria-current={metric === m ? "page" : undefined}
						className={`rounded-lg border px-4 py-2 text-sm font-bold transition-colors ${metric === m ? "border-dbz-orange bg-dbz-orange/15 text-dbz-orange" : "border-dbz-border text-white/65 hover:border-dbz-orange/50 hover:text-white"}`}
					>
						{m === "xp" ? "Top XP" : "Top zéni"}
					</Link>
				))}
				<span className="mx-1 hidden self-center text-white/25 sm:inline">·</span>
				{(["general", "month"] as const).map((p) => (
					<Link
						key={p}
						href={`/leaderboard?metric=${metric}&period=${p}`}
						aria-current={period === p ? "page" : undefined}
						className={`rounded-lg border px-4 py-2 text-sm transition-colors ${period === p ? "border-dbz-blue-light bg-dbz-blue-light/15 text-white" : "border-dbz-border text-white/65 hover:border-dbz-blue-light/50 hover:text-white"}`}
					>
						{p === "general" ? "Général" : "Ce mois-ci"}
					</Link>
				))}
			</div>
			<p className="mb-4 text-sm text-white/55">
				Tu cherches les membres qui font vivre le wiki ?{" "}
				<Link href="/classements#noteurs" className="font-semibold text-dbz-orange hover:underline">
					Top noteurs du site
				</Link>{" "}
				·{" "}
				<Link href="/classements#zeni" className="font-semibold text-amber-300 hover:underline">
					Top fortunes en Zénis
				</Link>
			</p>
			<p className="mb-6 text-sm text-white/55">
				{period === "month"
					? `Classement des ${scoreLabel.toLowerCase()} gagnés depuis le 1er jour du mois. Le suivi mensuel commence avec l'enregistrement des gains.`
					: `Classement ${scoreLabel.toLowerCase()} cumulé sur les comptes actifs du serveur.`}
			</p>

			{entries.length === 0 ? (
				<div className="dbz-panel p-8 text-center">
					<p className="text-2xl font-saiyan text-dbz-orange uppercase">
						Aucune donnée encore. Reviens après avoir discuté !
					</p>
				</div>
			) : (
				<div className="dbz-panel overflow-hidden">
					<table className="w-full">
						<thead className="bg-dbz-border/50 border-b-2 border-dbz-border">
							<tr>
								<th className="p-4 text-left text-xs font-bold uppercase tracking-widest text-dbz-blue-light">
									Rang
								</th>
								<th className="p-4 text-left text-xs font-bold uppercase tracking-widest text-dbz-blue-light">
									Guerrier
								</th>
								<th className="p-4 text-right text-xs font-bold uppercase tracking-widest text-dbz-blue-light">
									Niv
								</th>
								<th className="p-4 text-right text-xs font-bold uppercase tracking-widest text-dbz-blue-light">
									XP
								</th>
								<th className="hidden md:table-cell p-4 text-right text-xs font-bold uppercase tracking-widest text-dbz-blue-light">
									Zéni
								</th>
							</tr>
						</thead>
						<tbody className="divide-y-2 divide-dbz-border">
							{entries.map((e) => (
								<tr
									key={e.discordId}
									className={`hover:bg-dbz-blue-light/10 transition-colors ${e.rank <= 3 ? "bg-dbz-yellow/5" : ""}`}
								>
									<td className="p-4 font-saiyan text-2xl">
										<span
											className={
												e.rank === 1
													? "text-dbz-yellow"
													: e.rank === 2
														? "text-gray-300"
														: e.rank === 3
															? "text-dbz-orange"
															: "text-dbz-blue-light"
											}
										>
											#{e.rank}
										</span>
									</td>
									<td className="p-4">
										<a href={`/profil/${e.discordId}`} className="flex items-center gap-3 group">
											{e.avatarUrl && (
												<Avatar
													src={e.avatarUrl}
													userId={e.discordId}
													size={40}
													className="rounded-none border-2 border-dbz-border group-hover:border-dbz-orange transition-colors"
												/>
											)}
											<span className="font-bold text-white group-hover:text-dbz-orange transition-colors">
												{e.username ?? `Guerrier ${e.discordId.slice(-4)}`}
											</span>
										</a>
									</td>
									<td className="p-4 text-right font-saiyan text-xl text-dbz-orange">{e.level}</td>
									<td className="p-4 text-right font-mono text-sm text-gray-300">
										{e.xp.toLocaleString("fr-FR")}
									</td>
									<td className="hidden md:table-cell p-4 text-right font-mono text-sm text-dbz-yellow">
										{formatZeni(e.zeni)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</PageShell>
	);
}
