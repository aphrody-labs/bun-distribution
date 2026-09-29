import { resolveSiteUrl } from "@shenron/config/public-urls";
import { inject, singleton } from "tsyringe";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Client } from "discord.js";
import { logger } from "~/lib/logger";
import { SettingsService } from "~/services/SettingsService";

/**
 * Canon — client de l'arbitre de canonicité du site (`/api/canon`).
 *
 * **Pourquoi HTTP et pas le SQLite local.** Le verdict sort d'une doctrine
 * éditée à la main dans `/admin/canon` (`public."CanonConfig"`) et d'un corpus
 * de preuves ingéré 24h/24 dans `public.canon_references` (déclarations de
 * Toriyama, planches de databooks traduites). Ni l'une ni l'autre ne font
 * partie de `WIKI_EDITORIAL` : le réplica SQLite ne les voit pas, et les
 * répliquer pour un embed serait redondant avec l'API publique du site.
 *
 * Le service porte aussi le **cron « canon du jour »** : une fois par jour, à
 * l'heure réglée, il publie dans le salon choisi un sujet tranché de la
 * doctrine (rotation déterministe, jamais deux fois le même avant d'avoir fait
 * le tour), avec son rang, son verdict et une déclaration d'auteur quand elle
 * existe. Off par défaut (`canon.daily_enabled`).
 *
 * Contrat de dégradation : site injoignable ⇒ `null`, message clair, jamais
 * une trace. Même règle que `DatabooksService`.
 */

export type CanonTier =
	| "CANON_ABSOLU"
	| "CANON_SUPERVISE"
	| "EXTENSION_OFFICIELLE"
	| "NON_CANON_DERIVE"
	| "APOCRYPHE_FANON";

interface CanonTierInfo {
	id: CanonTier;
	label: string;
	court: string;
	couleur: string;
	score: number;
	definition: string;
	inclut: string[];
}

export interface CanonReference {
	id: string;
	subject: string;
	text: string;
	textFr: string | null;
	source: string;
	year: number | null;
	lang: string;
	provenance: "aphrody" | "databooks" | "manuel" | "manga";
	href: string | null;
}

interface CanonPlanche {
	databookId: number;
	databookTitre: string;
	numero: number;
	image: string | null;
	texte: string | null;
	texteFr: string | null;
	verifiee: boolean;
	href: string;
	score: number;
}

interface CanonFiche {
	kind: string;
	titre: string;
	extrait: string;
	href: string;
	score: number;
	image: string | null;
	nameJa: string | null;
}

export interface CanonVerdict {
	question: string;
	verdict: {
		tier: CanonTier;
		tierLabel: string;
		tierDefinition: string | null;
		score: number;
		color: string;
		verdict: string;
		explanation: string;
		toriyamaQuote: { text: string; source: string; year?: number } | null;
		sources: string[];
		matchedKeywords: string[];
		doctrine: string[];
		origine: string;
		nature: "verdict" | "question" | "troll" | "empty";
		suggestions: string[];
	};
	references: CanonReference[];
	planches: CanonPlanche[];
	fiches: CanonFiche[];
	suggestions: { titre: string; href: string }[];
	mode: string | null;
}

export interface CanonEntry {
	id: string;
	title: string;
	category: "character" | "form" | "lore" | "work" | "myth";
	tier: CanonTier;
	score: number;
	verdict: string;
}

export interface CanonDoctrine {
	intro: string;
	tiers: CanonTierInfo[];
	doctrine: string[];
	sourcesAdmises: string[];
	sourcesInterdites: string[];
	entries: CanonEntry[];
	heuristics: { id: string; label: string; tier: CanonTier }[];
	stats: { references: number; parProvenance: Record<string, number> };
}

export interface CanonReferencesPage {
	q: string;
	provenance: string | null;
	total: number;
	limit: number;
	offset: number;
	items: CanonReference[];
}

export interface CanonDailyResult {
	ok: boolean;
	reason?: "disabled" | "no_channel" | "already_posted" | "not_yet" | "no_entry" | "fetch_failed" | "error";
	entry?: string;
}

const BASE = resolveSiteUrl(Bun.env);

