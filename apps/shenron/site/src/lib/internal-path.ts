/**
 * Normalise un lien contrôlé par un client en chemin strictement same-origin.
 * `startsWith("/")` ne suffit pas : les navigateurs interprètent aussi
 * `/\\example.com` comme une URL réseau vers un autre domaine.
 */
export function sanitizeInternalPath(value: unknown, maxLength = 512): string | null {
	if (typeof value !== "string") return null;
	const raw = value.trim();
	if (!raw || raw.length > maxLength || !raw.startsWith("/") || raw.includes("\\")) {
		return null;
	}

	const base = "https://dbfr.invalid";
	try {
		const parsed = new URL(raw, base);
		if (parsed.origin !== base) return null;
		return `${parsed.pathname}${parsed.search}${parsed.hash}`;
	} catch {
		return null;
	}
}
