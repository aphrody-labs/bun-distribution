/**
 * Formatters portables (dates / nombres / devise ACH).
 *
 * Implémentés via l'API standard `Intl` (zéro dépendance, dispo navigateur /
 * edge / Node / Bun). Le bot, lui, formate ses dates via dayjs+timezone ; ces
 * helpers offrent l'équivalent portable côté web / edge / scripts.
 */

/** Fuseau horaire par défaut d'Achilléa (cohérent avec `generalConfig.timezone`). */
export const DEFAULT_TIMEZONE = "Europe/Paris";

/** Locale d'affichage par défaut. */
export const DEFAULT_LOCALE = "fr-FR";

/** Symbole / code de la monnaie interne Achilléa. */
export const ACH_CURRENCY_SYMBOL = "ACH";

/** Masques de date supportés (équivalents aux masques dayjs du bot). */
export type DateMask = "default" | "onlyDate" | "onlyDateFileName";

/**
 * Formate une date selon un masque nommé, dans un fuseau donné.
 *
 * - `default`           → `DD/MM/YYYY - HH:mm:ss`
 * - `onlyDate`          → `DD/MM/YYYY`
 * - `onlyDateFileName`  → `YYYY-MM-DD`
 */
export function formatDate(
	date: Date | number | string,
	mask: DateMask = "default",
	timeZone: string = DEFAULT_TIMEZONE
): string {
	const d = date instanceof Date ? date : new Date(date);
	const parts = dateParts(d, timeZone);

	switch (mask) {
		case "onlyDate":
			return `${parts.day}/${parts.month}/${parts.year}`;
		case "onlyDateFileName":
			return `${parts.year}-${parts.month}-${parts.day}`;
		default:
			return `${parts.day}/${parts.month}/${parts.year} - ${parts.hour}:${parts.minute}:${parts.second}`;
	}
}

/** Formate un nombre selon la locale (séparateurs de milliers, décimales). */
export function formatNumber(
	value: number,
	options: Intl.NumberFormatOptions = {},
	locale: string = DEFAULT_LOCALE
): string {
	return new Intl.NumberFormat(locale, options).format(value);
}

/**
 * Formate un montant en monnaie interne Achilléa (`ACH`).
 * Ex. `formatAchCurrency(1500)` → `"1 500 ACH"`.
 */
export function formatAchCurrency(
	amount: number,
	locale: string = DEFAULT_LOCALE,
	options: Intl.NumberFormatOptions = {}
): string {
	return `${formatNumber(amount, { maximumFractionDigits: 0, ...options }, locale)} ${ACH_CURRENCY_SYMBOL}`;
}

// ── Helpers internes ─────────────────────────────────────────────────────────

interface DatePieces {
	year: string;
	month: string;
	day: string;
	hour: string;
	minute: string;
	second: string;
}

function dateParts(date: Date, timeZone: string): DatePieces {
	const formatter = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	});

	const pieces: Record<string, string> = {};
	for (const part of formatter.formatToParts(date)) {
		if (part.type !== "literal") pieces[part.type] = part.value;
	}

	// Accès indexé et non par point : `noPropertyAccessFromIndexSignature` est
	// actif chez certains consommateurs (app Angular), qui compilent ces sources.
	return {
		year: pieces["year"] ?? "0000",
		month: pieces["month"] ?? "00",
		day: pieces["day"] ?? "00",
		// `Intl` rend "24" à minuit en hour12:false sur certains runtimes : on borne à "00".
		hour: pieces["hour"] === "24" ? "00" : (pieces["hour"] ?? "00"),
		minute: pieces["minute"] ?? "00",
		second: pieces["second"] ?? "00",
	};
}
