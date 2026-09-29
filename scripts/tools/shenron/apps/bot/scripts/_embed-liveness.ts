/**
 * _embed-liveness.ts — Juge unique de la vivacité d'un « lecteur » (player)
 * voir-anime, partagé par l'audit, le prune et le refresh.
 *
 * Pourquoi un module dédié : `isDead()` était dupliqué à l'identique dans
 * `prune-dead-embed-players.ts` et `refresh-dead-embed-players.ts`, et se
 * contentait d'un HTTP 200 + signatures de page morte. Or (mesuré le
 * 2026-08-26 sur les 3 452 lecteurs du catalogue) un embed peut très bien
 * rendre 200 avec une page d'erreur hydratée en JS, ou une page de lecteur
 * complète mais SANS source jouable. Le verdict porte donc désormais sur la
 * présence d'une source exploitable, et — quand elle existe — sur le fait que
 * le média répond vraiment.
 *
 * Verdicts :
 *   - `alive`   : source trouvée ET (média joignable | provider non vérifiable)
 *   - `dead`    : 404/410, signature de page morte, provider bloqué en bloc,
 *                 ou source absente / média injoignable
 *   - `suspect` : la page répond mais le verdict n'est pas tranchable
 *                 (timeout, 403, page de lecteur sans URL extractible) →
 *                 JAMAIS purgé automatiquement, uniquement remonté
 *
 * Aucun navigateur : que du `fetch`. Le re-scrape headless reste côté bxc.
 */

export type Player = {
	name: string;
	provider: string;
	embedUrl: string;
	lang?: "vf" | "vostfr";
};

export type Verdict = "alive" | "dead" | "suspect";
export type ProbeResult = {
	verdict: Verdict;
	reason: string;
	status?: number;
	mediaUrl?: string;
};

/**
 * Providers bloqués à 100% pour NOUS (politique sandbox du site ou migration
 * de plateforme), pas un lien mort individuel → verdict sans fetch.
 * Cf. l'en-tête de `prune-dead-embed-players.ts` pour le détail des mesures.
 */
export const BLANKET_DEAD = new Set(["streamhide", "voe", "streamtape", "filemoon"]);

/** Signatures de page « contenu mort » observées en conditions réelles. */
export const DEAD_SIGNATURES = [
	/404 not found/i,
	/video is not exist/i,
	/content restricted/i,
	/dmca complaint/i,
	/file (was )?deleted/i,
	/this domain name may be for sale/i,
	/video has been removed/i,
	/no longer available/i,
];

const UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const M3U8_RE = /https?:\/\/[^"'\\\s]+?\.m3u8[^"'\\\s]*/;
const MP4_RE = /https?:\/\/[^"'\\\s]+?\.mp4[^"'\\\s]*/;

async function get(
	url: string,
	init: { referer?: string; timeoutMs: number; range?: boolean }
): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), init.timeoutMs);
	try {
		return await fetch(url, {
			signal: controller.signal,
			redirect: "follow",
			headers: {
				"User-Agent": UA,
				Accept: "*/*",
				"Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
				Referer: init.referer ?? "https://dragonballfr.com/",
				...(init.range ? { Range: "bytes=0-1" } : {}),
			},
		});
	} finally {
		clearTimeout(timer);
	}
}

/** Le média pointé par la page de lecteur répond-il vraiment ? */
async function mediaReachable(mediaUrl: string, referer: string): Promise<boolean> {
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const res = await get(mediaUrl, { referer, timeoutMs: 12_000, range: true });
			// 2xx (dont 206) = ok ; 403/401 sur un CDN qui exige un token de
			// session n'est pas une preuve de mort, on ne tranche pas ici.
			if (res.ok || res.status === 206) return true;
			if (res.status === 403 || res.status === 401) return true;
			return false;
		} catch {
			if (attempt === 1) return false;
		}
	}
	return false;
}

export type ProbeOptions = {
	/** Vérifier que le média (m3u8/mp4) répond — coûte une requête de plus. */
	checkMedia?: boolean;
	timeoutMs?: number;
};

/** Verdict de vivacité d'un lecteur. Ne lève jamais. */
export async function probePlayer(p: Player, opts: ProbeOptions = {}): Promise<ProbeResult> {
	const { checkMedia = true, timeoutMs = 15_000 } = opts;
	if (BLANKET_DEAD.has(p.provider)) {
		return { verdict: "dead", reason: `provider mort en bloc (${p.provider})` };
	}

	let res: Response;
	try {
		res = await get(p.embedUrl, { timeoutMs });
	} catch {
		try {
			res = await get(p.embedUrl, { timeoutMs });
		} catch {
			return { verdict: "suspect", reason: "injoignable (timeout/réseau)" };
		}
	}

	if (res.status === 404 || res.status === 410) {
		return { verdict: "dead", reason: `HTTP ${res.status}`, status: res.status };
	}

	let body: string;
	try {
		body = await res.text();
	} catch {
		return { verdict: "suspect", reason: "corps illisible", status: res.status };
	}

	const head = body.slice(0, 20_000);
	const sig = DEAD_SIGNATURES.find((re) => re.test(head));
	if (sig) return { verdict: "dead", reason: `signature morte ${sig.source}`, status: res.status };

	if (!res.ok) {
		return { verdict: "suspect", reason: `HTTP ${res.status}`, status: res.status };
	}

	// mail.ru ne met aucune URL de média dans le HTML (chargée par API
	// signée) ; le marqueur fiable mesuré est `movieSrc` — absent des pages
	// d'erreur, qui rendent d'ailleurs un 404.
	if (p.provider === "mailru") {
		return body.includes("movieSrc")
			? { verdict: "alive", reason: "movieSrc présent", status: res.status }
			: { verdict: "dead", reason: "movieSrc absent", status: res.status };
	}

	const media = M3U8_RE.exec(body)?.[0] ?? MP4_RE.exec(body)?.[0];
	if (!media) {
		return body.includes("sources:")
			? { verdict: "suspect", reason: "sources: sans URL extractible", status: res.status }
			: { verdict: "dead", reason: "aucune source jouable", status: res.status };
	}

	if (!checkMedia) {
		return { verdict: "alive", reason: "source présente", status: res.status, mediaUrl: media };
	}

	const ok = await mediaReachable(media, p.embedUrl);
	return ok
		? { verdict: "alive", reason: "média joignable", status: res.status, mediaUrl: media }
		: { verdict: "dead", reason: "média injoignable", status: res.status, mediaUrl: media };
}

/** Exécute `fn` sur `items` avec au plus `n` en vol. */
export async function withConcurrency<T, R>(
	items: T[],
	n: number,
	fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
	const results: R[] = Array.from({ length: items.length });
	let idx = 0;
	async function worker() {
		for (;;) {
			const i = idx++;
			if (i >= items.length) return;
			results[i] = await fn(items[i], i);
		}
	}
	await Promise.all(Array.from({ length: Math.min(n, items.length) || 1 }, worker));
	return results;
}