/** Une commande slash a 3 s pour accuser réception ; on diffère, mais on ne traîne pas. */
const TIMEOUT_MS = 8_000;

/** La doctrine change rarement : cinq minutes suffisent, l'éditeur purge côté site. */
const TTL_DOCTRINE_MS = 5 * 60_000;

/** Couleur d'embed par rang — miroir des couleurs par défaut de la doctrine. */
export const COULEURS_RANG: Record<CanonTier, number> = {
	CANON_ABSOLU: 0x22c55e,
	CANON_SUPERVISE: 0x84cc16,
	EXTENSION_OFFICIELLE: 0xf59e0b,
	NON_CANON_DERIVE: 0xf97316,
	APOCRYPHE_FANON: 0xef4444,
};

export const EMOJI_RANG: Record<CanonTier, string> = {
	CANON_ABSOLU: "🟢",
	CANON_SUPERVISE: "🟩",
	EXTENSION_OFFICIELLE: "🟡",
	NON_CANON_DERIVE: "🟠",
	APOCRYPHE_FANON: "🔴",
};

export function couleurHex(hex: string | undefined, tier: CanonTier): number {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
	return m ? Number.parseInt(m[1]!, 16) : COULEURS_RANG[tier];
}

@singleton()
export class CanonService {
	private client: Client | null = null;
	private doctrine: { at: number; data: CanonDoctrine } | null = null;

	constructor(@inject(SettingsService) private settings: SettingsService) {}

	setClient(client: Client) {
		this.client = client;
	}

