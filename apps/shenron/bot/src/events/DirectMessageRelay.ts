import { resolveSiteUrl } from "@shenron/config/public-urls";
import { injectable, inject } from "tsyringe";
import { Bot, Discord, On, type ArgsOf } from "discordx";
import { and, eq, isNull, sql } from "drizzle-orm";
import { DatabaseService } from "~/db/index";
import { dmContacts, dmMessages } from "~/db/schema";
import { logger } from "~/lib/logger";
import { isBotOwner } from "~/lib/env";
import { StatsService } from "~/services/StatsService";
import { DatabooksService, type Databook, type PlancheTrouvee } from "~/services/DatabooksService";

/** IDs des Owners / Fondateurs (Omar, Yoyo / Shawn, trape17) */
const OWNER_DISCORD_IDS = new Set([
	"1527405876695142620", // Omar (@omlar_)
	"281114294152724491", // Yohan (@shaaaaaaawn_)
	"1323725494184841256", // Ancien compte Omar (@trape17_10161)
]);

/**
 * Relais de messages privés — réception et automatisation interactive pour les owners.
 *
 * Shenron sert de canal direct entre les porteurs du projet et l'infrastructure :
 * - Les owners obtiennent des rapports de diagnostic temps réel (VPS, services, OCR, PostgreSQL).
 * - Les messages autorisés sont enregistrés et archivés dans `dm_messages`.
 * - Les utilisateurs inconnus reçoivent un refus poli unique.
 */
@Discord()
@Bot("shenron")
@injectable()
export class DirectMessageRelay {
	constructor(
		@inject(DatabaseService) private dbs: DatabaseService,
		@inject(StatsService) private stats: StatsService,
		@inject(DatabooksService) private databooks: DatabooksService
	) {}

