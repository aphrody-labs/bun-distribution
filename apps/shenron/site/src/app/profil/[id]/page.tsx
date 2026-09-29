import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { DomainBar } from "@/components/kit";
import { UserNav } from "@/components/user/UserNav";
import { T } from "@/components/T";
import { ContinueRail } from "@/components/history/ContinueRail";
import { GatedWrap } from "@/components/GatedLink";
import { SectionUnavailable } from "@/components/wiki/SectionUnavailable";
import { readPublicProfileActivity } from "@/lib/account-data";
import { getMemberContributions, type MemberContributions } from "@/lib/contributors";
import { MemberLedger } from "@/components/contest/MemberLedger";
import { getProfileCardUrl } from "@/lib/assets";
import { Avatar } from "@/components/Avatar";
import { discordDefaultAvatarUrl } from "@/lib/discord-avatar";
import { getShenronUserResult } from "@/lib/shenron";
import { getCurrentUser } from "@/lib/session";
import { formatZeni } from "@/lib/zeni";
import { ProfileCardCustomizer } from "@/components/profile/ProfileCardCustomizer";

export const dynamic = "force-dynamic";
const fmt = (n: number | null | undefined) =>
	typeof n === "number" && Number.isFinite(n) ? n.toLocaleString("fr-FR") : "0";

/**
 * Un identifiant Discord est un flocon strictement numérique. On l'exige AVANT
 * d'appeler l'API du bot : `getShenronUserResult` interpole le segment tel quel
 * dans `…/api/public/user/<id>`, et un segment comme `../admin` y serait
 * normalisé par `fetch` en remontée de chemin vers une autre route de l'API.
 */
const ID_DISCORD = /^\d{5,25}$/;

export async function generateMetadata({
	params,
}: {
	params: Promise<{ id: string }>;
}): Promise<Metadata> {
	const { id } = await params;
	if (!ID_DISCORD.test(id)) return { title: "Profil introuvable", robots: { index: false } };
	const res = await getShenronUserResult(id);
	const username = res.status === "ok" ? res.user.username : null;
	return {
		title: username ? `Profil de ${username}` : "Profil de membre",
		description: username
			? `Niveau, statistiques et carte de ${username} sur Dragon Ball France.`
			: "Profil d'un membre Dragon Ball France.",
		robots: { index: false, follow: true },
	};
}