	private async get<T>(chemin: string, query?: Record<string, string | number | undefined>): Promise<T | null> {
		const url = new URL(`${BASE}${chemin}`);
		for (const [k, v] of Object.entries(query ?? {})) {
			if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
		}
		try {
			const r = await fetch(url, {
				headers: { accept: "application/json" },
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
			if (!r.ok) {
				logger.warn({ chemin, status: r.status }, "[canon] réponse non-OK de l'API du site");
				return null;
			}
			return (await r.json()) as T;
		} catch (err) {
			logger.warn({ err, chemin }, "[canon] API du site injoignable");
			return null;
		}
	}

	/** Verdict + preuves pour une affirmation. */
	async verifier(question: string): Promise<CanonVerdict | null> {
		const q = question.trim().slice(0, 400);
		if (!q) return null;
		return this.get<CanonVerdict>("/api/canon", { q });
	}

	/** La doctrine (rangs, règles, sujets tranchés), mise en cache. */
	async doctrineActuelle(force = false): Promise<CanonDoctrine | null> {
		if (!force && this.doctrine && Date.now() - this.doctrine.at < TTL_DOCTRINE_MS) {
			return this.doctrine.data;
		}
		const data = await this.get<CanonDoctrine>("/api/canon");
		if (data) this.doctrine = { at: Date.now(), data };
		return data ?? this.doctrine?.data ?? null;
	}

	/** Le corpus de preuves, filtré. */
	async citations(
		q: string | undefined,
		provenance: string | undefined,
		limit = 10,
		offset = 0
	): Promise<CanonReferencesPage | null> {
		return this.get<CanonReferencesPage>("/api/canon/references", {
			q: q?.trim().slice(0, 200),
			provenance,
			limit,
			offset,
		});
	}

	/** Autocomplete des sujets tranchés : titre contenant le texte tapé. */
	async sujets(focus: string, max = 25): Promise<CanonEntry[]> {
		const d = await this.doctrineActuelle();
		if (!d) return [];
		const f = focus.trim().toLowerCase();
		const tous = d.entries;
		const filtres = f ? tous.filter((e) => e.title.toLowerCase().includes(f)) : tous;
		return filtres.slice(0, max);
	}

	// ── Canon du jour (cron) ────────────────────────────────────────────────

	/** Tick périodique (cron) — sûr : n'émet jamais d'exception. */
	async tick(): Promise<CanonDailyResult> {
		try {
			if (!(await this.settings.getBool("canon.daily_enabled", false))) {
				return { ok: false, reason: "disabled" };
			}
			return await this.publierDuJour(false);
		} catch (err) {
			logger.warn({ err }, "[canon] tick a échoué");
			return { ok: false, reason: "error" };
		}
	}

	/** Publication forcée (commande admin), sans condition d'heure ni d'activation. */
	async runOnce(): Promise<CanonDailyResult> {
		try {
			return await this.publierDuJour(true);
		} catch (err) {
			logger.warn({ err }, "[canon] runOnce a échoué");
			return { ok: false, reason: "error" };
		}
	}

	private jourUtc(): string {
		return new Date().toISOString().slice(0, 10);
	}

	private async publierDuJour(force: boolean): Promise<CanonDailyResult> {
		if (!this.client) return { ok: false, reason: "no_channel" };
		const salonId = await this.settings.getSnowflake("canon.channel");
		const salon = salonId ? await this.client.channels.fetch(salonId).catch(() => null) : null;
		if (!salon || !("send" in salon)) return { ok: false, reason: "no_channel" };

		if (!force) {
			const heure = await this.settings.getInt("canon.daily_hour", 18);
			if (new Date().getUTCHours() < heure) return { ok: false, reason: "not_yet" };
			const dernier = await this.settings.getString("canon.last_posted_day", "");
			if (dernier === this.jourUtc()) return { ok: false, reason: "already_posted" };
		}

		const doctrine = await this.doctrineActuelle(true);
		if (!doctrine) return { ok: false, reason: "fetch_failed" };
		if (doctrine.entries.length === 0) return { ok: false, reason: "no_entry" };

		// Rotation déterministe : on avance d'un cran par publication, on repart
		// du début après le tour complet. L'admin peut réordonner la doctrine, le
		// curseur suit l'index, pas l'identifiant — c'est voulu (simple, lisible).
		const index = (await this.settings.getInt("canon.rotation_index", 0)) % doctrine.entries.length;
		const entree = doctrine.entries[index]!;
		const verdict = await this.verifier(entree.title);

		const { embed, composants } = this.embedDuJour(entree, doctrine, verdict);
		const envoye = await salon
			.send({ embeds: [embed], components: composants })
			.then(() => true)
			.catch((err: unknown) => {
				logger.warn({ err }, "[canon] envoi du canon du jour refusé");
				return false;
			});
		if (!envoye) return { ok: false, reason: "error" };

		await this.settings.set("canon.rotation_index", String((index + 1) % doctrine.entries.length));
		await this.settings.set("canon.last_posted_day", this.jourUtc());
		logger.info({ entry: entree.id }, "[canon] canon du jour publié");
		return { ok: true, entry: entree.title };
	}

	private embedDuJour(entree: CanonEntry, doctrine: CanonDoctrine, verdict: CanonVerdict | null) {
		const rang = doctrine.tiers.find((t) => t.id === entree.tier);
		const embed = new EmbedBuilder()
			.setColor(couleurHex(rang?.couleur, entree.tier))
			.setAuthor({ name: "Canon du jour · dragonballfr.com" })
			.setTitle(`${EMOJI_RANG[entree.tier]} ${entree.title}`)
			.setURL(`${BASE}/wiki/canon?q=${encodeURIComponent(entree.title)}`)
			.setDescription((verdict?.verdict.verdict ?? entree.verdict).slice(0, 2000))
			.addFields({
				name: rang?.label ?? entree.tier,
				value: `${rang?.definition ?? "—"}`.slice(0, 1024),
			});
		if (verdict?.verdict.explanation) {
			embed.addFields({ name: "Pourquoi", value: verdict.verdict.explanation.slice(0, 1024) });
		}
		const ref = verdict?.references[0];
		if (ref) {
			const texte = ref.textFr ?? ref.text;
			embed.addFields({
				name: `📜 ${ref.source}${ref.year ? ` (${ref.year})` : ""}`,
				value: `> ${texte.replace(/\s+/g, " ").slice(0, 900)}`,
			});
		}
		embed.setFooter({ text: `Autorité ${entree.score}/100 · /canon verifier pour poser ta propre question` });
		const composants = [
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setStyle(ButtonStyle.Link)
					.setLabel("Voir le verdict et les preuves")
					.setURL(`${BASE}/wiki/canon?q=${encodeURIComponent(entree.title)}`)
			),
		];
		return { embed, composants };
	}
}
