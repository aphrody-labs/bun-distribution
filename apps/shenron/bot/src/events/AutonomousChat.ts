/**
 * AutonomousChat.ts — messageCreate : indexation Redis temps réel + réponses autonomes
 * (mention, interpellation par nom, ou proactif) grondées par RAG + NOTRE LLM maison.
 *
 * Intents (cf. personas.ts) :
 *   - whis a GuildMessages -> reçoit les messages, contenu dispo sur @mention (exempté MessageContent).
 *   - grandPretre a GuildMessages + MessageContent -> contenu COMPLET sur tous les messages :
 *     c'est donc lui le persona PROACTIF (lecture du lore) ET l'indexeur temps réel (contenu pour
 *     les analytics lore/sentiment). Anti-collision : un seul persona proactif.
 *   - beerus/shenron n'ont pas GuildMessages -> leur handler reste inerte tant que l'intent n'est
 *     pas ajouté (changement sûr et non privilégié, à activer plus tard si besoin).
 */
import { container, inject, injectable } from "tsyringe";
import { ChannelType } from "discord.js";
import { Bot, Discord, On, type ArgsOf } from "discordx";
import { DatabaseService } from "~/db/index";
import { RedisIndexerService } from "~/lib/redis-indexer";
import { hybridSearch } from "~/lib/rag";
import { generateLlmAnswer } from "~/lib/llm";
import { logger } from "~/lib/logger";
import { SettingsService } from "~/services/SettingsService";

/** Persona qui assure l'indexation temps réel (a MessageContent -> voit le contenu). */
const INDEXER_PERSONA = "grandpretre";
/** Personas autorisés au déclenchement proactif (anti-collision multi-bots ; MessageContent requis). */
const PROACTIVE_PERSONAS = new Set(["grandpretre"]);

const LORE_KEYWORDS = [
	"goku",
	"vegeta",
	"freezer",
	"cell",
	"buu",
	"gohan",
	"trunks",
	"piccolo",
	"whis",
	"beerus",
	"bulma",
	"krillin",
	"broly",
	"bardock",
	"kamehameha",
	"fusion",
	"daima",
	"saiyan",
	"namek",
];

const ASK_MORE: Record<string, string> = {
	whis: "Oh oh, posez une question plus précise sur nos archives, je vous prie.",
	beerus: "Parle plus clairement, ou je détruis ta planète !",
	shenron: "Exprime ton souhait plus clairement, mortel.",
	grandpretre: "Formulez votre requête avec plus de précision, créature.",
	kaio: "Hé hé, sois plus précis, jeune combattant !",
	enma: "Précise ta demande. Suivant !",
};
const NO_RESULT: Record<string, string> = {
	whis: "Oh oh, mes archives de l'Univers 7 restent bien silencieuses à ce sujet.",
	beerus: "Cette question est insignifiante. Même mes archives n'en parlent pas.",
	shenron: "Je ne peux accomplir ce souhait, cette information m'est inconnue.",
	grandpretre: "Même l'omniscience ne trouve rien à ce sujet dans nos archives.",
	kaio: "Ah ! Là tu me poses une colle, mes notes sont muettes là-dessus.",
	enma: "Dossier introuvable. Au suivant !",
};

class BaseAutonomousChat {
	constructor(
		protected dbs: DatabaseService,
		protected redisIndexer: RedisIndexerService,
		protected personaId: "whis" | "beerus" | "shenron" | "grandpretre" | "kaio"
	) {}

	/**
	 * Vrai si le salon interdit le chat autonome :
	 *   - salon Discord de type Annonces (ou thread d'annonce) ;
	 *   - salon configuré comme `channel.announce` ;
	 *   - salon listé dans `chat.blacklist_channels` (settings, cache mémoire).
	 */
	private async isNoChatChannel(message: ArgsOf<"messageCreate">[0]): Promise<boolean> {
		const type = message.channel.type;
		if (type === ChannelType.GuildAnnouncement || type === ChannelType.AnnouncementThread) {
			return true;
		}
		const settings = container.resolve(SettingsService);
		const announceId = await settings.getSnowflake("channel.announce");
		if (announceId && message.channelId === announceId) return true;
		const raw = await settings.getString("chat.blacklist_channels", "");
		if (
			raw &&
			raw
				.split(/[\s,]+/)
				.filter(Boolean)
				.includes(message.channelId)
		)
			return true;
		return false;
	}

