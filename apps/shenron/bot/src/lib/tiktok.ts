import { logger } from "~/lib/logger";

/**
 * Fetcher TikTok minimal, sans dépendance ni DI.
 *
 * On lit la page profil publique `https://www.tiktok.com/@<user>` et on parse le
 * blob `__UNIVERSAL_DATA_FOR_REHYDRATION__` (SSR) qui contient
 * `webapp.user-detail.userInfo` :
 *   - `user.roomId` : NON vide ⇒ le créateur est EN LIVE (fiable depuis le VPS).
 *   - `itemList`     : vidéos récentes (souvent VIDE en SSR — TikTok charge la
 *     liste côté client via une API signée X-Bogus/msToken qu'on ne peut pas
 *     reproduire sans navigateur headless). On l'exploite quand elle est peuplée
 *     (best-effort) ; sinon seul le LIVE est détecté.
 *
 * Dégradation gracieuse : tout échec (réseau, blocage datacenter, JSON absent)
 * ⇒ `null`, jamais d'exception qui remonterait dans le cron du bot. Un proxy
 * résidentiel (`proxyUrl`) peut être fourni si l'IP du VPS est filtrée.
 */

const UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const REHYDRATION_RE =
	/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">(.*?)<\/script>/s;

export interface TikTokVideo {
	id: string;
	desc: string;
	/** Unix epoch en secondes. */
	createTime: number;
	cover: string | null;
	url: string;
}

export interface TikTokProfile {
	uniqueId: string;
	nickname: string;
	secUid: string;
	avatar: string | null;
	signature: string | null;
	isLive: boolean;
	roomId: string | null;
	liveUrl: string;
	/** Best-effort : peut être vide même si le compte a des vidéos (cf. en-tête). */
	videos: TikTokVideo[];
}

interface RawUser {
	uniqueId?: string;
	nickname?: string;
	secUid?: string;
	roomId?: string;
	signature?: string;
	avatarLarger?: string;
	avatarMedium?: string;
	avatarThumb?: string;
}

interface RawItem {
	id?: string | number;
	desc?: string;
	createTime?: string | number;
	video?: { cover?: string; originCover?: string; dynamicCover?: string };
}

/**
 * Récupère et parse le profil TikTok. Retourne `null` en cas d'échec/blocage.
 *
 * @param username pseudo TikTok (avec ou sans `@`).
 * @param proxyUrl proxy HTTP(S) optionnel (ex. proxy résidentiel) ; ignoré si vide.
 */
export async function fetchTikTokProfile(
	username: string,
	proxyUrl?: string
): Promise<TikTokProfile | null> {
	const clean = username.trim().replace(/^@/, "");
	if (!clean) return null;
	const url = `https://www.tiktok.com/@${clean}`;

	try {
		const res = await fetch(url, {
			headers: {
				"User-Agent": UA,
				Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
				"Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
				"Cache-Control": "no-cache",
			},
			signal: AbortSignal.timeout(20_000),
			...(proxyUrl ? { proxy: proxyUrl } : {}),
		});

		if (!res.ok) {
			logger.warn({ status: res.status, user: clean }, "[tiktok] profil HTTP non-200");
			return null;
		}

		const html = await res.text();
		const m = REHYDRATION_RE.exec(html);
		if (!m) {
			logger.warn({ user: clean }, "[tiktok] blob de rehydration absent (blocage probable)");
			return null;
		}

		let data: unknown;
		try {
			data = JSON.parse(m[1]);
		} catch {
			logger.warn({ user: clean }, "[tiktok] JSON de rehydration illisible");
			return null;
		}

		const scope = (data as Record<string, Record<string, unknown> | undefined>)[
			"__DEFAULT_SCOPE__"
		];
		const userInfo = scope?.["webapp.user-detail"] as
			| { userInfo?: { user?: RawUser; itemList?: RawItem[] } }
			| undefined;
		const user = userInfo?.userInfo?.user;
		if (!user?.uniqueId) {
			logger.warn({ user: clean }, "[tiktok] userInfo introuvable dans le SSR");
			return null;
		}

		const roomId =
			typeof user.roomId === "string" && /^\d{6,}$/.test(user.roomId) ? user.roomId : null;

		const rawItems = userInfo?.userInfo?.itemList;
		const videos: TikTokVideo[] = (Array.isArray(rawItems) ? rawItems : [])
			.filter((v): v is RawItem & { id: string | number } => v?.id != null)
			.map((v) => ({
				id: String(v.id),
				desc: String(v.desc ?? "").trim(),
				createTime: Number(v.createTime ?? 0),
				cover: v.video?.cover ?? v.video?.originCover ?? v.video?.dynamicCover ?? null,
				url: `https://www.tiktok.com/@${user.uniqueId}/video/${v.id}`,
			}))
			.filter((v) => Number.isFinite(v.createTime) && v.createTime > 0)
			.toSorted((a, b) => b.createTime - a.createTime);

		return {
			uniqueId: user.uniqueId,
			nickname: user.nickname?.trim() || user.uniqueId,
			secUid: user.secUid ?? "",
			avatar: user.avatarLarger ?? user.avatarMedium ?? user.avatarThumb ?? null,
			signature: user.signature?.trim() || null,
			isLive: roomId != null,
			roomId,
			liveUrl: `https://www.tiktok.com/@${user.uniqueId}/live`,
			videos,
		};
	} catch (err) {
		logger.warn({ err, user: clean }, "[tiktok] échec fetch profil");
		return null;
	}
}
