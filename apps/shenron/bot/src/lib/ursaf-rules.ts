/**
 * URSAF — Union de Recouvrement des Saiyens et Autres Fraudeurs.
 *
 * Calcul pur d'un avis d'imposition à partir des signalements anti-triche d'un
 * membre. Principes :
 *  - on ne taxe que ce qui DÉPASSE un seuil mesuré (un gain de 1 M sur un seuil
 *    de 25 000 : base de 975 000), jamais le solde entier ;
 *  - pas de double imposition : un même gain peut lever un plafond horaire ET
 *    un plafond journalier — pour ces fenêtres qui se recouvrent, on garde le
 *    plus gros excès ; seuls les pics, gains distincts, s'additionnent ;
 *  - le taux dépend de la sévérité la plus haute, majoré en cas de récidive,
 *    et ne dépasse jamais 95 % ;
 *  - un avis ne prend jamais plus de la moitié du solde : l'URSAF recouvre,
 *    elle ne ruine pas. Simulation du 2026-09-12 sans ce plafond : un avis de
 *    27,3 M sur un solde de 27,9 M, levé par un simple ratio fortune/niveau.
 */

export type FlagSeverity = "low" | "medium" | "high" | "critical";

export type FlagInput = {
	id: number;
	code: string;
	severity: FlagSeverity;
	meta: Record<string, unknown>;
};

export type UrsafRates = Record<FlagSeverity, number>;

const DEFAULT_URSAF_RATES: UrsafRates = {
	low: 0,
	medium: 0.25,
	high: 0.5,
	critical: 0.9,
};

/** Majoration par avis déjà recouvré. */
const RECIDIVE_SURCHARGE = 0.1;
export const MAX_RATE = 0.95;
/** En dessous, pas d'avis : le coût administratif dépasse la créance. */
const MIN_NOTICE = 1_000;
/** Part maximale du solde qu'un avis peut prélever. */
export const MAX_BALANCE_SHARE = 0.5;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const SEVERITY_ORDER: FlagSeverity[] = ["low", "medium", "high", "critical"];

/** Excès imposable d'un signalement (0 pour les signaux sans montant). */
export function flagExcess(flag: FlagInput): { gains: number; wealth: number } {
	const m = flag.meta;
	switch (flag.code) {
		case "SPIKE":
			return { gains: Math.max(0, num(m.amount) - num(m.threshold)), wealth: 0 };
		case "HOURLY_CAP":
			return { gains: Math.max(0, num(m.hourSum) - num(m.threshold)), wealth: 0 };
		case "DAILY_CAP":
			return { gains: Math.max(0, num(m.daySum) - num(m.threshold)), wealth: 0 };
		case "RATIO":
			return { gains: 0, wealth: Math.max(0, num(m.balance) - num(m.maxReasonable)) };
		default:
			return { gains: 0, wealth: 0 };
	}
}

export type Assessment = {
	taxable: number;
	rate: number;
	amount: number;
	severity: FlagSeverity;
	flagIds: number[];
};

export function assess(input: {
	flags: readonly FlagInput[];
	balance: number;
	previousNotices: number;
	rates?: Partial<UrsafRates>;
}): Assessment | null {
	const flags = input.flags.filter((f) => SEVERITY_ORDER.includes(f.severity));
	if (flags.length === 0) return null;
	const rates = { ...DEFAULT_URSAF_RATES, ...input.rates };

	let spikes = 0;
	let windows = 0;
	let wealth = 0;
	for (const f of flags) {
		const e = flagExcess(f);
		if (f.code === "SPIKE") spikes += e.gains;
		else windows = Math.max(windows, e.gains);
		wealth = Math.max(wealth, e.wealth);
	}
	const taxable = Math.floor(Math.max(spikes, windows, wealth));

	const severity = flags.reduce<FlagSeverity>(
		(acc, f) =>
			SEVERITY_ORDER.indexOf(f.severity) > SEVERITY_ORDER.indexOf(acc) ? f.severity : acc,
		"low"
	);
	const base = Math.max(0, Math.min(1, rates[severity] ?? 0));
	const rate =
		base === 0
			? 0
			: Math.min(MAX_RATE, base * (1 + RECIDIVE_SURCHARGE * Math.max(0, input.previousNotices)));
	const amount = Math.floor(Math.min(taxable * rate, Math.max(0, input.balance) * MAX_BALANCE_SHARE));
	if (amount < MIN_NOTICE) return null;

	return {
		taxable,
		rate: Math.round(rate * 1000) / 1000,
		amount,
		severity,
		flagIds: flags.map((f) => f.id),
	};
}

/** `URSAF-2026-000042` */
export function noticeReference(id: number, date = new Date()): string {
	return `URSAF-${date.getUTCFullYear()}-${String(id).padStart(6, "0")}`;
}
