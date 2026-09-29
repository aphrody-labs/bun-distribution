export interface CanonReferenceCandidate {
	id: string;
	subject: string;
	keywords: string[];
	source: string;
	document: string;
	provenance: string;
	href: string | null;
}

export interface WikiSourceReference {
	n: number;
	kind: "canon_reference";
	label: string;
	url: string;
	canonReferenceId: string;
}

const PRIMARY_PROVENANCE = new Set(["aphrody", "databook", "databooks", "manga"]);

export function normalizeEntityName(value: string): string {
	return value
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/\([^)]*\)/g, " ")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
}

/** Évite qu'une graphie CJK courte soit acceptée au milieu d'un autre nom. */
export function containsExactCjkTerm(text: string, term: string): boolean {
	const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(
		`(?<![\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}])${escaped}(?![\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}])`,
		"u"
	).test(text);
}

export function isPrimaryReference(reference: CanonReferenceCandidate): boolean {
	if (!PRIMARY_PROVENANCE.has(reference.provenance.toLowerCase())) return false;
	if (!reference.href) return false;
	return (
		reference.href.startsWith("/wiki/manga/") ||
		reference.href.startsWith("/wiki/databooks/") ||
		/^https:\/\/(?:www\.)?dragonballfr\.com\/wiki\/(?:manga|databooks)\//i.test(reference.href)
	);
}

/** Une égalité normalisée de sujet ou mot-clé est exigée : aucune sous-chaîne. */
export function exactCanonicalMatches(
	name: string,
	nameJa: string | null,
	references: CanonReferenceCandidate[]
): CanonReferenceCandidate[] {
	const identities = new Set([name, nameJa ?? ""].map(normalizeEntityName).filter((value) => value.length >= 3));
	if (identities.size === 0) return [];
	return references.filter((reference) => {
		if (!isPrimaryReference(reference)) return false;
		const terms = [reference.subject, ...reference.keywords].map(normalizeEntityName);
		return terms.some((term) => identities.has(term));
	});
}

export function toWikiSources(references: CanonReferenceCandidate[]): WikiSourceReference[] {
	return references.map((reference, index) => ({
		n: index + 1,
		kind: "canon_reference",
		label: `${reference.document} — ${reference.source}`,
		url: reference.href!,
		canonReferenceId: reference.id,
	}));
}