export default async function ProfilePage({
	params,
	searchParams,
}: {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ member?: string }>;
}) {
	const [{ id }, query] = await Promise.all([params, searchParams]);
	if (!ID_DISCORD.test(id)) notFound();
	const memberView = query.member === "1";
	const [result, siteActivity, ledger, viewer] = await Promise.all([
		getShenronUserResult(id),
		readPublicProfileActivity(id).catch(() => null),
		// Registre public des notes : c'est lui qui rend le concours arbitrable
		// (on peut relire fiche par fiche ce qu'un membre a réellement écrit).
		getMemberContributions(id, { limit: 200 }).catch(() => null as MemberContributions | null),
		getCurrentUser().catch(() => null),
	]);
	const isOwner = viewer?.discordId === id;
	const ownProfile = memberView && isOwner;
	if (result.status === "unavailable") {
		const unavailable = (
			<SectionUnavailable
				title={<T k="profile.unavailableTitle" />}
				message={<T k="profile.unavailableMessage" />}
				links={[
					{ href: "/leaderboard", label: <T k="profile.leaderboardLink" /> },
					{ href: "/", label: <T k="profile.homeLink" /> },
				]}
			/>
		);
		if (!ownProfile) return unavailable;
		return (
			<main className="min-h-screen bg-[#0e0d0b] px-4 py-8 text-white md:px-8 md:py-14">
				<div className="mx-auto max-w-6xl">
					<UserNav />
					{unavailable}
				</div>
			</main>
		);
	}
	if (result.status === "absent") notFound();
	const user = result.user;
	const username = user.username || "Guerrier inconnu";
	// Sans avatar personnalisé, Discord affiche l'avatar par défaut du membre,
	// dérivé de son identifiant : `(id >> 22) % 6`, en BigInt (un snowflake
	// dépasse la précision d'un `Number`, et l'ancien `% 5` visait le discriminant).
	const avatar = user.avatarUrl || discordDefaultAvatarUrl(id);
	const cardUrl = getProfileCardUrl(id);
	const equipped = user.equipped || {};
	const progress = user.xpProgress
		? Math.min(
				100,
				Math.max(0, (user.xpProgress.current / Math.max(1, user.xpProgress.nextLevelXp)) * 100)
			)
		: 0;
	const stats = [
		["XP total", fmt(user.xp)],
		["Zénis", formatZeni(user.zeni)],
		["Succès", fmt(user.achievements?.length)],
		["Objets", fmt(user.inventory?.length)],
	];
	const gear: Array<[string, string | null | undefined]> = [
		["profile.gearCard", equipped.card],
		["profile.gearBadge", equipped.badge],
		["profile.gearColor", equipped.color],
		["profile.gearTitleItem", equipped.title],
	];
	return (
		<main className="min-h-screen bg-[radial-gradient(circle_at_75%_0%,rgba(243,132,24,.14),transparent_35%),#0e0d0b] text-white">
			<div className="mx-auto max-w-6xl px-4 py-8 pb-24 md:px-8 md:py-14">
				{ownProfile && <UserNav />}
				{/* Pont staff : ouvrir le dossier d'intégrité de CE membre (concours). */}
				<DomainBar
					domain="classements"
					actions={[{ href: `/admin/concours?membre=${id}`, label: "Dossier concours du membre" }]}
					className="mb-6"
				/>
				<div className="mb-7 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<p className="font-scouter text-[11px] uppercase tracking-[.24em] text-dbz-orange">
							<T k="profile.eyebrow" />
						</p>
						<h1 className="mt-2 font-saiyan text-4xl leading-none md:text-6xl">{username}</h1>
						<ProfileBadges
							topRole={user.topRole ?? null}
							contributions={siteActivity?.counts.contributions ?? 0}
						/>
					</div>
					<Link
						href="/leaderboard"
						className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/65 transition hover:border-dbz-orange hover:text-white"
					>
						<T k="profile.leaderboard" />
					</Link>
				</div>
				<section className="relative overflow-hidden rounded-[2rem] border border-dbz-orange/30 bg-[#191611] shadow-[0_24px_80px_rgba(0,0,0,.4)]">
					<div
						className="absolute inset-0 bg-[linear-gradient(120deg,transparent_20%,rgba(246,177,45,.08),transparent_70%)]"
						aria-hidden
					/>
					<div className="relative grid gap-8 p-5 md:grid-cols-[1.05fr_.95fr] md:p-10">
						<div className="flex flex-col justify-between gap-8">
							<div className="flex items-center gap-5 md:gap-7">
								<div className="relative shrink-0">
									<Avatar
										src={avatar}
										userId={id}
										size={128}
										fluid
										priority
										className="h-24 w-24 rounded-2xl border-2 border-dbz-orange shadow-[0_0_0_5px_rgba(243,132,24,.12)] md:h-32 md:w-32"
									/>
									<span className="absolute -bottom-3 -right-3 rounded-full border-4 border-[#191611] bg-dbz-orange px-3 py-1 font-bold text-black">
										<T k="profile.levelShort" values={{ level: user.level ?? 0 }} />
									</span>
								</div>
								<div>
									<p className="text-sm text-white/50">
										<T k="profile.community" />
									</p>
									<p className="mt-2 text-sm text-white/70">
										<T
											k="profile.toNextLevel"
											values={{ level: user.xpProgress?.nextLevel ?? (user.level ?? 0) + 1 }}
										/>
									</p>
									<div className="mt-3 h-3 w-48 overflow-hidden rounded-full bg-black/60">
										<div
											className="h-full rounded-full bg-gradient-to-r from-dbz-orange to-yellow-300"
											style={{ width: `${progress}%` }}
										/>
									</div>
									<p className="mt-2 text-xs text-white/45">
										<T
											k="profile.xpOfNext"
											values={{
												current: fmt(user.xpProgress?.current),
												next: fmt(user.xpProgress?.nextLevelXp),
											}}
										/>
									</p>
								</div>
							</div>
							{user.fusion && (
								<Link
									href={`/profil/${user.fusion.partnerId}`}
									className="inline-flex w-fit items-center gap-2 rounded-full border border-fuchsia-400/30 bg-fuchsia-400/10 px-4 py-2 text-sm text-fuchsia-200 hover:bg-fuchsia-400/20"
								>
									✦ Fusion avec {user.fusion.partnerName}
								</Link>
							)}
							<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
								{stats.map(([label, value]) => (
									<div key={label} className="rounded-xl border border-white/10 bg-black/20 p-3">
										<p className="text-[10px] uppercase tracking-wider text-white/45">{label}</p>
										<p className="mt-1 text-xl font-semibold text-dbz-orange">{value}</p>
									</div>
								))}
							</div>
						</div>
						<ProfileCardCustomizer
							discordId={id}
							username={username}
							initialEquipped={equipped}
							initialCardUrl={cardUrl}
							isOwner={isOwner}
						/>
					</div>
				</section>
				{ownProfile && (
					<>
						<ContinueRail
						titleKey="history.resumeWith"
						titleValues={{ name: username }}
						className="mt-8"
					/>
						<MemberLibrary />
					</>
				)}
				{siteActivity && <SiteActivity activity={siteActivity} />}
				{ledger && <MemberLedger data={ledger} />}
				<div className="mt-6 grid gap-6 lg:grid-cols-[.8fr_1.2fr]">
					<section className="rounded-2xl border border-white/10 bg-[#141311] p-5 md:p-7">
						<h2 className="font-saiyan text-2xl text-dbz-orange">
							<T k="profile.gearTitle" />
						</h2>
						<dl className="mt-5 divide-y divide-white/10">
							{gear.map(([cle, value]) => (
								<div key={cle} className="flex items-center justify-between gap-4 py-4">
									<dt className="text-xs uppercase tracking-widest text-white/45">
										<T k={cle} />
									</dt>
									<dd
										className={
											value
												? "text-right font-semibold text-white"
												: "text-right text-sm text-white/25"
										}
									>
										{value || <T k="profile.gearEmpty" />}
									</dd>
								</div>
							))}
						</dl>
					</section>
					<div className="space-y-6">
						<section className="rounded-2xl border border-white/10 bg-[#141311] p-5 md:p-7">
							<div className="flex items-end justify-between gap-4">
								<div>
									<h2 className="font-saiyan text-2xl text-dbz-orange">
										<T k="profile.inventoryTitle" />
									</h2>
									<p className="mt-1 text-sm text-white/45">
										<T
											k="profile.inventoryCount"
											values={{ count: user.inventory?.length || 0 }}
										/>
									</p>
								</div>
								<Link href="/shop" className="text-sm text-dbz-blue-light hover:text-dbz-orange">
									<T k="profile.shop" />
								</Link>
							</div>
							{user.inventory?.length ? (
								<ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
									{user.inventory.map((item, i) => (
										<li
											key={`${item.type}-${item.key}-${i}`}
											className="rounded-xl border border-white/10 bg-black/20 p-4"
										>
											<span className="block truncate text-sm font-semibold text-white">
												{item.key}
											</span>
											<span className="mt-1 block text-[10px] uppercase tracking-wider text-white/40">
												{item.type}
											</span>
										</li>
									))}
								</ul>
							) : (
								<p className="mt-5 rounded-xl border border-dashed border-white/15 p-5 text-sm text-white/40">
									<T k="profile.inventoryEmpty" />
								</p>
							)}
						</section>
						<section className="rounded-2xl border border-white/10 bg-[#141311] p-5 md:p-7">
							<h2 className="font-saiyan text-2xl text-dbz-orange">
								<T k="profile.achievementsTitle" />
							</h2>
							{user.achievements?.length ? (
								<ul className="mt-5 flex flex-wrap gap-2">
									{user.achievements.slice(0, 12).map((ach, i) => (
										<li
											key={`${ach.code}-${i}`}
											className="rounded-full border border-yellow-300/25 bg-yellow-300/10 px-3 py-2 text-xs text-yellow-100"
										>
											✦ {ach.code}
										</li>
									))}
								</ul>
							) : (
								<p className="mt-5 text-sm text-white/40">
									<T k="profile.achievementsEmpty" />
								</p>
							)}
						</section>
					</div>
				</div>
			</div>
		</main>
	);
}

