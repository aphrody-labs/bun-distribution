import { Badge, Card, CardContent } from "@rosegriffon/ui";
import { format, formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import {
	BadgeCheck,
	CalendarClock,
	Clock,
	CreditCard,
	Crown,
	Gauge,
	Heart,
	History,
	Mail,
	Sparkles,
	Trophy,
} from "lucide-react";

import { PATRON_DISCOUNT_PERCENT } from "@/lib/patreon/discount";
import { createPostgresClient } from "@rosegriffon/db/service";

type PatronStatus = "active_patron" | "declined_patron" | "former_patron" | null;

interface PatreonAddress {
	line_1?: string | null;
	line_2?: string | null;
	city?: string | null;
	state?: string | null;
	country?: string | null;
	postal_code?: string | null;
	addressee?: string | null;
}

interface MembershipRow {
	patron_status: PatronStatus;
	patreon_email: string | null;
	patreon_full_name: string | null;
	patreon_thumb_url: string | null;
	patreon_url: string | null;
	last_charge_date: string | null;
	last_charge_status: string | null;
	currently_entitled_cents: number | null;
	lifetime_support_cents: number | null;
	pledge_start: string | null;
	pledge_cadence: number | null;
	will_pay_amount_cents: number | null;
	next_charge_date: string | null;
	is_free_trial: boolean | null;
	is_gifted: boolean | null;
	member_email: string | null;
	address: PatreonAddress | null;
	tier_titles: string[] | null;
	tier_amounts_cents: number[] | null;
	tier_requires_shipping: boolean[] | null;
	discord_role_ids: string[] | null;
	scope: string | null;
	fetched_at: string | null;
	created_at: string | null;
}

interface LegacyRow {
	patron_status: string | null;
	currently_entitled_cents: number | null;
	lifetime_support_cents: number | null;
	tier_titles: string[] | null;
	last_charge_date: string | null;
	last_charge_status: string | null;
	pledge_start: string | null;
	rg_subscription_status: string;
	resolution_method: string | null;
	resolved_at: string | null;
}

const STATUS_LABEL: Record<NonNullable<PatronStatus>, string> = {
	active_patron: "Patron actif",
	declined_patron: "Paiement refusé",
	former_patron: "Ancien patron",
};

const STATUS_BADGE: Record<NonNullable<PatronStatus>, string> = {
	active_patron: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
	declined_patron: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
	former_patron: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
};

const RG_LEGACY_LABEL: Record<string, string> = {
	churned: "N'a pas réactivé",
	grandfathered: "Tarif garanti à vie",
	pending: "En attente de réactivation",
	reactivated: "Réabonné via la boutique",
};

function formatEur(cents: number | null | undefined): string {
	if (cents == null) {
		return "—";
	}
	return new Intl.NumberFormat("fr-FR", {
		currency: "EUR",
		minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
		style: "currency",
	}).format(cents / 100);
}

function formatDate(iso: string | null | undefined): string {
	if (!iso) {
		return "—";
	}
	return format(new Date(iso), "d MMMM yyyy", { locale: fr });
}

/**
 * Carte profil enrichie : affichée sur `/profil/[username]` quand
 * `isOwnProfile === true` ET (membership actif OU legacy snapshot).
 *
 * Source des données :
 *  - `patreon_memberships` : état live (rempli par le callback OAuth + webhooks)
 *  - `patreon_legacy_members` : snapshot historique J-0 de la migration
 *
 * Aucun fetch live à Patreon ici — on s'appuie sur les tables locales
 * pour garantir performance (server component RSC + cache Next).
 */
export async function PatreonMembershipCard({ userId }: { userId: string }) {
	const db = createPostgresClient();

	const [liveRes, legacyRes] = await Promise.all([
		db
			.from("patreon_memberships")
			.select(
				"patron_status, patreon_email, patreon_full_name, patreon_thumb_url, patreon_url, last_charge_date, last_charge_status, currently_entitled_cents, lifetime_support_cents, pledge_start, pledge_cadence, will_pay_amount_cents, next_charge_date, is_free_trial, is_gifted, member_email, address, tier_titles, tier_amounts_cents, tier_requires_shipping, discord_role_ids, scope, fetched_at, created_at"
			)
			.eq("user_id", userId)
			.order("currently_entitled_cents", { ascending: false })
			.limit(1)
			.maybeSingle(),
		db
			.from("patreon_legacy_members")
			.select(
				"patron_status, currently_entitled_cents, lifetime_support_cents, tier_titles, last_charge_date, last_charge_status, pledge_start, rg_subscription_status, resolution_method, resolved_at"
			)
			.eq("resolved_user_id", userId)
			.order("lifetime_support_cents", { ascending: false })
			.limit(1)
			.maybeSingle(),
	]);
	const live = (liveRes.data as MembershipRow | null) ?? null;
	const legacy = (legacyRes.data as LegacyRow | null) ?? null;

	// Rien à afficher si l'utilisateur n'est ni lié ni connu en legacy.
	if (!live && !legacy) {
		return null;
	}

	const status: PatronStatus = (live?.patron_status as PatronStatus) ?? null;
	const isActive = status === "active_patron";
	const wasMember =
		Boolean(legacy) ||
		(Boolean(status) && (status === "former_patron" || status === "declined_patron"));

	const tierTitle =
		(live?.tier_titles && live.tier_titles[0]) ||
		(legacy?.tier_titles && legacy.tier_titles[0]) ||
		null;
	const tierAmount =
		live?.tier_amounts_cents?.[0] ??
		live?.currently_entitled_cents ??
		legacy?.currently_entitled_cents ??
		null;
	const lifetimeCents = live?.lifetime_support_cents ?? legacy?.lifetime_support_cents ?? null;
	const pledgeStart = live?.pledge_start ?? legacy?.pledge_start ?? null;
	const lastChargeDate = live?.last_charge_date ?? legacy?.last_charge_date ?? null;
	const lastChargeStatus = live?.last_charge_status ?? legacy?.last_charge_status ?? null;
	const cadence = live?.pledge_cadence;
	const willPay = live?.will_pay_amount_cents ?? null;
	const nextCharge = live?.next_charge_date ?? null;
	const isFreeTrial = live?.is_free_trial === true;
	const isGifted = live?.is_gifted === true;
	const requiresShipping = live?.tier_requires_shipping?.some((b) => b === true) ?? false;
	const address = live?.address ?? null;
	const rolesCount = live?.discord_role_ids?.length ?? 0;
	const fetchedAt = live?.fetched_at ?? null;
	const linkedAt = live?.created_at ?? null;
	const legacyStatusLabel = legacy
		? (RG_LEGACY_LABEL[legacy.rg_subscription_status] ?? legacy.rg_subscription_status)
		: null;

	const accent = isActive
		? "border-emerald-500/30 bg-linear-to-br from-emerald-500/5 via-card to-card"
		: wasMember
			? "border-zinc-500/20 bg-card"
			: "border-[#FF424D]/30 bg-card";

	return (
		<Card className={accent}>
			<CardContent className="space-y-5 p-5">
				{/* Header */}
				<div className="flex flex-wrap items-start justify-between gap-4">
					<div className="flex items-start gap-3">
						<div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#FF424D]/10 text-[#FF424D]">
							<Heart className="size-5" />
						</div>
						<div className="min-w-0">
							<div className="flex flex-wrap items-center gap-2">
								<p className="font-semibold text-foreground">Mon Patreon</p>
								{status && (
									<span
										className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[status]}`}
									>
										{STATUS_LABEL[status]}
									</span>
								)}
								{!status && legacy && (
									<span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
										Ancien soutien (avant migration)
									</span>
								)}
							</div>
							{live?.patreon_url ? (
								<a
									href={live.patreon_url}
									target="_blank"
									rel="noopener noreferrer"
									className="mt-1 block text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
								>
									{live.patreon_full_name || live.patreon_email || "Voir sur Patreon"}
								</a>
							) : live?.patreon_email ? (
								<p className="mt-1 text-sm text-muted-foreground">
									{live.patreon_full_name || live.patreon_email}
								</p>
							) : null}
						</div>
					</div>

					<div className="flex flex-wrap items-center gap-2">
						{isActive && (
							<Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300">
								<Sparkles className="mr-1 size-3" />-{PATRON_DISCOUNT_PERCENT}% sur la boutique
							</Badge>
						)}
						{isFreeTrial && (
							<Badge className="bg-sky-500/15 text-sky-700 hover:bg-sky-500/20 dark:text-sky-300">
								Essai gratuit
							</Badge>
						)}
						{isGifted && (
							<Badge className="bg-fuchsia-500/15 text-fuchsia-700 hover:bg-fuchsia-500/20 dark:text-fuchsia-300">
								Cadeau
							</Badge>
						)}
					</div>
				</div>

				{/* Tier actif */}
				{tierTitle && (
					<div className="rounded-lg border border-border bg-muted/40 p-4">
						<div className="flex flex-wrap items-center justify-between gap-3">
							<div className="flex items-center gap-2">
								<Crown className="size-4 text-amber-500" />
								<span className="font-semibold text-foreground">{tierTitle}</span>
							</div>
							<div className="text-right">
								<p className="font-mono text-base font-semibold text-foreground">
									{formatEur(tierAmount)}
									<span className="ml-1 text-xs font-normal text-muted-foreground">
										/ {cadence === 12 ? "an" : "mois"}
									</span>
								</p>
								{willPay != null && willPay !== tierAmount && (
									<p className="text-xs text-muted-foreground">
										Prochaine charge : {formatEur(willPay)}
									</p>
								)}
							</div>
						</div>
						{rolesCount > 0 && (
							<p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
								<BadgeCheck className="h-3.5 w-3.5 text-sky-500" />
								{rolesCount} rôle{rolesCount > 1 ? "s" : ""} Discord synchronisé
								{rolesCount > 1 ? "s" : ""}
							</p>
						)}
					</div>
				)}

				{/* Stats */}
				<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
					<Stat icon={Trophy} label="Soutien total" value={formatEur(lifetimeCents)} highlight />
					<Stat
						icon={CalendarClock}
						label="Patron depuis"
						value={
							pledgeStart
								? formatDistanceToNow(new Date(pledgeStart), {
										addSuffix: false,
										locale: fr,
									})
								: "—"
						}
					/>
					<Stat
						icon={CreditCard}
						label="Dernier paiement"
						value={
							lastChargeDate
								? `${formatDate(lastChargeDate)}${lastChargeStatus ? ` · ${lastChargeStatus}` : ""}`
								: "—"
						}
					/>
					<Stat
						icon={Gauge}
						label="Cadence"
						value={cadence === 12 ? "Annuelle" : cadence === 1 ? "Mensuelle" : "—"}
					/>
					{nextCharge && (
						<Stat
							icon={CalendarClock}
							label="Prochaine charge"
							value={`${formatDate(nextCharge)}${willPay ? ` · ${formatEur(willPay)}` : ""}`}
						/>
					)}
				</div>

				{/* Adresse de livraison — si tier requires_shipping ET adresse renseignée */}
				{requiresShipping && address && (
					<div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
						<div className="mb-2 flex items-center gap-2 font-semibold text-foreground">
							<Mail className="size-4 text-muted-foreground" />
							Adresse de livraison Patreon
						</div>
						<address className="not-italic text-xs text-muted-foreground leading-relaxed">
							{address.addressee && (
								<>
									{address.addressee}
									<br />
								</>
							)}
							{address.line_1 && (
								<>
									{address.line_1}
									<br />
								</>
							)}
							{address.line_2 && (
								<>
									{address.line_2}
									<br />
								</>
							)}
							{[address.postal_code, address.city].filter(Boolean).join(" ")}
							{address.state ? `, ${address.state}` : ""}
							{address.country ? (
								<>
									<br />
									{address.country}
								</>
							) : (
								""
							)}
						</address>
					</div>
				)}

				{/* Bloc legacy (historique pré-migration) */}
				{legacy && (
					<div className="rounded-lg border border-dashed border-amber-500/30 bg-amber-500/5 p-4 text-sm">
						<div className="mb-2 flex items-center gap-2 font-semibold text-amber-700 dark:text-amber-300">
							<History className="size-4" />
							Historique pré-migration RG
						</div>
						<dl className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
							{legacyStatusLabel && <DescItem label="Statut" value={legacyStatusLabel} />}
							{legacy.tier_titles?.[0] && (
								<DescItem label="Tier d'origine" value={legacy.tier_titles[0]} />
							)}
							{legacy.lifetime_support_cents != null && (
								<DescItem
									label="Soutien historique"
									value={formatEur(legacy.lifetime_support_cents)}
								/>
							)}
							{legacy.resolved_at && (
								<DescItem label="Compte rapproché le" value={formatDate(legacy.resolved_at)} />
							)}
							{legacy.resolution_method && (
								<DescItem
									label="Via"
									value={
										legacy.resolution_method === "email"
											? "email"
											: legacy.resolution_method === "discord_id"
												? "Discord"
												: "manuel"
									}
								/>
							)}
						</dl>
					</div>
				)}

				{/* Métadonnées techniques (own profile only — déjà filtré côté parent) */}
				<div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
					{linkedAt ? (
						<span className="inline-flex items-center gap-1.5">
							<Mail className="h-3.5 w-3.5" />
							Lié le {formatDate(linkedAt)}
						</span>
					) : (
						<span />
					)}
					{fetchedAt && (
						<span className="inline-flex items-center gap-1.5">
							<Clock className="h-3.5 w-3.5" />
							Dernière sync :{" "}
							{formatDistanceToNow(new Date(fetchedAt), {
								addSuffix: true,
								locale: fr,
							})}
						</span>
					)}
				</div>
			</CardContent>
		</Card>
	);
}

function Stat({
	icon: Icon,
	label,
	value,
	highlight,
}: {
	icon: typeof Heart;
	label: string;
	value: string;
	highlight?: boolean;
}) {
	return (
		<div className="rounded-lg border border-border bg-card/60 p-3">
			<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
				<Icon className="h-3.5 w-3.5" />
				{label}
			</div>
			<p className={`mt-1 font-semibold ${highlight ? "text-foreground" : "text-foreground/90"}`}>
				{value}
			</p>
		</div>
	);
}

function DescItem({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-center justify-between gap-2 text-xs">
			<dt className="text-muted-foreground/80">{label}</dt>
			<dd className="font-medium text-foreground">{value}</dd>
		</div>
	);
}
