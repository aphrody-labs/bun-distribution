import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import {
	ArrowUpRight,
	FilePenLine,
	Heart,
	ListOrdered,
	MessageSquareText,
	PenLine,
	ShoppingBag,
	Sparkles,
	Star,
	Trophy,
} from "lucide-react";
import { ContinueRail } from "@/components/history/ContinueRail";
import {
	languageBadges,
	MediaCatalogRails,
	seriesLabel,
	type MediaCatalog,
} from "@/components/stream/MediaCatalogRails";
import { UserNav } from "@/components/user/UserNav";
import { T } from "@/components/T";
import { readAccountSummary } from "@/lib/account-data";
import { assetUrl } from "@/lib/assets";
import { yearOf } from "@/lib/epoch";
import { readMediaCatalog } from "@/lib/media-catalog";
import { getShenronUserResult } from "@/lib/shenron";
import { requireUser } from "@/lib/session";
import { getLaunchConfig } from "@/lib/wiki-launch-config";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mon espace", robots: { index: false, follow: false } };
const fmt = (value: number | null | undefined) => (value ?? 0).toLocaleString("fr-FR");
/** Repli quand ni le bot ni la session ne donnent de pseudo. */
const DEFAULT_NAME = "Guerrier";

export default async function DashboardPage() {
	const me = await requireUser("/dashboard");
	const [profileResult, resumeCompte, catalog, access] = await Promise.all([
		getShenronUserResult(me.discordId),
		// Comme les deux lectures suivantes : un incident PostgreSQL ne doit pas
		// emporter tout l'espace membre, dont chaque compteur tolère déjà `null`.
		// L'échec est RETENU au lieu d'être aplati en `null` : sans distinction,
		// une base injoignable affichait « 0 note publiée », « 0 proposition »,
		// indiscernable d'un compte tout neuf — le site aurait affirmé une
		// activité nulle qu'il n'a pas pu lire.
		me.user ? readAccountSummary(me.user.id).catch(() => "panne" as const) : Promise.resolve(null),
		readMediaCatalog().catch(() => null),
		getLaunchConfig().catch(() => null),
	]);
	const resumeIndisponible = resumeCompte === "panne";
	const accountSummary = resumeCompte === "panne" ? null : resumeCompte;
	const profile = profileResult.status === "ok" ? profileResult.user : null;
	const favorites = accountSummary?.favorites ?? 0;
	const avertissements = [
		profileResult.status !== "ok" ? "dashboard.warningBot" : null,
		resumeIndisponible ? "dashboard.warningSummary" : null,
	].filter((cle): cle is string => cle !== null);
	const username = profile?.username ?? me.user?.username ?? DEFAULT_NAME;
	const progress = profile?.xpProgress
		? Math.min(
				100,
				Math.max(
					0,
					(profile.xpProgress.current / Math.max(1, profile.xpProgress.nextLevelXp)) * 100
				)
			)
		: 0;
	return (
		<main className="min-h-screen bg-[radial-gradient(circle_at_80%_0%,rgba(243,132,24,.12),transparent_32%),#0e0d0b] text-white">
			<div className="mx-auto max-w-[1400px] px-4 py-8 pb-28 md:px-8 md:py-12">
				<UserNav />
				<MemberHero username={username} catalog={catalog} />
				<ContinueRail
				titleKey="history.resumeWith"
				titleValues={{ name: username }}
				className="mt-9 lg:mt-12"
			/>
				{catalog && (
					<div className="mt-9 lg:mt-12">
						<MediaCatalogRails catalog={catalog} access={access} eagerEpisodes />
					</div>
				)}
				<section
					aria-labelledby="progression-title"
					className="mt-8 rounded-3xl border border-dbz-orange/20 bg-[#181510] p-5 md:p-8"
				>
					<div className="flex flex-wrap items-end justify-between gap-4">
						<div>
							<h2 id="progression-title" className="font-saiyan text-3xl text-dbz-orange">
								<T k="dashboard.progressTitle" />
							</h2>
							<p className="mt-1 text-sm text-white/45">
								<T k="dashboard.progressLead" />
							</p>
						</div>
						<div className="flex items-end gap-4">
							<p className="font-saiyan text-4xl">
								<T k="dashboard.level" values={{ level: profile?.level ?? 0 }} />
							</p>
							<Link
								href="/profil/me"
								className="hidden min-h-11 items-center gap-2 rounded-full border border-white/15 px-4 text-sm font-semibold text-white/70 hover:border-dbz-orange hover:text-white sm:inline-flex"
							>
								<T k="dashboard.profile" /> <ArrowUpRight className="h-4 w-4" />
							</Link>
						</div>
					</div>
					{/* Un composant serveur ne remplit pas un `aria-label` depuis le
					    dictionnaire : l'étiquette est un nœud traduit, que la barre désigne. */}
					<span id="progression-barre-label" className="sr-only">
						<T k="dashboard.progressBar" />
					</span>
					<div
						className="mt-6 h-3 overflow-hidden rounded-full bg-black/60"
						role="progressbar"
						aria-labelledby="progression-barre-label"
						aria-valuenow={Math.round(progress)}
						aria-valuemin={0}
						aria-valuemax={100}
					>
						<div
							className="h-full rounded-full bg-gradient-to-r from-dbz-orange via-yellow-300 to-dbz-blue-light"
							style={{ width: `${progress}%` }}
						/>
					</div>
					<div className="mt-3 flex justify-between text-xs text-white/40">
						<span>
							<T k="dashboard.xp" values={{ value: fmt(profile?.xpProgress?.current) }} />
						</span>
						<span>
							<T k="dashboard.xpRequired" values={{ value: fmt(profile?.xpProgress?.nextLevelXp) }} />
						</span>
					</div>
					<dl className="mt-7 grid grid-cols-2 gap-3 md:grid-cols-4">
						<Metric label={<T k="dashboard.metricXp" />} value={fmt(profile?.xp)} />
						<Metric label={<T k="dashboard.metricZeni" />} value={fmt(profile?.zeni)} />
						<Metric
							label={<T k="dashboard.metricAchievements" />}
							value={fmt(profile?.achievements?.length)}
						/>
						<Metric label={<T k="dashboard.metricFavorites" />} value={fmt(favorites)} />
					</dl>
					<Link
						href="/profil/me"
						className="mt-5 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-dbz-orange hover:text-yellow-200 sm:hidden"
					>
						<T k="dashboard.seeProfile" /> <ArrowUpRight className="h-4 w-4" />
					</Link>
				</section>
				<section
					aria-labelledby="community-title"
					className="mt-8 grid gap-5 lg:grid-cols-[.8fr_1.2fr]"
				>
					<div className="rounded-3xl border border-white/10 bg-[#151412] p-5 md:p-7">
						<h2 id="community-title" className="text-lg font-semibold">
							<T k="dashboard.footprintTitle" />
						</h2>
						<p className="mt-1 text-sm text-white/40">
							<T k="dashboard.footprintLead" />
						</p>
						<dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4">
							<SmallMetric
								label={<T k="dashboard.metricWikiProposals" />}
								value={accountSummary?.counts.wikiContributions}
							/>
							<SmallMetric
								label={<T k="dashboard.metricRatings" />}
								value={accountSummary?.counts.ratings}
							/>
							<SmallMetric
								label={<T k="dashboard.metricTierlists" />}
								value={accountSummary?.counts.tierlists}
							/>
							<SmallMetric
								label={<T k="dashboard.metricComments" />}
								value={accountSummary?.counts.comments}
							/>
						</dl>
					</div>
					<div className="rounded-3xl border border-white/10 bg-[#151412] p-5 md:p-7">
						<h2 className="text-lg font-semibold">
							<T k="dashboard.recentTitle" />
						</h2>
						<p className="mt-1 text-sm text-white/40">
							<T k="dashboard.recentLead" />
						</p>
						<RecentActivity summary={accountSummary} />
					</div>
				</section>
				<section aria-labelledby="actions-title" className="mt-8">
					<div className="mb-4">
						<h2 id="actions-title" className="text-lg font-semibold">
							<T k="dashboard.continueTitle" />
						</h2>
						<p className="mt-1 text-sm text-white/40">
							<T k="dashboard.continueLead" />
						</p>
					</div>
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						<Action
							href="/favoris"
							icon={Heart}
							title={<T k="dashboard.actionFavorites" />}
							text={<T k="dashboard.actionFavoritesText" />}
						/>
						<Action
							href="/shop"
							icon={ShoppingBag}
							title={<T k="dashboard.actionShop" />}
							text={<T k="dashboard.actionShopText" />}
						/>
						<Action
							href="/tierlists/mes"
							icon={ListOrdered}
							title={<T k="dashboard.actionTierlists" />}
							text={<T k="dashboard.actionTierlistsText" />}
						/>
						<Action
							href="/wiki/contribuer"
							icon={PenLine}
							title={<T k="dashboard.actionContribute" />}
							text={<T k="dashboard.actionContributeText" />}
						/>
						<Action
							href="/leaderboard"
							icon={Trophy}
							title={<T k="dashboard.actionLeaderboard" />}
							text={<T k="dashboard.actionLeaderboardText" />}
						/>
						<Action
							href="/jeux"
							icon={Sparkles}
							title={<T k="dashboard.actionGames" />}
							text={<T k="dashboard.actionGamesText" />}
						/>
					</div>
				</section>
				{avertissements.length > 0 && (
					<p
						role="status"
						className="mt-6 rounded-xl border border-yellow-300/20 bg-yellow-300/5 p-4 text-sm text-yellow-100/75"
					>
						{avertissements.map((cle) => (
							<T key={cle} k={cle} />
						))}{" "}
						<T k="dashboard.warningTail" />
					</p>
				)}
			</div>
		</main>
	);
}

