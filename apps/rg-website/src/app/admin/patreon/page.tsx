import {
	Badge,
	Card,
	CardContent,
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
	DashboardStatsCard as StatsCard,
	AdminPageHeader,
} from "@rosegriffon/ui";
import { createPostgresClient } from "@rosegriffon/db/service";
import { AlertCircle, BarChart3, Heart, RefreshCw, TrendingUp, Users } from "lucide-react";

import { PatreonAdminActions } from "@/components/patreon/admin/PatreonAdminActions";
import { PatreonLiveMembersTable } from "@/components/patreon/admin/PatreonLiveMembersTable";
import { PatreonOAuthConfig } from "@/components/patreon/admin/PatreonOAuthConfig";
import { PatreonWebhooksCard } from "@/components/patreon/admin/PatreonWebhooksCard";
import { PatreonConnectButton } from "@/components/patreon/PatreonConnectButton";

import { requirePatreonCreator } from "@/lib/auth-helpers";
import { fetchLiveCampaignSnapshot } from "@/lib/patreon/live";
import { absoluteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function formatEur(cents: number | null | undefined): string {
	if (cents === null || cents === undefined || cents === 0) {
		return "—";
	}
	return `${(cents / 100).toFixed(2).replace(".", ",")} €`;
}

function formatEurCompact(cents: number): string {
	const v = cents / 100;
	if (v >= 1000) {
		return `${(v / 1000).toFixed(1)} k€`;
	}
	return `${v.toFixed(0)} €`;
}

export default async function AdminPatreonPage() {
	await requirePatreonCreator();
	const db = createPostgresClient();

	const [liveResult, { data: tokenRow }] = await Promise.all([
		fetchLiveCampaignSnapshot(),
		db
			.from("patreon_oauth_tokens")
			.select("id,is_creator,expires_at,scope,updated_at")
			.eq("is_creator", true)
			.order("updated_at", { ascending: false })
			.limit(1)
			.maybeSingle(),
	]);

	const creatorLinked = Boolean(tokenRow);

	const live = liveResult.ok ? liveResult.snapshot : null;
	const liveActive = live ? live.members.filter((m) => m.patron_status === "active_patron") : [];
	const liveFormer = live
		? live.members.filter(
				(m) => m.patron_status === "former_patron" || m.patron_status === "declined_patron"
			)
		: [];
	const liveFormerPaid = liveFormer.filter((m) => m.lifetime_support_cents > 0);
	const liveMonthlyCents = liveActive.reduce((acc, m) => acc + m.currently_entitled_cents, 0);
	const liveLifetimeCents = live
		? live.members.reduce((acc, m) => acc + m.lifetime_support_cents, 0)
		: 0;
	const liveAvgPledge = liveActive.length > 0 ? liveMonthlyCents / liveActive.length : 0;
	const liveTotal = live?.members.length ?? 0;
	const liveTierOptions = live
		? [...new Set(live.members.flatMap((m) => m.tier_titles))].toSorted()
		: [];

	const redirectUri = absoluteUrl("/api/auth/oauth2/callback/patreon");
	const clientId = process.env.PATREON_CLIENT_ID;
	const clientIdMasked = clientId ? `${clientId.slice(0, 8)}…${clientId.slice(-4)}` : null;

	return (
		<div className="mx-auto max-w-7xl space-y-8 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
			<AdminPageHeader
				icon={<Heart className="size-5" />}
				title="Patreon — Live"
				description={
					live
						? `${live.campaign.creation_name ?? "Campagne"} · ${live.campaign.patron_count} patrons (Patreon API live)`
						: "Tableau de bord Patreon — connectez le compte créateur pour activer la lecture API."
				}
				actions={
					<>
						<Badge
							variant="outline"
							className={
								creatorLinked
									? "border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
									: "border-amber-500/40 text-amber-700 dark:text-amber-300"
							}
						>
							{creatorLinked ? "Créateur lié" : "Créateur non lié"}
						</Badge>
						<PatreonConnectButton
							variant="creator-link"
							redirect="/admin/patreon"
							label={creatorLinked ? "Re-lier le créateur" : "Lier le créateur"}
						/>
					</>
				}
			/>

			{!live && (
				<Card className="border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/20">
					<CardContent className="space-y-2 p-5 text-sm">
						<div className="flex items-center gap-2 font-semibold text-amber-700 dark:text-amber-300">
							<AlertCircle className="size-4" />
							API Patreon live indisponible
						</div>
						<p className="text-muted-foreground">
							Raison :{" "}
							<code className="rounded bg-muted px-1 py-0.5 text-xs">
								{liveResult.ok ? "ok" : liveResult.reason}
								{!liveResult.ok && liveResult.error ? ` — ${liveResult.error}` : ""}
							</code>
							. Lance « Lier le créateur » avec les scopes campagne pour activer la lecture live.
						</p>
					</CardContent>
				</Card>
			)}

			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				<StatsCard
					title="Patrons (live)"
					value={liveTotal}
					description={`${liveActive.length} actifs · ${liveFormer.length} anciens`}
					icon={Users}
					accent="sky"
				/>
				<StatsCard
					title="MRR estimé"
					value={formatEurCompact(liveMonthlyCents)}
					description={`Pledges actifs · moy. ${formatEur(liveAvgPledge)}`}
					icon={TrendingUp}
					accent="emerald"
				/>
				<StatsCard
					title="LTV total"
					value={formatEurCompact(liveLifetimeCents)}
					description={`${liveFormerPaid.length} anciens ayant payé`}
					icon={BarChart3}
					accent="violet"
				/>
			</div>

			<Tabs defaultValue="overview" className="space-y-6">
				<TabsList className="grid w-full grid-cols-2 lg:w-fit lg:grid-cols-4">
					<TabsTrigger value="overview">Vue d'ensemble</TabsTrigger>
					<TabsTrigger value="members-live">Membres ({liveTotal})</TabsTrigger>
					<TabsTrigger value="tiers">Tiers ({live?.tiers.length ?? 0})</TabsTrigger>
					<TabsTrigger value="webhooks">Webhooks</TabsTrigger>
				</TabsList>

				<TabsContent value="overview" className="space-y-6">
					<div className="grid gap-6 lg:grid-cols-2">
						<Card>
							<CardContent className="p-6">
								<h2 className="mb-4 flex items-center gap-2 font-semibold text-foreground">
									<RefreshCw className="size-4" />
									Synchronisation API live
								</h2>
								<dl className="space-y-3 text-sm">
									<div className="flex items-center justify-between">
										<dt className="text-muted-foreground">Compte créateur</dt>
										<dd className="font-medium text-foreground">
											{creatorLinked ? (
												<span className="text-emerald-600 dark:text-emerald-400">Lié ✓</span>
											) : (
												<span className="text-amber-600 dark:text-amber-400">Non lié</span>
											)}
										</dd>
									</div>
									{creatorLinked && tokenRow && (
										<>
											<div className="flex items-center justify-between">
												<dt className="text-muted-foreground">Scope OAuth</dt>
												<dd>
													<code className="text-xs text-muted-foreground">
														{(tokenRow as { scope: string }).scope}
													</code>
												</dd>
											</div>
											<div className="flex items-center justify-between">
												<dt className="text-muted-foreground">Token expire</dt>
												<dd className="text-xs text-foreground">
													{new Date((tokenRow as { expires_at: string }).expires_at).toLocaleString(
														"fr-FR"
													)}
												</dd>
											</div>
										</>
									)}
									{live && (
										<>
											<div className="flex items-center justify-between border-t border-border pt-3">
												<dt className="text-muted-foreground">Fetch live</dt>
												<dd className="text-xs text-foreground">
													{new Date(live.fetchedAt).toLocaleString("fr-FR")} ·{" "}
													<span className="text-muted-foreground">{live.fetchDurationMs} ms</span>
												</dd>
											</div>
											<div className="flex items-center justify-between">
												<dt className="text-muted-foreground">Patrons (campaign)</dt>
												<dd className="text-xs text-foreground">{live.campaign.patron_count}</dd>
											</div>
										</>
									)}
								</dl>
							</CardContent>
						</Card>

						<Card>
							<CardContent className="p-6">
								<h2 className="mb-4 font-semibold text-foreground">Top tiers actifs</h2>
								<div className="space-y-2 text-sm">
									{(live?.tiers ?? [])
										.filter((t) => t.published !== false)
										.toSorted((a, b) => (b.patron_count ?? 0) - (a.patron_count ?? 0))
										.slice(0, 5)
										.map((t) => (
											<div key={t.id} className="flex items-center justify-between gap-2">
												<span className="truncate text-foreground">{t.title}</span>
												<div className="flex items-center gap-3 text-xs">
													<span className="text-muted-foreground">
														{t.patron_count ?? 0} patrons
													</span>
													<span className="font-mono tabular-nums text-foreground">
														{formatEur(t.amount_cents)}
													</span>
												</div>
											</div>
										))}
									{(!live || live.tiers.length === 0) && (
										<p className="text-muted-foreground">Aucun tier renvoyé par l'API.</p>
									)}
								</div>
							</CardContent>
						</Card>
					</div>

					<PatreonOAuthConfig redirectUri={redirectUri} clientIdMasked={clientIdMasked} />

					<PatreonAdminActions />
				</TabsContent>

				<TabsContent value="members-live">
					{live ? (
						<PatreonLiveMembersTable members={live.members} tierOptions={liveTierOptions} />
					) : (
						<Card>
							<CardContent className="p-6 text-sm text-muted-foreground">
								Liste indisponible — l'API Patreon n'a pas pu être interrogée. Lance « Lier le
								créateur » pour autoriser les scopes campagne.
							</CardContent>
						</Card>
					)}
				</TabsContent>

				<TabsContent value="tiers" className="space-y-4">
					<div className="overflow-x-auto rounded-lg border border-border bg-card">
						<table className="min-w-full text-sm">
							<thead className="bg-muted/50 text-left text-muted-foreground">
								<tr>
									<th className="px-4 py-3 font-medium">Tier</th>
									<th className="px-4 py-3 font-medium">Prix</th>
									<th className="px-4 py-3 font-medium">Patrons</th>
									<th className="px-4 py-3 font-medium">Statut</th>
								</tr>
							</thead>
							<tbody>
								{(live?.tiers ?? []).map((t) => (
									<tr
										key={t.id}
										className="border-t border-border/40 transition-colors hover:bg-muted/30"
									>
										<td className="px-4 py-3">
											<div className="font-medium text-foreground">{t.title}</div>
											{t.description && (
												<div className="line-clamp-1 text-xs text-muted-foreground">
													{t.description}
												</div>
											)}
											{t.discord_role_ids.length > 0 && (
												<div className="mt-1 text-xs text-muted-foreground">
													{t.discord_role_ids.length} rôle Discord lié(s)
												</div>
											)}
										</td>
										<td className="px-4 py-3 font-mono tabular-nums">
											{formatEur(t.amount_cents)}
										</td>
										<td className="px-4 py-3">{t.patron_count ?? 0}</td>
										<td className="px-4 py-3">
											{t.published === false ? (
												<span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
													Brouillon
												</span>
											) : (
												<span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-300">
													Publié
												</span>
											)}
										</td>
									</tr>
								))}
								{(!live || live.tiers.length === 0) && (
									<tr>
										<td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
											Aucun tier renvoyé par l'API Patreon.
										</td>
									</tr>
								)}
							</tbody>
						</table>
					</div>
				</TabsContent>

				<TabsContent value="webhooks">
					<PatreonWebhooksCard />
				</TabsContent>
			</Tabs>
		</div>
	);
}
