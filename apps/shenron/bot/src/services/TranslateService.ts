import { TranslationHttpClient, type TranslateResult } from "@aphrody/media/translation-http";
export type { TranslateResult } from "@aphrody/media/translation-http";
import { singleton, container } from "tsyringe";
import { isIP } from "node:net";
import { env } from "~/lib/env";
import { logger } from "~/lib/logger";
import { SettingsService } from "~/services/SettingsService";
import { AphrodyComputeClient } from "@shenron/pipeline/aphrody";
import { resolveLibreTranslateUrl } from "@shenron/config/services";

// Helpers settings-aware : lit la setting, fallback const default
async function getInt(key: string, def: number): Promise<number> {
	try {
		return await container.resolve(SettingsService).getInt(key, def);
	} catch {
		return def;
	}
}
async function getString(key: string, def: string): Promise<string> {
	try {
		return await container.resolve(SettingsService).getString(key, def);
	} catch {
		return def;
	}
}
async function getBool(key: string, def: boolean): Promise<boolean> {
	try {
		return await container.resolve(SettingsService).getBool(key, def);
	} catch {
		return def;
	}
}

/**
 * OCR + Traduction.
 *
 * **OCR : Aphrody** (API privée du moteur IA, traitement hors du bot).
 *
 * **Traduction : Lingva → Google `gtx` → LibreTranslate → erreur**
 *   Aucun provider ne demande de clé API.
 *
 *   - **Lingva Translate** (AGPL-3.0) — proxy open source autour de Google
 *     Translate. On essaie plusieurs instances publiques en cascade
 *     (configurable via `LINGVA_INSTANCE`). Endpoint :
 *       GET {instance}/api/v1/{source}/{target}/{encodeURIComponent(text)}
 *     Réponse : `{ "translation": "...", "info": { "detectedSource": ".." } }`.
 *     Doc : https://github.com/thedaviddelta/lingva-translate
 *
 *   - **Google `gtx`** — endpoint utilisé par Chrome / extensions, pas de
 *     clé requise. Rate-limité par IP en cas d'abus.
 *       GET https://translate.googleapis.com/translate_a/single
 *           ?client=gtx&sl={src}&tl={tgt}&dt=t&q={text}
 *     Réponse : tableau imbriqué `[[[translated, source, ...], ...], ..., detectedLang]`.
 *
 *   - **LibreTranslate** (AGPL-3.0) — self-host via Docker comme dernier
 *     filet :
 *       docker run -d --restart unless-stopped --name libretranslate \
 *         -p 127.0.0.1:5000:5000 \
 *         libretranslate/libretranslate:latest \
 *         --load-only en,fr,ja,es,de,it
 *     Endpoint configurable via `LIBRETRANSLATE_URL`.
 *
 *   La méthode publique `translate(text, target, source?)` essaie chaque
 *   provider dans l'ordre, fallback auto sur le suivant en cas d'erreur
 *   réseau / quota.
 */

export interface OcrResult {
	text: string;
	language: string;
}


export type TranslateProbe = {
	ocr: boolean;
	translate: boolean;
	lingva: boolean | null;
	google: boolean | null;
	libretranslate: boolean | null;
};


/**
 * Instances Lingva publiques connues, essayées en cascade. Réordonnées
 * 2026-04 après vérif live : `lingva.ml` est derrière un challenge
 * Cloudflare (HTML 403 sur les bots), `lingva.thedaviddelta.com` retourne
 * 503 DEPLOYMENT_PAUSED. On garde quand même les 4 — si une revient ou si
 * une nouvelle est ajoutée à la liste officielle on en bénéficie sans
 * redéploiement. Liste de référence :
 * https://github.com/thedaviddelta/lingva-translate#instances
 *
 * Note : la shape réelle observée est `{ "translation": "..." }` sans
 * champ `info.detectedSource` sur les instances actuelles — d'où le
 * fallback `data.info?.detectedSource ?? src` côté client.
 */
const LINGVA_INSTANCES = [
	"https://translate.plausibility.cloud",
	"https://lingva.lunar.icu",
	"https://lingva.ml",
	"https://lingva.thedaviddelta.com",
];

// Hard caps pour éviter les freeze sur input pourri.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MiB — Discord upload normal
const MAX_TRANSLATE_CHARS = 5_000;



const FETCH_IMAGE_TIMEOUT_MS = 10_000;

/**
 * Normalise un code langue utilisateur (court, libre) en code ISO 639-1
 * minuscule pour Lingva / Google / LibreTranslate. Renvoie `"auto"` si
 * `code` est vide ou égal à `auto`.
 */

