const ALLOWED_SCAN_HOSTS = new Set(["comic.dragonballcn.com"]);

export function parseReferencedDatabookScan(raw: string): URL | null {
	try {
		const url = new URL(raw);
		if (
			!/^https?:$/.test(url.protocol) ||
			url.username ||
			url.password ||
			url.port ||
			!ALLOWED_SCAN_HOSTS.has(url.hostname) ||
			!url.pathname.startsWith("/list/") ||
			!/\.(?:jpe?g|png|webp)$/i.test(url.pathname)
		)
			return null;
		return url;
	} catch {
		return null;
	}
}

export function referencedScanBasename(raw: string): string | null {
	const url = parseReferencedDatabookScan(raw);
	if (!url) return null;
	const name = url.pathname.split("/").at(-1);
	return name && !name.startsWith(".") ? name : null;
}