type PublicActivity = NonNullable<Awaited<ReturnType<typeof readPublicProfileActivity>>>;

const LIBRARY_LINKS = [
	{
		href: "/wiki/episodes",
		titleKey: "categories.episodes.label",
		textKey: "profile.libraryEpisodesText",
	},
	{
		href: "/wiki/films",
		titleKey: "categories.films.label",
		textKey: "profile.libraryMoviesText",
	},
	{
		href: "/wiki/manga",
		titleKey: "categories.manga.label",
		textKey: "profile.libraryMangaText",
	},
	{
		href: "/wiki/databooks",
		titleKey: "categories.databooks.label",
		textKey: "profile.libraryDatabooksText",
	},
] as const;

function MemberLibrary() {
	return (
		<section aria-labelledby="library-title" className="mt-8">
			<div className="mb-4 flex items-end justify-between gap-4">
				<div>
					<h2 id="library-title" className="font-saiyan text-3xl text-dbz-orange">
						<T k="profile.libraryTitle" />
					</h2>
					<p className="mt-1 text-sm text-white/45">
						<T k="profile.libraryLead" />
					</p>
				</div>
				<Link href="/favoris" className="text-sm font-semibold text-white/60 hover:text-dbz-orange">
					<T k="profile.myList" />
				</Link>
			</div>
			<ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				{LIBRARY_LINKS.map((item) => (
					<li key={item.href}>
						<GatedWrap
							href={item.href}
							className="group flex h-full min-h-32 flex-col justify-end rounded-2xl border border-white/10 bg-[linear-gradient(145deg,rgba(243,132,24,.11),rgba(255,255,255,.025))] p-5 hover:border-dbz-orange/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dbz-orange"
						>
							<h3 className="text-lg font-semibold text-white group-hover:text-dbz-orange">
								<T k={item.titleKey} />
							</h3>
							<p className="mt-1 text-sm leading-snug text-white/45">
								<T k={item.textKey} />
							</p>
						</GatedWrap>
					</li>
				))}
			</ul>
		</section>
	);
}