@singleton()
export class TranslateService {
	/**
	 * Cache du test runtime — set au boot via `probe()`.
	 * `null` tant qu'on n'a pas testé, `true`/`false` après.
	 */
	private ocrAvailable: boolean | null = null;
	private libretranslateAvailable: boolean | null = null;
	private readonly translator = new TranslationHttpClient({
    lingvaInstances: () => this.lingvaInstancesDynamic(),
    libretranslate: () => ({
      baseUrl: resolveLibreTranslateUrl({ LIBRETRANSLATE_URL: env.LIBRETRANSLATE_URL }),
      apiKey: env.LIBRETRANSLATE_API_KEY,
    }),
  });
  private get lingvaAvailable() { return this.translator.lingvaAvailable; }
  private set lingvaAvailable(value: boolean | null) { this.translator.lingvaAvailable = value; }
  private get googleAvailable() { return this.translator.googleAvailable; }
  private set googleAvailable(value: boolean | null) { this.translator.googleAvailable = value; }

	/** À appeler au boot (boot-audit.ts) — détecte les binaires/services dispos. */
	async probe(): Promise<TranslateProbe> {
		// 1. OCR Aphrody disponible ?
		try {
			this.ocrAvailable = (await new AphrodyComputeClient().health()).ocr;
		} catch {
			this.ocrAvailable = false;
		}
		// 2. LibreTranslate up ?
		try {
			const base = resolveLibreTranslateUrl({ LIBRETRANSLATE_URL: env.LIBRETRANSLATE_URL });
			const res = await fetch(`${base}/languages`, {
				signal: AbortSignal.timeout(3_000),
			});
			this.libretranslateAvailable = res.ok;
		} catch {
			this.libretranslateAvailable = false;
		}
		// 3. Au moins une instance Lingva atteignable ?
		this.lingvaAvailable = false;
		for (const inst of await this.lingvaInstancesDynamic()) {
			try {
				const res = await fetch(`${inst}/api/v1/auto/en/test`, {
					signal: AbortSignal.timeout(3_000),
				});
				if (res.ok) {
					this.lingvaAvailable = true;
					break;
				}
			} catch {
				/* essaie l'instance suivante */
			}
		}
		// 4. Google gtx atteignable ?
		try {
			const res = await fetch(
				"https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=fr&dt=t&q=ok",
				{ signal: AbortSignal.timeout(3_000) }
			);
			this.googleAvailable = res.ok;
		} catch {
			this.googleAvailable = false;
		}

		const result: TranslateProbe = {
			ocr: this.ocrAvailable === true,
			translate:
				this.lingvaAvailable === true ||
				this.googleAvailable === true ||
				this.libretranslateAvailable === true,
			lingva: this.lingvaAvailable,
			google: this.googleAvailable,
			libretranslate: this.libretranslateAvailable,
		};
		logger.info(result, "TranslateService probe");
		return result;
	}

	get available(): {
		ocr: boolean | null;
		translate: boolean | null;
		lingva: boolean | null;
		google: boolean | null;
		libretranslate: boolean | null;
	} {
		const flags = [this.lingvaAvailable, this.googleAvailable, this.libretranslateAvailable];
		const translate = flags.includes(true) ? true : flags.every((f) => f === false) ? false : null;
		return {
			ocr: this.ocrAvailable,
			translate,
			lingva: this.lingvaAvailable,
			google: this.googleAvailable,
			libretranslate: this.libretranslateAvailable,
		};
	}

	/** Indique le provider qui sera tenté en premier (utile pour /audit, dashboard). */
	get primaryProvider(): "lingva" | "google" | "libretranslate" | "none" {
		if (this.lingvaAvailable !== false) return "lingva";
		if (this.googleAvailable !== false) return "google";
		if (this.libretranslateAvailable !== false) return "libretranslate";
		return "none";
	}

	/** Liste des instances Lingva à essayer, override en tête si configuré. */
	private lingvaInstances(): string[] {
		const override = env.LINGVA_INSTANCE?.replace(/\/+$/, "");
		const base = LINGVA_INSTANCES.map((u) => u.replace(/\/+$/, ""));
		if (!override) return base;
		return [override, ...base.filter((u) => u !== override)];
	}

