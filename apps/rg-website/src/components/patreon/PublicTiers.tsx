import { Button } from "@rosegriffon/ui";

import { Check, ExternalLink } from "@/lib/icons-config";
import { cn } from "@/lib/utils";

interface Tier {
	key: "roy" | "gaelle" | "evans" | "communaute" | "route-victoire";
	name: string;
	priceCents: number | null;
	tagline: string;
	perks: string[];
	href: string;
	cta: string;
	/** Palier mis en avant : bordure et pastille « tier phare ». */
	highlight?: boolean;
	/** Palier gratuit : bouton secondaire, pas d'appel au don. */
	free?: boolean;
	patrons?: number;
}

const PATREON_URL = "https://patreon.com/RoseGriffon";

const FEATURED_TIERS: Tier[] = [
	{
		cta: "Choisir Roy",
		href: PATREON_URL,
		key: "roy",
		name: "𝙽𝚒𝚟𝚎𝚊𝚞 𝚁𝚘𝚢 🌹",
		perks: [
			"Rôle Discord dédié Roy",
			"Mention au générique des chroniques",
			"Accès aux annonces avant tout le monde",
		],
		priceCents: 250,
		tagline: "Premier pas de soutien",
	},
	{
		cta: "Choisir Gaëlle",
		href: PATREON_URL,
		key: "gaelle",
		name: "𝙽𝚒𝚟𝚎𝚊𝚞 𝙶𝚊𝚎𝚕𝚕𝚎 🌹",
		perks: [
			"Tous les avantages Roy",
			"Accès aux articles en avant-première",
			"Vote sur les futurs sujets traités",
		],
		priceCents: 750,
		tagline: "Soutien renforcé",
	},
	{
		cta: "Choisir Evans",
		highlight: true,
		href: PATREON_URL,
		key: "evans",
		name: "𝙽𝚒𝚟𝚎𝚊𝚞 𝙴𝚟𝚊𝚗𝚜 🌹",
		patrons: 8,
		perks: [
			"Tous les avantages Gaëlle",
			"Pack Personnage trimestriel offert (print A5 + marque-page + sticker + grand badge)",
			"Salon Discord privé avec l'équipe",
			"Cartes de licence Roy & Gaëlle exclusives (25 premiers)",
		],
		priceCents: 1450,
		tagline: "Tier-phare · Soutien complet",
	},
];

const SIDE_TIERS: Tier[] = [
	{
		cta: "Rejoindre Discord",
		free: true,
		href: "https://discord.gg/8X8eQfBMkt",
		key: "communaute",
		name: "Communauté",
		perks: [
			"Accès au serveur Discord Rose Griffon",
			"Newsletter occasionnelle",
			"Suivi des chroniques et événements",
		],
		priceCents: 0,
		tagline: "Gratuit · Rejoindre la communauté",
	},
	{
		cta: "Devenir grand mécène",
		href: PATREON_URL,
		key: "route-victoire",
		name: "𝚁𝚘𝚞𝚝𝚎 𝚅𝚒𝚌𝚝𝚘𝚒𝚛𝚎 🥀",
		perks: [
			"Avantages identiques à Niveau Evans",
			"Mention spéciale comme grand mécène",
			"Réservé à celles et ceux qui veulent aller plus loin",
		],
		priceCents: 4900,
		tagline: "Pour soutenir massivement",
	},
];

function formatPrice(cents: number | null): string {
	if (cents === null) {
		return "—";
	}
	if (cents === 0) {
		return "Gratuit";
	}
	return `${(cents / 100).toFixed(2).replace(".", ",")} €/mois`;
}

function TierCard({ tier }: { tier: Tier }) {
	return (
		<div
			className={cn(
				"relative flex h-full flex-col rounded-2xl border bg-card p-6 text-card-foreground transition",
				tier.highlight ? "border-primary shadow-lg shadow-primary/20 lg:scale-[1.02]" : "border-border"
			)}
		>
			{tier.highlight && (
				<div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">
					TIER PHARE
				</div>
			)}
			<p
				className={cn(
					"mb-3 inline-block w-fit rounded-md border px-2 py-1 text-xs font-semibold",
					tier.highlight
						? "border-primary/40 bg-primary/10 text-primary"
						: "border-border bg-muted text-muted-foreground"
				)}
			>
				{tier.tagline}
			</p>
			<h3 className="text-lg font-bold text-foreground">{tier.name}</h3>
			<p className="mt-1 mb-4 text-2xl font-bold text-primary">{formatPrice(tier.priceCents)}</p>
			<ul className="space-y-2 text-sm text-foreground/85">
				{tier.perks.map((perk) => (
					<li key={perk} className="flex gap-2">
						<Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
						<span>{perk}</span>
					</li>
				))}
			</ul>
			{tier.patrons !== undefined && tier.patrons > 0 && (
				<p className="mt-4 text-xs text-muted-foreground">
					{tier.patrons} mécène{tier.patrons > 1 ? "s" : ""} actuellement
				</p>
			)}
			<div className="mt-auto pt-6">
				<Button
					asChild
					size="lg"
					variant={tier.free ? "outline" : tier.highlight ? "default" : "secondary"}
					// `whitespace-normal` : le libellé le plus long déborderait sinon à 320 px.
					className="h-auto min-h-12 w-full rounded-full px-4 py-3 whitespace-normal"
				>
					<a href={tier.href} target="_blank" rel="noopener noreferrer">
						{tier.cta}
						<ExternalLink className="size-4" aria-hidden />
					</a>
				</Button>
			</div>
		</div>
	);
}

export function PublicTiers() {
	return (
		<div className="space-y-10">
			<div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
				{FEATURED_TIERS.map((tier) => (
					<TierCard key={tier.key} tier={tier} />
				))}
			</div>

			<div className="space-y-4">
				<p className="text-center text-sm font-medium tracking-wider text-muted-foreground uppercase">
					Autres options
				</p>
				<div className="grid gap-6 md:grid-cols-2">
					{SIDE_TIERS.map((tier) => (
						<TierCard key={tier.key} tier={tier} />
					))}
				</div>
			</div>
		</div>
	);
}
