// SPDX-License-Identifier: Apache-2.0
/**
 * Noms canon des fusions DBZ. Le lookup est bidirectionnel (Goku+Vegeta = Vegeta+Goku).
 */
const CANONICAL: Array<{ a: string; b: string; name: string }> = [
	// Fusions par potara
	{ a: "goku", b: "vegeta", name: "Vegito" },
	// Fusion dance (même paire, on garde Vegito)
	{ a: "goten", b: "trunks", name: "Gotenks" },
	{ a: "piccolo", b: "nail", name: "Piccolo (fusionné)" },
	{ a: "piccolo", b: "kami", name: "Super Piccolo" },
	{ a: "kibito", b: "kaioshin", name: "Kibito Kai" },
	{ a: "goku", b: "gohan", name: "Gohanku" },
	{ a: "goku", b: "piccolo", name: "Gokicolo" },
	{ a: "vegeta", b: "piccolo", name: "Vegicolo" },
	{ a: "vegeta", b: "trunks", name: "Vegenks" },
	{ a: "krillin", b: "krilin", name: "Krillin²" },
];

/** Tente de deviner un nom de fusion canonique. */
export function findCanonicalFusion(aName: string, bName: string): string | null {
	const an = aName.toLowerCase().replace(/[^a-z]/g, "");
	const bn = bName.toLowerCase().replace(/[^a-z]/g, "");
	for (const f of CANONICAL) {
		if ((an.includes(f.a) && bn.includes(f.b)) || (an.includes(f.b) && bn.includes(f.a))) {
			return f.name;
		}
	}
	return null;
}

/** Génère un nom fusionné par mélange de syllabes (style fusion dance). */
export function generateFusionName(aName: string, bName: string): string {
	const clean = (s: string) => s.replace(/[^a-zA-ZÀ-ÿ]/g, "");
	const a = clean(aName);
	const b = clean(bName);
	if (!a || !b) return `${aName}-${bName}`;
	// Prends la première moitié de A + la deuxième moitié de B
	const halfA = a.slice(0, Math.max(2, Math.ceil(a.length / 2)));
	const halfB = b.slice(Math.floor(b.length / 2));
	return halfA + halfB.toLowerCase();
}

/** Résout le nom final : canon > mélange généré. */
export function fusionName(aName: string, bName: string): string {
	return findCanonicalFusion(aName, bName) ?? generateFusionName(aName, bName);
}