function MemberHero({ username, catalog }: { username: string; catalog: MediaCatalog | null }) {
	const featured = catalog?.episodes.find((episode) => episode.image) ?? catalog?.episodes[0];
	const languages = languageBadges(featured?.players ?? null);
	const series = featured ? seriesLabel(featured.series) : null;
	const canWatch = languages.hasVf || languages.hasVostfr;

	return (
		<header className="relative isolate flex min-h-[430px] overflow-hidden rounded-[2rem] border border-white/10 bg-[#171512] shadow-[0_24px_80px_rgba(0,0,0,.35)] md:min-h-[500px]">
			{featured?.image && (
				<Image
					src={assetUrl(featured.image)}
					alt=""
					fill
					priority
					sizes="(min-width: 1400px) 1340px, 100vw"
					className="-z-20 object-cover object-center"
				/>
			)}
			<div className="absolute inset-0 -z-10 bg-gradient-to-t from-[#0e0d0b] via-[#0e0d0b]/45 to-black/10" />
			<div className="absolute inset-0 -z-10 bg-gradient-to-r from-[#0e0d0b] via-[#0e0d0b]/80 to-transparent" />
			<div
				className="halftone pointer-events-none absolute inset-0 -z-10 opacity-[.07]"
				aria-hidden
			/>
			<div className="flex max-w-2xl flex-col justify-end p-6 sm:p-9 md:p-12">
				<p className="text-sm font-semibold text-dbz-orange">
					<T k="dashboard.heroSelection" values={{ name: username }} />
				</p>
				<h1 className="mt-3 text-balance font-saiyan text-4xl leading-[.95] text-white sm:text-6xl md:text-7xl">
					{featured?.title || <T k="dashboard.heroFallbackTitle" />}
				</h1>
				{featured ? (
					<p className="mt-4 text-sm font-medium text-white/70">
						{series}
						{featured.number != null ? (
							<T k="dashboard.heroEpisode" values={{ number: featured.number }} />
						) : (
							""
						)}
						{yearOf(featured.airDate) ? ` · ${yearOf(featured.airDate)}` : ""}
						{languages.hasVf ? " · VF" : ""}
						{languages.hasVostfr ? " · VOSTFR" : ""}
					</p>
				) : (
					<p className="mt-4 max-w-xl text-pretty text-white/60">
						<T k="dashboard.heroFallbackLead" />
					</p>
				)}
				<div className="mt-7 flex flex-col gap-3 sm:flex-row">
					<Link
						href={featured ? `/wiki/episodes/${featured.id}` : "/wiki/episodes"}
						className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-dbz-orange px-6 text-sm font-bold text-black hover:bg-yellow-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dbz-orange"
					>
						<T k={canWatch ? "dashboard.watch" : "dashboard.discover"} />
					</Link>
					<Link
						href="/favoris"
						className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/20 bg-black/30 px-6 text-sm font-semibold text-white hover:border-white/45 hover:bg-black/45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
					>
						<Heart className="h-4 w-4" aria-hidden /> <T k="dashboard.myList" />
					</Link>
				</div>
			</div>
		</header>
	);
}