function SiteActivity({ activity }: { activity: PublicActivity }) {
	const hasRecent = activity.recentRatings.length > 0 || activity.recentTierlists.length > 0;
	return (
		<section
			aria-labelledby="site-activity-title"
			className="mt-8 rounded-3xl border border-white/10 bg-[#141311] p-5 md:p-7"
		>
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<h2 id="site-activity-title" className="font-saiyan text-3xl text-dbz-orange">
						<T k="profile.activityTitle" />
					</h2>
					<p className="mt-1 text-sm text-white/45">
						<T k="profile.activityLead" />
					</p>
				</div>
				<Link
					href="/tierlists"
					className="text-sm font-semibold text-white/60 hover:text-dbz-orange"
				>
					<T k="profile.seeTierlists" />
				</Link>
			</div>
			<dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
				<SiteMetric label={<T k="profile.metricRatings" />} value={activity.counts.ratings} />
				<SiteMetric label={<T k="profile.metricTierlists" />} value={activity.counts.tierlists} />
				<SiteMetric
					label={<T k="profile.metricContributions" />}
					value={activity.counts.contributions}
				/>
				<SiteMetric label={<T k="profile.metricComments" />} value={activity.counts.comments} />
			</dl>
			{hasRecent && (
				<div className="mt-6 grid gap-6 md:grid-cols-2">
					{activity.recentRatings.length > 0 && (
						<div>
							<h3 className="text-sm font-semibold text-white/75">
								<T k="profile.recentRatings" />
							</h3>
							<ul className="mt-2 divide-y divide-white/10">
								{activity.recentRatings.map((rating) => (
									<li key={rating.id}>
										<Link
											href={ratingHref(rating.targetType, rating.targetId)}
											className="flex min-h-11 items-center justify-between gap-4 py-2 text-sm hover:text-dbz-orange"
										>
											<span>
												<T k={ratingKey(rating.targetType)} />
											</span>
											<strong className="text-dbz-orange">{rating.score}/5</strong>
										</Link>
									</li>
								))}
							</ul>
						</div>
					)}
					{activity.recentTierlists.length > 0 && (
						<div>
							<h3 className="text-sm font-semibold text-white/75">
								<T k="profile.recentTierlists" />
							</h3>
							<ul className="mt-2 divide-y divide-white/10">
								{activity.recentTierlists.map((tierlist) => (
									<li key={tierlist.id}>
										<Link
											href={`/tierlists/${tierlist.slug}`}
											className="flex min-h-11 items-center py-2 text-sm font-medium hover:text-dbz-orange"
										>
											{tierlist.title}
										</Link>
									</li>
								))}
							</ul>
						</div>
					)}
				</div>
			)}
		</section>
	);
}

