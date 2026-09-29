/**
 * Analyse des entrées utilisateur (options de commande, champs de modale).
 *
 * But : signaler dans le salon des commandes ce qui ressemble à une tentative
 * d'abus, pas bloquer. Chaque constat porte un poids ; au-delà d'un score, la
 * commande est journalisée avec son contenu (tronqué et neutralisé).
 *
 * Les classes de caractères sont écrites en échappements `\uXXXX` : en clair,
 * ces caractères sont invisibles dans l'éditeur comme dans une revue de code.
 */

export type InputFinding = {
	code: string;
	weight: number;
	detail: string;
};

export type InputAudit = {
	score: number;
	findings: InputFinding[];
};

const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/;
const BIDI = /[\u202A-\u202E\u2066-\u2069]/;
/** Caractères de contrôle hors tabulation et retours à la ligne (testés par code, pas par regex). */
function hasControl(value: string): boolean {
	for (let i = 0; i < value.length; i++) {
		const c = value.charCodeAt(i);
		if (c <= 8 || c === 11 || c === 12 || (c >= 14 && c <= 31) || c === 127) return true;
	}
	return false;
}
const INVISIBLES_GLOBAL = /[\u200B-\u200D\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/g;
const INVITE = /(discord\.gg|discord(?:app)?\.com\/invite)\/[\w-]+/i;
const MASS_MENTION = /@(everyone|here)/i;
const ROLE_MENTION = /<@&\d{17,20}>/g;
const URL_PATTERN = /https?:\/\/\S+/gi;
const SCIENTIFIC = /^[+-]?\d+(\.\d+)?e[+-]?\d+$/i;

/** Analyse une valeur d'option. `name` sert au détail du constat. */
export function auditValue(name: string, value: unknown): InputFinding[] {
	const out: InputFinding[] = [];
	if (typeof value === "number") {
		if (!Number.isFinite(value))
			out.push({ code: "NON_FINITE", weight: 5, detail: `${name} = ${value}` });
		else if (Math.abs(value) > Number.MAX_SAFE_INTEGER)
			out.push({ code: "HUGE_NUMBER", weight: 4, detail: `${name} dépasse l'entier sûr` });
		else if (value < 0) out.push({ code: "NEGATIVE", weight: 2, detail: `${name} = ${value}` });
		return out;
	}
	if (typeof value !== "string") return out;

	if (ZERO_WIDTH.test(value))
		out.push({ code: "ZERO_WIDTH", weight: 3, detail: `${name} contient des caractères invisibles` });
	if (BIDI.test(value))
		out.push({
			code: "BIDI",
			weight: 4,
			detail: `${name} contient un inverseur de sens d'écriture`,
		});
	if (hasControl(value))
		out.push({ code: "CONTROL", weight: 3, detail: `${name} contient des caractères de contrôle` });
	if (MASS_MENTION.test(value))
		out.push({ code: "MASS_MENTION", weight: 4, detail: `${name} tente @everyone/@here` });
	const roles = value.match(ROLE_MENTION)?.length ?? 0;
	if (roles >= 2)
		out.push({ code: "ROLE_MENTIONS", weight: 2, detail: `${name} mentionne ${roles} rôles` });
	if (INVITE.test(value))
		out.push({ code: "INVITE", weight: 3, detail: `${name} contient une invitation Discord` });
	const urls = value.match(URL_PATTERN)?.length ?? 0;
	if (urls >= 3) out.push({ code: "URLS", weight: 2, detail: `${name} contient ${urls} liens` });
	if (value.length > 1_000)
		out.push({ code: "OVERLONG", weight: 2, detail: `${name} fait ${value.length} caractères` });
	if (SCIENTIFIC.test(value.trim()) || /^(nan|infinity|-infinity)$/i.test(value.trim()))
		out.push({ code: "NUMERIC_TRICK", weight: 3, detail: `${name} = « ${value.trim()} »` });
	return out;
}

export function auditInputs(entries: ReadonlyArray<{ name: string; value: unknown }>): InputAudit {
	const findings = entries.flatMap((e) => auditValue(e.name, e.value));
	return { score: findings.reduce((s, f) => s + f.weight, 0), findings };
}

/** Rend une valeur affichable dans un embed sans déclencher de mention ni de bloc de code. */
export function neutralize(value: unknown, max = 200): string {
	const s = typeof value === "string" ? value : JSON.stringify(value);
	return (s ?? "")
		.replace(INVISIBLES_GLOBAL, "·")
		.replace(/@/g, "@\u200B")
		.replace(/`/g, "ˋ")
		.slice(0, max);
}