	/**
	 * Variante settings-aware : si `translate.lingva_instances` est défini
	 * (CSV ou JSON array), l'utilise — sinon fallback liste hardcoded.
	 * Override env reste prioritaire.
	 */
	private async lingvaInstancesDynamic(): Promise<string[]> {
		const raw = await getString("translate.lingva_instances", "").catch(() => "");
		if (!raw.trim()) return this.lingvaInstances();
		let list: string[] = [];
		if (raw.trim().startsWith("[")) {
			try {
				const parsed = JSON.parse(raw);
				if (Array.isArray(parsed)) list = parsed.filter((s) => typeof s === "string");
			} catch {
				/* fallback CSV */
			}
		}
		if (list.length === 0)
			list = raw
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);
		const override = env.LINGVA_INSTANCE?.replace(/\/+$/, "");
		const base = list.map((u) => u.replace(/\/+$/, ""));
		if (!override) return base;
		return [override, ...base.filter((u) => u !== override)];
	}

	/** Bloque file://, IPs privées (SSRF). */
	private validateImageUrl(url: string): URL {
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			throw new Error("URL invalide.");
		}
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			throw new Error("URL doit être http(s).");
		}
		const host = parsed.hostname;
		if (isIP(host)) {
			if (
				/^(10\.|127\.|169\.254\.|192\.168\.)/.test(host) ||
				/^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
				host === "0.0.0.0" ||
				host.startsWith("::1") ||
				host.toLowerCase().startsWith("fc") ||
				host.toLowerCase().startsWith("fd")
			) {
				throw new Error("URL pointe vers une adresse interne — refusée.");
			}
		}
		if (host === "localhost") throw new Error("URL pointe vers localhost — refusée.");
		return parsed;
	}

	/**
	 * OCR délégué au moteur Aphrody. L'image est bornée à 10 MiB avant transfert.
	 */
	async ocrFromUrl(imageUrl: string, langs?: string): Promise<OcrResult> {
		this.validateImageUrl(imageUrl);

		const res = await fetch(imageUrl, {
			signal: AbortSignal.timeout(FETCH_IMAGE_TIMEOUT_MS),
		});
		if (!res.ok) throw new Error(`Téléchargement image HTTP ${res.status}`);
		const contentLength = Number(res.headers.get("content-length") ?? 0);
		if (contentLength > MAX_IMAGE_BYTES) {
			throw new Error(
				`Image trop grosse (${(contentLength / 1024 / 1024).toFixed(1)} MiB > 10 MiB).`
			);
		}
		const buf = Buffer.from(await res.arrayBuffer());
		if (buf.byteLength > MAX_IMAGE_BYTES) {
			throw new Error(
				`Image trop grosse (${(buf.byteLength / 1024 / 1024).toFixed(1)} MiB > 10 MiB).`
			);
		}

		const result = await new AphrodyComputeClient().ocr(buf.toString("base64"), langs);
		return { text: result.text.trim(), language: result.language };
	}

	/**
	 * API publique de traduction. Cascade Lingva → Google → LibreTranslate
	 * en sautant chaque provider marqué défaillant.
	 *
	 * @param text     Texte source — borné à 5 000 chars.
	 * @param target   Code langue cible (fr, en, ja, …) — case-insensitive.
	 * @param source   Optionnel — si omis : auto-détection.
	 */
	async translate(text: string, target = "fr", source?: string): Promise<TranslateResult> {
		if (!(await getBool("features.translate", true))) {
			throw new Error("Traduction désactivée (features.translate).");
		}
		if (!text.trim()) {
			return {
				source: text,
				detectedLang: "—",
				translated: "",
				provider: "lingva",
			};
		}
		const truncated = text.length > MAX_TRANSLATE_CHARS ? text.slice(0, MAX_TRANSLATE_CHARS) : text;

		// 1. Lingva (Google quality, sans clé, plusieurs instances)
		if (this.lingvaAvailable !== false) {
			try {
				return await this.lingva(truncated, target, source);
			} catch (err) {
				logger.warn({ err: (err as Error).message }, "Lingva failed, fallback Google");
			}
		}

		// 2. Google gtx (sans clé)
		if (this.googleAvailable !== false) {
			try {
				return await this.googleGtx(truncated, target, source);
			} catch (err) {
				logger.warn({ err: (err as Error).message }, "Google gtx failed, fallback LibreTranslate");
			}
		}

		// 3. Fallback LibreTranslate self-host
		return this.libretranslate(truncated, target, source);
	}

	/**
	 * Traduction via Lingva Translate. Tente toutes les instances configurées
	 * jusqu'à un succès. Marque `lingvaAvailable=false` si toutes échouent.
	 */
  lingva(text: string, target = "fr", source?: string): Promise<TranslateResult> {
    return this.translator.lingva(text, target, source);
  }
  googleGtx(text: string, target = "fr", source?: string): Promise<TranslateResult> {
    return this.translator.googleGtx(text, target, source);
  }
  libretranslate(text: string, target = "fr", source?: string): Promise<TranslateResult> {
    return this.translator.libretranslate(text, target, source);
  }

	async ocrAndTranslate(imageUrl: string, target = "fr"): Promise<TranslateResult | null> {
		if (!(await getBool("features.translate", true))) {
			throw new Error("Traduction désactivée (features.translate).");
		}
		const ocr = await this.ocrFromUrl(imageUrl);
		if (!ocr.text) {
			logger.debug({ imageUrl }, "OCR aucun texte");
			return null;
		}
		return this.translate(ocr.text, target);
	}
}