function SmallMetric({ label, value }: { label: ReactNode; value: number | undefined }) {
	return (
		<div>
			<dt className="text-xs text-white/40">{label}</dt>
			<dd className="mt-1 text-2xl font-semibold text-white">{fmt(value)}</dd>
		</div>
	);
}

type Summary = Awaited<ReturnType<typeof readAccountSummary>>;

function RecentActivity({ summary }: { summary: Summary | null }) {
	const items = [
		...(summary?.recent.contributions.map((item) => ({
			id: `contribution:${item.id}`,
			at: item.createdAt,
			icon: FilePenLine,
			label: item.entityLabel ? (
				<T k="dashboard.activity.proposalOn" values={{ label: item.entityLabel }} />
			) : (
				<T k="dashboard.activity.proposal" />
			),
			detail: <T k={statusKey(item.status)} />,
			href: item.entityPath,
		})) ?? []),
		...(summary?.recent.reports.map((item) => ({
			id: `report:${item.id}`,
			at: item.createdAt,
			icon: MessageSquareText,
			label: item.pageTitle ? (
				<T k="dashboard.activity.reportOn" values={{ label: item.pageTitle }} />
			) : (
				<T k="dashboard.activity.report" />
			),
			detail: <T k={statusKey(item.status)} />,
			href: item.path,
		})) ?? []),
		...(summary?.recent.ratings.map((item) => ({
			id: `rating:${item.id}`,
			at: item.createdAt,
			icon: Star,
			label: <T k="dashboard.activity.rating" values={{ score: item.score }} />,
			detail: <T k={targetKey(item.targetType)} />,
			href: targetHref(item.targetType, item.targetId),
		})) ?? []),
	]
		.toSorted((a, b) => b.at.getTime() - a.at.getTime())
		.slice(0, 5);

	if (!items.length) {
		return (
			<p className="mt-5 rounded-2xl border border-dashed border-white/10 p-5 text-sm text-white/35">
				<T k="dashboard.recentEmpty" />
			</p>
		);
	}

	return (
		<ul className="mt-5 divide-y divide-white/10">
			{items.map(({ id, icon: Icon, label, detail, href, at }) => (
				<li key={id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
					<span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-dbz-orange/10 text-dbz-orange">
						<Icon className="h-4 w-4" aria-hidden />
					</span>
					<div className="min-w-0 flex-1">
						{href ? (
							<Link
								href={href}
								className="block truncate text-sm font-semibold hover:text-dbz-orange"
							>
								{label}
							</Link>
						) : (
							<p className="truncate text-sm font-semibold">{label}</p>
						)}
						<p className="mt-0.5 text-xs text-white/35">
							{detail} · {at.toLocaleDateString("fr-FR")}
						</p>
					</div>
				</li>
			))}
		</ul>
	);
}

const STATUTS = [
	"pending",
	"accepted",
	"rejected",
	"superseded",
	"withdrawn",
	"open",
	"in_progress",
	"resolved",
	"closed",
] as const;

/** Un statut inconnu ne rend rien plutôt qu'un identifiant technique à l'écran. */
function statusKey(status: string): string {
	return (STATUTS as readonly string[]).includes(status)
		? `dashboard.status.${status}`
		: "dashboard.status.pending";
}

function targetKey(type: string): string {
	return ["game", "episode", "movie", "arc"].includes(type)
		? `dashboard.target.${type}`
		: "dashboard.target.episode";
}

function targetHref(type: string, id: string): string | null {
	if (type === "episode") return `/wiki/episodes/${encodeURIComponent(id)}`;
	return { game: "/wiki/jeux", movie: "/wiki/films", arc: "/wiki/arcs" }[type] ?? null;
}

function Metric({ label, value }: { label: ReactNode; value: string }) {
	return (
		<div className="rounded-2xl border border-white/10 bg-black/25 p-4">
			<dt className="text-xs text-white/40">{label}</dt>
			<dd className="mt-1 font-saiyan text-3xl text-white">{value}</dd>
		</div>
	);
}
function Action({
	href,
	icon: Icon,
	title,
	text,
}: {
	href: string;
	icon: typeof Heart;
	title: ReactNode;
	text: ReactNode;
}) {
	return (
		<Link
			href={href}
			className="group rounded-2xl border border-white/10 bg-[#151412] p-5 transition-colors hover:border-dbz-orange/50 hover:bg-dbz-orange/[.06]"
		>
			<Icon className="h-5 w-5 text-dbz-orange" aria-hidden />
			<h3 className="mt-4 font-semibold text-white">{title}</h3>
			<p className="mt-1 text-sm leading-snug text-white/40">{text}</p>
		</Link>
	);
}