function SiteMetric({ label, value }: { label: ReactNode; value: number }) {
	return (
		<div className="rounded-2xl border border-white/10 bg-black/20 p-4">
			<dt className="text-xs leading-snug text-white/45">{label}</dt>
			<dd className="mt-1 font-saiyan text-3xl text-white">{fmt(value)}</dd>
		</div>
	);
}

function ratingKey(type: string): string {
	return ["episode", "movie", "game", "arc"].includes(type)
		? `profile.target.${type}`
		: "profile.target.other";
}

function ratingHref(type: string, id: string) {
	if (type === "episode") return `/wiki/episodes/${encodeURIComponent(id)}`;
	return { movie: "/wiki/films", game: "/wiki/jeux", arc: "/wiki/arcs" }[type] ?? "/wiki";
}

/** Couleur de repli d'un rôle Discord sans couleur. */
const ROLE_NEUTRAL = "rgba(255,255,255,.55)";

/**
 * Rôle Discord le plus haut et badge « Contributeur ».
 *
 * Le badge récompense les contributions ACCEPTÉES au wiki — pas les brouillons
 * ni les propositions refusées : il doit dire « a amélioré le site », que la
 * relecture éditoriale a déjà vérifié.
 */
function ProfileBadges({
	topRole,
	contributions,
}: {
	topRole: { id: string; name: string; color: string | null } | null;
	contributions: number;
}) {
	if (!topRole && contributions <= 0) return null;
	return (
		<ul className="mt-3 flex flex-wrap items-center gap-2" aria-label="Rôle et distinctions">
			{topRole && (
				<li
					className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold"
					style={{
						borderColor: topRole.color ?? ROLE_NEUTRAL,
						color: topRole.color ?? ROLE_NEUTRAL,
					}}
				>
					<span
						aria-hidden
						className="h-2 w-2 rounded-full"
						style={{ background: topRole.color ?? ROLE_NEUTRAL }}
					/>
					<span className="sr-only">
						<T k="profile.topRoleLabel" />{" "}
					</span>
					{topRole.name}
				</li>
			)}
			{contributions > 0 && (
				<li className="inline-flex items-center gap-1.5 rounded-full border border-dbz-yellow/60 bg-dbz-yellow/10 px-3 py-1 text-xs font-bold text-dbz-yellow">
					<span aria-hidden className="font-saiyan text-[11px]">
						筆
					</span>
					<T k="profile.contributorBadge" />
					<span className="font-normal text-dbz-yellow/70">
						· <T k="profile.contributorCount" values={{ count: contributions }} />
					</span>
				</li>
			)}
		</ul>
	);
}
