import { getRequestTime } from "./_lib/request-time";
import {
	Activity,
	BookOpen,
	Calendar,
	CalendarClock,
	Eye,
	FileText,
	FolderOpen,
	Heart,
	LayoutDashboard,
	MonitorSmartphone,
	UserPlus,
	Users,
} from "lucide-react";

import {
	AdminPageHeader,
	DashboardGrid,
	RecentListCard,
	DashboardStatsCard as StatsCard,
} from "@rosegriffon/ui";
import { createPostgresClient } from "@rosegriffon/db/service";

import { describeMimeType, listRecentDriveFiles } from "@/lib/google/drive";

import { QuickActions } from "./_components/quick-actions";
import { SignupsChartLoader } from "./_components/signups-chart-loader";
import { buildDailySignups } from "./_lib/signups";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
	const db = createPostgresClient();

	const now = await getRequestTime();
	const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
	const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
	const nowIso = now.toISOString();

	const [
		usersCountRes,
		newUsersWeekRes,
		articlesCountRes,
		draftsCountRes,
		eventsCountRes,
		upcomingEventsCountRes,
		activeSessionsRes,
		patreonLinkedRes,
		activePatronsRes,
		discordSyncRes,
		recentUsersRaw,
		recentArticlesRes,
		upcomingEventsListRes,
		signupsTimelineRes,
	] = await Promise.all([
		db.from("profiles").select("id", { count: "exact", head: true }),
		db
			.from("user")
			.select("*", { count: "exact", head: true })
			.gt("created_at", sevenDaysAgo.toISOString()),
		db.from("articles").select("*", { count: "exact", head: true }).eq("status", "published"),
		db
			.from("articles")
			.select("*", { count: "exact", head: true })
			.neq("status", "published"),
		db.from("events").select("*", { count: "exact", head: true }),
		db.from("events").select("*", { count: "exact", head: true }).gt("start_time", nowIso),
		db.from("session").select("id", { count: "exact", head: true }).gt("expires_at", nowIso),
		db
			.from("account")
			.select("user_id", { count: "exact", head: true })
			.eq("provider_id", "patreon"),
		// Soutien réel : palier engagé des patrons actifs, pas le simple nombre
		// de comptes reliés (un ancien patron reste relié).
		db
			.from("patreon_memberships")
			.select("currently_entitled_cents")
			.eq("patron_status", "active_patron"),
		// Santé de la synchronisation Discord : sans elle, le cron peut échouer
		// des jours sans que personne ne le voie.
		db
			.from("discord_sync_logs")
			.select("status, total_members, error_count, created_at")
			.order("created_at", { ascending: false })
			.limit(1),
		db
			.from("user")
			.select("id, created_at")
			.order("created_at", { ascending: false })
			.limit(5),
		db
			.from("articles")
			.select("id, title, slug, status, published_at, updated_at, view_count")
			.order("updated_at", { ascending: false })
			.limit(5),
		db
			.from("events")
			.select("id, title, start_time, location")
			.gt("start_time", nowIso)
			.order("start_time", { ascending: true })
			.limit(5),
		db
			.from("user")
			.select("created_at")
			.gte("created_at", thirtyDaysAgo.toISOString())
			.order("created_at", { ascending: true }),
	]);

	// Drive partagé : lu via le compte de service, indépendamment de la connexion
	// Google des visiteurs. Dégrade en liste vide si Google est injoignable.
	const driveFiles = await listRecentDriveFiles(5);

	const usersCount = usersCountRes.count ?? 0;
	const newUsersWeek = newUsersWeekRes.count ?? 0;
	const articlesCount = articlesCountRes.count ?? 0;
	const draftsCount = draftsCountRes.count ?? 0;
	const eventsCount = eventsCountRes.count ?? 0;
	const upcomingEventsCount = upcomingEventsCountRes.count ?? 0;
	const activeSessions = activeSessionsRes.count ?? 0;
	const patreonLinked = patreonLinkedRes.count ?? 0;
	const signupsTimeline = buildDailySignups(signupsTimelineRes.data ?? []);

	const activePatrons = (activePatronsRes.data ?? []) as { currently_entitled_cents: number | null }[];
	const monthlySupportCents = activePatrons.reduce((sum, p) => sum + (p.currently_entitled_cents ?? 0), 0);
	const monthlySupport = new Intl.NumberFormat("fr-FR", {
		currency: "EUR",
		maximumFractionDigits: 0,
		style: "currency",
	}).format(monthlySupportCents / 100);

	const lastSync = ((discordSyncRes.data ?? [])[0] ?? null) as {
		status: string | null;
		total_members: number | null;
		error_count: number | null;
		created_at: string | null;
	} | null;
	const syncOk = lastSync?.status === "success" && (lastSync.error_count ?? 0) === 0;
	const syncAge = lastSync?.created_at
		? Math.round((now.getTime() - new Date(lastSync.created_at).getTime()) / 60_000)
		: null;

	const recentUserIds = (recentUsersRaw.data ?? []).map((u: { id: string }) => u.id);
	const profilesRes = recentUserIds.length > 0
		? await db
				.from("profiles")
				.select("id, username, full_name, avatar_url, role")
				.in("id", recentUserIds)
		: { data: [] };

	const recentUsers = (recentUsersRaw.data ?? []).map((u: { id: string; created_at: string | null }) => {
		const profile = (profilesRes.data ?? []).find(
			(p: { id: string; username: string | null; full_name: string | null; avatar_url: string | null; role: string | null }) => p.id === u.id,
		);
		return {
			avatar_url: profile?.avatar_url ?? null,
			created_at: u.created_at,
			full_name: profile?.full_name ?? null,
			id: u.id,
			role: profile?.role ?? "Utilisateur",
			username: profile?.username ?? null,
		};
	});

	return (
		<div className="mx-auto max-w-7xl space-y-8 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
			<AdminPageHeader
				icon={<LayoutDashboard className="size-5" />}
				title="Tableau de bord"
				description="Vue d'ensemble de l'activité de Rose Griffon."
			/>

			<DashboardGrid title="Indicateurs clés">
				<StatsCard
					title="Utilisateurs"
					value={usersCount}
					description={`+${newUsersWeek} sur 7 jours`}
					icon={Users}
					href="/admin/users"
					accent="sky"
				/>
				<StatsCard
					title="Membres Discord"
					value={lastSync?.total_members ?? 0}
					description={
						lastSync
							? syncOk
								? `Synchronisé il y a ${syncAge} min`
								: `Dernière synchro en échec (${lastSync.error_count ?? 0} erreurs)`
							: "Aucune synchronisation enregistrée"
					}
					icon={Activity}
					accent={syncOk ? "emerald" : "rose"}
				/>
				<StatsCard
					title="Sessions actives"
					value={activeSessions}
					description="Connexions en cours"
					icon={MonitorSmartphone}
					accent="primary"
				/>
				<StatsCard
					title="Patreon liés"
					value={patreonLinked}
					description="Comptes connectés"
					icon={Heart}
					href="/admin/patreon"
					accent="rose"
				/>
			</DashboardGrid>

			<DashboardGrid title="Contenu">
				<StatsCard
					title="Articles publiés"
					value={articlesCount}
					description="Visibles par les visiteurs"
					icon={BookOpen}
					href="/admin/chroniques"
					accent="violet"
				/>
				<StatsCard
					title="Brouillons"
					value={draftsCount}
					description="En attente de publication"
					icon={FileText}
					href="/admin/chroniques?status=draft"
					accent="amber"
				/>
				<StatsCard
					title="Événements"
					value={eventsCount}
					description="Total créés"
					icon={CalendarClock}
					href="/admin/events"
					accent="amber"
				/>
				<StatsCard
					title="Soutien mensuel"
					value={monthlySupport}
					description={`${activePatrons.length} patron${activePatrons.length > 1 ? "s" : ""} actif${activePatrons.length > 1 ? "s" : ""} · ${upcomingEventsCount} événement${upcomingEventsCount > 1 ? "s" : ""} à venir`}
					icon={Heart}
					href="/admin/patreon"
					accent="rose"
				/>
			</DashboardGrid>

			<SignupsChartLoader data={signupsTimeline} />

			<section aria-labelledby="recent-title" className="grid gap-6 lg:grid-cols-2 xl:grid-cols-4">
				<h2 id="recent-title" className="sr-only">
					Activité récente
				</h2>
				<RecentListCard
					title="Utilisateurs récents"
					href="/admin/users"
					icon={UserPlus}
					accent="bg-info/10 text-info"
					items={recentUsers.map((u: { created_at: string | null; id: string; role: string | null; full_name: string | null; username: string | null }) => ({
						date: u.created_at || undefined,
						id: u.id,
						subtitle: u.role || "Utilisateur",
						title: u.full_name || u.username || "Sans nom",
					}))}
				/>
				<RecentListCard
					title="Articles récents"
					href="/admin/chroniques"
					icon={FileText}
					accent="bg-secondary/15 text-secondary-foreground"
					items={(recentArticlesRes.data ?? []).map((a: { id: string; title: string; status: string; published_at: string | null; updated_at: string | null; view_count: number | null }) => ({
						date: (a.published_at || a.updated_at) ?? undefined,
						id: a.id,
						meta:
							typeof a.view_count === "number" ? (
								<span className="flex items-center gap-1">
									<Eye className="size-3" aria-hidden="true" />
									{a.view_count}
								</span>
							) : undefined,
						status: a.status !== "published" ? "Brouillon" : undefined,
						title: a.title,
					}))}
				/>
				<RecentListCard
					title="Événements à venir"
					href="/admin/events"
					icon={Calendar}
					accent="bg-alerte/15 text-alerte"
					items={(upcomingEventsListRes.data ?? []).map((e: { id: string; title: string; start_time: string; location: string | null }) => ({
						date: e.start_time,
						id: e.id,
						subtitle: e.location || "Lieu non précisé",
						title: e.title,
					}))}
				/>
				<RecentListCard
					title="Drive partagé"
					href="https://drive.google.com/drive/my-drive"
					icon={FolderOpen}
					accent="bg-succes/10 text-succes"
					items={driveFiles.map((file) => ({
						date: file.modifiedTime ?? undefined,
						id: file.id,
						subtitle: describeMimeType(file.mimeType),
						title: file.name,
					}))}
				/>
			</section>

			<QuickActions />
		</div>
	);
}