	async handleMessage(message: ArgsOf<"messageCreate">[0]) {
		if (!message.inGuild() || message.author.bot) return;

		// 1. Indexation temps réel — un seul persona (celui qui a MessageContent) pour éviter les doublons.
		if (this.personaId === INDEXER_PERSONA) {
			try {
				this.redisIndexer.indexSingleMessage(
					message.id,
					message.content || "",
					message.author.id,
					message.channelId,
					message.createdAt,
					{
						id: message.author.id,
						username: message.author.username,
						displayName:
							message.member?.displayName ?? message.author.globalName ?? message.author.username,
						bot: message.author.bot,
					}
				);
			} catch (e) {
				logger.error(e as Error, "[REDIS INDEX] Échec indexation temps réel");
			}
		}

		// 2. Kill-switch réponses IA autonomes. Désactivable à chaud (`/config`,
		// clé `chat.autonomous_enabled`) SANS redéploiement. L'indexation temps réel
		// ci-dessus reste active (analytics) — seule la réponse IA est supprimée.
		const settings = container.resolve(SettingsService);
		if (!(await settings.getBool("chat.autonomous_enabled", false))) return;

		// 3. Décider d'une réponse autonome.
		const botUser = message.client.user;
		if (!botUser) return;

		// JAMAIS de réponse autonome dans un salon d'annonces (bug : Whis & Grand
		// Prêtre répondaient aux annonces) ni dans un salon blacklisté. L'indexation
		// ci-dessus reste active (analytics), seule la réponse est supprimée.
		if (await this.isNoChatChannel(message)) return;

		const content = (message.content || "").toLowerCase();
		const isMentioned = message.mentions.has(botUser.id);
		const isNameCalled = content.length > 0 && content.includes(this.personaId);
		let shouldRespond = isMentioned || isNameCalled;

		if (!shouldRespond && PROACTIVE_PERSONAS.has(this.personaId)) {
			const isQuestion =
				content.includes("?") ||
				/^(comment|pourquoi|qui|quel|quelle|où|est-ce|combien)/i.test(content);
			const containsDbzTerms = LORE_KEYWORDS.some((k) => content.includes(k));
			if (isQuestion && containsDbzTerms && Math.random() < 0.03) {
				shouldRespond = true;
				logger.info(
					`[PROACTIVE CHAT] ${this.personaId} s'active : "${message.content?.slice(0, 80)}"`
				);
			}
		}

		if (!shouldRespond) return;

		logger.info(`[AUTONOMOUS CHAT] ${this.personaId} s'active dans ${message.channelId}`);
		const query = (message.content || "")
			.replace(new RegExp(`<@!?${botUser.id}>`, "g"), "")
			.replace(new RegExp(this.personaId, "gi"), "")
			.trim();

		if (query.length < 3) {
			await message.reply(ASK_MORE[this.personaId] ?? ASK_MORE.whis).catch(() => {});
			return;
		}

		try {
			await message.channel.sendTyping().catch(() => {});
			const answer = await this.generateAnswer(query, message.channelId);
			// S6 : un texte généré ne notifie que l'auteur de la question — jamais
			// @everyone/@here, un rôle ou un utilisateur injecté dans la réponse.
			await message
				.reply({ content: answer, allowedMentions: { parse: [], repliedUser: true } })
				.catch(() => {});
		} catch (err) {
			logger.error(err as Error, `[AUTONOMOUS CHAT] Échec génération pour ${this.personaId}`);
		}
	}

	/** Réponse LLM ancrée par le RAG, avec mémoire par salon. */
	protected async generateAnswer(query: string, channelId: string): Promise<string> {
		// On récupère des faits RAG (peuvent être vides : le modèle gère le bavardage tout seul).
		const { results } = await hybridSearch(this.dbs.sqlite, query, 5);
		// Mémoire par salon -> vraie conversation avec contexte.
		return generateLlmAnswer(this.dbs.sqlite, query, results, this.personaId, {
			sessionId: `discord:${channelId}`,
		});
	}
}

@Discord()
@Bot("shenron")
@injectable()
export class GrandPretreAutonomousChat extends BaseAutonomousChat {
	constructor(
		@inject(DatabaseService) dbs: DatabaseService,
		@inject(RedisIndexerService) redisIndexer: RedisIndexerService
	) {
		super(dbs, redisIndexer, "grandpretre");
	}

	@On({ event: "messageCreate" })
	async onMessage([message]: ArgsOf<"messageCreate">) {
		await this.handleMessage(message);
	}
}

@Discord()
@Bot("shenron")
@injectable()
export class WhisAutonomousChat extends BaseAutonomousChat {
	constructor(
		@inject(DatabaseService) dbs: DatabaseService,
		@inject(RedisIndexerService) redisIndexer: RedisIndexerService
	) {
		super(dbs, redisIndexer, "whis");
	}

	@On({ event: "messageCreate" })
	async onMessage([message]: ArgsOf<"messageCreate">) {
		await this.handleMessage(message);
	}
}

@Discord()
@Bot("shenron")
@injectable()
export class BeerusAutonomousChat extends BaseAutonomousChat {
	constructor(
		@inject(DatabaseService) dbs: DatabaseService,
		@inject(RedisIndexerService) redisIndexer: RedisIndexerService
	) {
		super(dbs, redisIndexer, "beerus");
	}

	@On({ event: "messageCreate" })
	async onMessage([message]: ArgsOf<"messageCreate">) {
		await this.handleMessage(message);
	}
}

@Discord()
@Bot("shenron")
@injectable()
export class ShenronAutonomousChat extends BaseAutonomousChat {
	constructor(
		@inject(DatabaseService) dbs: DatabaseService,
		@inject(RedisIndexerService) redisIndexer: RedisIndexerService
	) {
		super(dbs, redisIndexer, "shenron");
	}

	@On({ event: "messageCreate" })
	async onMessage([message]: ArgsOf<"messageCreate">) {
		await this.handleMessage(message);
	}
}