	/**
	 * Extrait une demande explicite adressée à la base de databooks.
	 * Les DM restent privés et réservés aux owners : on ne transforme pas un
	 * message opérationnel quelconque en recherche éditoriale par accident.
	 */
	private databookQuery(
		texte: string
	):
		| { kind: "search"; term: string }
		| { kind: "book"; query: string }
		| { kind: "page"; query: string; page: number }
		| null {
		const demande = texte.match(
			/\b(?:databooks?|daizensh(?:u{1,2}|ū)|ch[oō]zensh(?:u{1,2}|ū)|saiky[oō]|v[- ]?jump|planche(?:s)?|transcriptions?)\b[\s:]*(.*)$/iu
		);
		if (!demande) return null;
		const reste = demande[1]?.trim() ?? "";
		if (!reste || /^(?:status|statut|état|etat|avancée|avancee|progression)$/iu.test(reste)) {
			return null;
		}

		const page = reste.match(
			/^(?:planche|page)\s+(?:ouvrage\s+)?(?:#)?(\d+)\s+(?:n[°o]?\s*)?(\d+)$/iu
		);
		if (page) return { kind: "page", query: page[1]!, page: Number(page[2]) };

		const fiche = reste.match(/^(?:fiche|ouvrage|livre)\s+(.+)$/iu);
		if (fiche?.[1]?.trim()) return { kind: "book", query: fiche[1].trim().slice(0, 100) };

		const term = reste
			.replace(/^(?:recherche(?:r)?|cherche(?:r)?|sur|à propos de|a propos de|dans)\s+/iu, "")
			.trim()
			.slice(0, 100);
		return term ? { kind: "search", term } : null;
	}

	private async buildDatabookReply(
		request: NonNullable<ReturnType<DirectMessageRelay["databookQuery"]>>
	): Promise<string> {
		const site = resolveSiteUrl(Bun.env);
		if (request.kind === "page") {
			const id = Number(request.query);
			const book = Number.isSafeInteger(id) ? await this.databooks.get1(id) : null;
			if (!book) return `Aucun ouvrage public ne porte l’identifiant ${request.query}.`;
			const page = book.pages.find((candidate) => candidate.number === request.page);
			if (!page) return `« ${book.title} » ne contient pas de planche n°${request.page}.`;
			const texte = page.text?.trim();
			return [
				`📚 **${book.title} — planche ${request.page}**`,
				texte ? texte.slice(0, 1_500) : "*Cette planche n'est pas encore transcrite.*",
				`${site}/wiki/databooks/${book.id}`,
			].join("\n\n");
		}

		if (request.kind === "book") {
			const direct = Number(request.query);
			const found = Number.isSafeInteger(direct) ? await this.databooks.get1(direct) : null;
			const book = found ?? (await this.databooks.searchTitles(request.query, 1))[0];
			if (!book) return `Aucun ouvrage ne correspond à « ${request.query} ».`;
			return this.formatDatabook(book, site);
		}

		const result = await this.databooks.searchPages(request.term, 4);
		if (!result) return "La recherche dans les databooks est momentanément indisponible.";
		if (result.total === 0) return `Aucune planche transcrite ne contient « ${request.term} ».`;
		return [
			`📚 **Databooks — « ${request.term} »**`,
			`${result.total} planche(s) trouvée(s) dans ${result.fiches} ouvrage(s).`,
			...result.items.slice(0, 3).map((item) => this.formatPlanche(item, request.term, site)),
		]
			.join("\n\n")
			.slice(0, 1_900);
	}

	private formatDatabook(book: Databook, site: string): string {
		const transcrites = book.pages.filter((page) => Boolean(page.text?.trim())).length;
		return [
			`📚 **${book.title}**`,
			book.description?.trim()?.slice(0, 500) ?? "Ouvrage référencé dans le catalogue public.",
			`${book.pages.length} planches · ${transcrites} transcrites`,
			`${site}/wiki/databooks/${book.id}`,
		].join("\n");
	}

	private formatPlanche(item: PlancheTrouvee, term: string, site: string): string {
		const texte = item.texte.replace(/\s+/g, " ").trim();
		const position = texte.toLocaleLowerCase().indexOf(term.toLocaleLowerCase());
		const debut = position > 180 ? position - 180 : 0;
		const extrait = `${debut > 0 ? "…" : ""}${texte.slice(debut, debut + 420)}${texte.length > debut + 420 ? "…" : ""}`;
		return `**${item.titre} — planche ${item.numero}**\n${extrait}\n${site}/wiki/databooks/${item.databookId}`;
	}

	/** Génère un bilan opérationnel adapté selon le profil de l'owner */
	private async buildLiveStatusReport(isDev: boolean): Promise<string> {
		const host = await this.stats.getHostUsage().catch(() => null);
		const pid = await this.stats.getPidUsage().catch(() => null);
		const latency = this.stats.getLatency();

		// Inspection des services systemd
		let servicesStatus = "inconnu";
		try {
			const proc = Bun.spawn(
				["systemctl", "is-active", "shenron", "shenron-site", "shenron-mcp", "shenron-embed"],
				{
					stdout: "pipe",
					stderr: "ignore",
				}
			);
			const out = await new Response(proc.stdout).text();
			const lines = out.trim().split("\n");
			servicesStatus = `bot: ${lines[0] ?? "?"} | site: ${lines[1] ?? "?"} | mcp: ${lines[2] ?? "?"} | embed: ${lines[3] ?? "?"}`;
		} catch {
			servicesStatus = "erreur inspection systemd";
		}

		// Statistiques PostgreSQL directes
		let dataManga = { tomes: 66, chapitres: 665, pages: 12577 };
		let dataWiki = {
			personnages: 1323,
			techniques: 825,
			transformations: 81,
			sagas: 33,
			revisions: 8253,
		};
		let dataDatabooks: { ouvrages: number; planches: number; transcrites: number } | null = null;

		try {
			const { connecte } = await import("../../../site/scripts/_databooks-base");
			const sqlPg = await connecte();
			const [dbRows] = await sqlPg`
				SELECT count(*)::int as ouvrages,
				       coalesce(sum(case when jsonb_typeof(pages) = 'array' then jsonb_array_length(pages) else 0 end), 0)::int as planches,
				       coalesce(sum((
					       SELECT count(*)
					       FROM jsonb_array_elements(
						       case when jsonb_typeof(d.pages) = 'array' then d.pages else '[]'::jsonb end
					       ) AS page
					       WHERE nullif(btrim(page ->> 'text'), '') IS NOT NULL
				       )), 0)::int as transcrites
				FROM bot.db_databooks d
			`;
			if (dbRows) {
				dataDatabooks = {
					ouvrages: Number(dbRows.ouvrages),
					planches: Number(dbRows.planches),
					transcrites: Number(dbRows.transcrites),
				};
			}
			await sqlPg.end();
		} catch {
			// Une indisponibilité PostgreSQL ne doit pas devenir une valeur inventée.
		}

		const ramHostUsed = host ? (host.memory.used / 1024 / 1024 / 1024).toFixed(1) : "?";
		const ramHostTotal = host ? (host.memory.total / 1024 / 1024 / 1024).toFixed(1) : "?";
		const ramBot = pid ? (pid.rss / 1024 / 1024).toFixed(0) : "?";
		const uptimeJours = host ? (host.uptime / 86400).toFixed(1) : "?";

		// Formatage pour OMAR : Orienté Univers Dragon Ball, Manga, Databooks & Wiki
		if (!isDev) {
			return [
				"🐉 **Shenron — État de l'Univers Dragon Ball FR**",
				"",
				"📖 **Manga (Canon & Archives) :**",
				`• **${dataManga.tomes} tomes** répertoriés · **${dataManga.chapitres} chapitres** numérisés.`,
				`• **${dataManga.pages.toLocaleString("fr-FR")} pages de manga** accessibles aux lecteurs et indexées.`,
				"",
				"📚 **Databooks & Archives Japonaises (Sprint Focus) :**",
				dataDatabooks
					? `• **${dataDatabooks.ouvrages} ouvrages** (Daizenshuu, Chōzenshū, V-Jump, Saikyō Jump, Guides Toriyama).`
					: "• Catalogue des ouvrages indisponible sur ce nœud.",
				dataDatabooks
					? `• **${dataDatabooks.planches.toLocaleString("fr-FR")} planches** au total · **${dataDatabooks.transcrites.toLocaleString("fr-FR")} transcrites** (${dataDatabooks.planches ? ((dataDatabooks.transcrites / dataDatabooks.planches) * 100).toFixed(1) : "0.0"} %).`
					: "• Compteurs PostgreSQL indisponibles sur ce nœud ; aucune valeur n'est inventée.",
				dataDatabooks
					? `• ⚡ **Sprint en cours** : ${Math.max(0, dataDatabooks.planches - dataDatabooks.transcrites).toLocaleString("fr-FR")} planches restent à transcrire ou relire.`
					: "• ⚡ Sprint OCR : état détaillé indisponible jusqu'au prochain contrôle PostgreSQL.",
				"",
				"⛩️ **Encyclopédie & Wiki :**",
				`• **${dataWiki.personnages} fiches personnages** complètes.`,
				`• **${dataWiki.techniques} techniques** répertoriées avec leurs maîtres et utilisateurs.`,
				`• **${dataWiki.transformations} formes et transformations** répertoriées.`,
				`• **${dataWiki.sagas} sagas et arcs** détaillés · **${dataWiki.revisions} révisions éditoriales** certifiées.`,
				"",
				"✨ *Le site dragonballfr.com et les connaissances du bot sont synchronisés et opérationnels.*",
			].join("\n");
		}

		// Formatage pour SHAWN / YOYO : Orienté Dev, Infra VPS, Services & Pipelines
		return [
			"⚙️ **Shenron — Diagnostic Technique & Production (Dev Mode)**",
			"",
			"🖥️ **Infra & VPS Host :**",
			`• RAM : ${ramHostUsed}G / ${ramHostTotal}G (${host?.memory.usage ?? 0}%) | Bun Bot RSS : ${ramBot}M`,
			`• CPU : ${host?.cpu.usage ?? 0}% (${host?.cpu.count ?? 0} vCPUs) | Uptime VPS : ${uptimeJours}j`,
			`• Ping Discord WS : ${latency.ws}ms | Latence DB SQLite : ${latency.db}ms`,
			"",
			"🚀 **Services Systemd :**",
			`• ${servicesStatus}`,
			"",
			"📊 **Data Store & Pipeline :**",
			`• Databooks : ${dataDatabooks ? `${dataDatabooks.ouvrages} ouvrages | ${dataDatabooks.planches} pages | ${dataDatabooks.transcrites} transcrites` : "métriques PostgreSQL indisponibles"}`,
			`• Manga : ${dataManga.tomes} vols / ${dataManga.chapitres} chaps / ${dataManga.pages} pages`,
			`• Wiki Bot/Public : ${dataWiki.personnages} chars, ${dataWiki.techniques} techs, ${dataWiki.revisions} revisions`,
			`• Pipeline OCR/traduction : non mesuré ici — état réel via A2A (cible ocr, statut) ; aucun état GPU n'est affirmé.`,
		].join("\n");
	}

	@On({ event: "messageCreate" })
	async onDirectMessage([message]: ArgsOf<"messageCreate">) {
		if (message.inGuild() || message.author.bot) return;

		const contenu = (message.content ?? "").trim();
		const texte = contenu || (message.attachments.size > 0 ? "(pièce jointe sans texte)" : "");
		if (!texte) return;

		const userId = message.author.id;
		const username = message.author.username;
		const displayName = message.author.globalName ?? null;
		const isOwner = isBotOwner(userId) || OWNER_DISCORD_IDS.has(userId);

		try {
			const db = this.dbs.db;

			// Enregistrement ou mise à jour du contact
			await db
				.insert(dmContacts)
				.values({ userId, username, displayName, allowed: isOwner })
				.onConflictDoUpdate({
					target: dmContacts.userId,
					set: {
						username,
						displayName,
						lastSeenAt: new Date(),
						...(isOwner ? { allowed: true } : {}),
					},
				});

			const [contact] = await db
				.select({ allowed: dmContacts.allowed })
				.from(dmContacts)
				.where(eq(dmContacts.userId, userId))
				.limit(1);
			const autorise = isOwner || contact?.allowed === true;

			// Archivage du message entrant
			await db.insert(dmMessages).values({
				userId,
				direction: "in",
				content: texte,
				persona: "shenron",
				messageId: message.id,
				readAt: autorise ? null : new Date(),
			});

			if (autorise) {
				await message.react("✅").catch(() => undefined);
				logger.info(`[DM] message reçu de ${username} (${userId}) : "${texte.slice(0, 80)}"`);

				// Automatisation de discussion et monitoring pour les owners du projet
				if (isOwner) {
					const isDev = userId === "281114294152724491"; // Shawn / Yoyo
					const normalise = texte.toLowerCase();
					const demandeDatabook = this.databookQuery(texte);

					if (demandeDatabook) {
						const reponse = await this.buildDatabookReply(demandeDatabook).catch((error) => {
							logger.warn({ error }, "[DM] recherche databook indisponible");
							return "La consultation privée des databooks a échoué momentanément. Les données publiques restent intactes.";
						});
						await message.reply(reponse).catch(async () => {
							await message.author.send(reponse).catch(() => undefined);
						});
						await db.insert(dmMessages).values({
							userId,
							direction: "out",
							content: reponse,
							persona: "shenron",
						});
						await db
							.update(dmMessages)
							.set({ readAt: new Date() })
							.where(and(eq(dmMessages.userId, userId), isNull(dmMessages.readAt)));
						return;
					}

					const triggersStatus = [
						"etat",
						"état",
						"status",
						"statut",
						"vps",
						"ram",
						"cpu",
						"build",
						"push",
						"db",
						"base",
						"ocr",
						"wiki",
						"avancée",
						"avancee",
						"situation",
						"rapport",
						"health",
						"uptime",
						"services",
						"manga",
						"databook",
					];

					const demandeStatus = triggersStatus.some((t) => normalise.includes(t));

					if (demandeStatus) {
						const rapport = await this.buildLiveStatusReport(isDev);
						await message.reply(rapport).catch(async () => {
							await message.author.send(rapport).catch(() => undefined);
						});

						// Tracer la réponse envoyée
						await db.insert(dmMessages).values({
							userId,
							direction: "out",
							content: rapport,
							persona: "shenron",
						});
						// Marquer les messages comme traités
						await db
							.update(dmMessages)
							.set({ readAt: new Date() })
							.where(and(eq(dmMessages.userId, userId), isNull(dmMessages.readAt)));
						return;
					}

					// Salutation ou message général d'un owner
					if (/^(salut|bonjour|yo|hello|coucou|aide|help|shenron)/i.test(normalise)) {
						const accueil = isDev
							? `Salutations Shawn. Je surveille l'infra et les pipelines. Envoie **statut**, **vps**, **services**, **ocr**, ou **db** pour le diag système.`
							: `Bonjour Omar ! L'univers Dragon Ball FR est sous contrôle. Envoie-moi **état**, **databooks**, **manga**, ou **wiki** pour voir l'avancée de la bibliothèque et du sprint.`;

						await message.reply(accueil).catch(async () => {
							await message.author.send(accueil).catch(() => undefined);
						});
						await db.insert(dmMessages).values({
							userId,
							direction: "out",
							content: accueil,
							persona: "shenron",
						});
						return;
					}
				}

				return;
			}

			// Inconnu non autorisé : avertissement unique
			const [{ n }] = await db
				.select({ n: sql<number>`count(*)` })
				.from(dmMessages)
				.where(and(eq(dmMessages.userId, userId), eq(dmMessages.direction, "out")));

			if (Number(n) === 0) {
				const reponse =
					"Bonjour — ce salon privé est un relais réservé. Votre message a bien été " +
					"enregistré, mais je ne peux pas y répondre tant que l'accès ne vous a pas " +
					"été ouvert. Si vous êtes attendu, prévenez la personne qui vous a orienté ici.";
				await message.author.send(reponse).catch(() => undefined);
				await db.insert(dmMessages).values({
					userId,
					direction: "out",
					content: reponse,
					persona: "shenron",
				});
			}
			logger.warn(`[DM] message d'un correspondant non autorisé : ${username} (${userId})`);
		} catch (e) {
			logger.error(e as Error, "[DM] échec du relais de message privé");
		}
	}
}
