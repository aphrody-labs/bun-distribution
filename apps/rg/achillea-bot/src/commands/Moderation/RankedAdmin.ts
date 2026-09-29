import type { CommandInteraction, User as DiscordUser } from "discord.js";
import {
	ApplicationCommandOptionType,
	Colors,
	EmbedBuilder,
	escapeMarkdown,
	GuildMember,
	MessageFlags,
	userMention,
} from "discord.js";
import type { Client } from "@aphrody/discordx";

import { adminManagerConfig } from "@/configs";
import { Discord, Guild, Injectable, Slash, SlashGroup, SlashOption } from "@/decorators";
import { User as UserEntity } from "@/entities";
import { Database } from "@/services";
import { MatchMode, UserRole } from "@/utils/enums";
import { followUpWithErrorEmbed } from "@/utils/functions";

// =============================================================================
// Arbitrage ranked (STAFF)
// -----------------------------------------------------------------------------
// Commande Discord d'arbitrage des matchs classés. Elle ne contient AUCUNE
// logique ELO : elle délègue aux endpoints admin du sous-process Colyseus
// (logique centralisée), authentifiés par le secret interne partagé.
//   - GET  /api/admin/lobbies/disputes
//   - POST /api/admin/lobbies/:id/validate
//   - POST /api/admin/lobbies/:id/cancel
//   - GET  /api/admin/ranked/telemetry
// L'appartenance au staff est vérifiée ICI (entité User, champ role) avant tout
// appel : LECTURE → Modérateur+ ; ACTIONS → Administrator+.
// =============================================================================

// ---- Contrats de réponse du sous-process ranked --------------------------------

interface DisputePlayerDto {
	userId: string;
	displayName: string;
	submittedScore: number;
	claimedOpponentScore: number;
	screenshotUrl: string | null;
}

interface DisputeDto {
	lobbyId: number;
	mode: number;
	player1: DisputePlayerDto;
	player2: DisputePlayerDto;
	createdAt: string;
}

interface TelemetryEventDto {
	id: number;
	createdAt: string;
	lobbyId: number | null;
	roomCode: string | null;
	mode: number | null;
	userId: string | null;
	displayName: string | null;
	type: string;
	detail: unknown;
}

interface ValidateResultDto {
	ok: boolean;
	eloDelta: { p1: number; p2: number };
}

// ---- Helpers de présentation --------------------------------------------------

/** Port du sous-process ranked (cf. main.ts : RANKED_PORT ?? PORT ?? 4002). */
function rankedPort(): string {
	return process.env.RANKED_PORT ?? process.env.PORT ?? "4002";
}

function modeLabel(mode: number | null): string {
	if (mode === MatchMode.ONE_VS_ONE) return "Standard (1v1)";
	if (mode === MatchMode.TWO_VS_TWO) return "Double (2v2)";
	return mode == null ? "—" : `Mode ${mode}`;
}

/** Timestamp Discord relatif/absolu à partir d'une date ISO ou d'un Date. */
function discordTs(value: string | Date, style: "R" | "t" | "f" = "R"): string {
	const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
	if (!Number.isFinite(ms)) return "—";
	return `<t:${Math.floor(ms / 1000)}:${style}>`;
}

/** Origine PUBLIQUE du sous-process ranked (sert /storage/disputes/*) — lien cliquable Discord. */
function rankedPublicOrigin(): string {
	return (process.env.RANKED_PUBLIC_URL ?? "https://ranked.rosegriffon.fr").replace(/\/$/, "");
}

function screenshotLink(url: string | null): string {
	if (!url) return "pas de capture";
	const full = url.startsWith("http") ? url : `${rankedPublicOrigin()}${url}`;
	return `[capture](${full})`;
}

function signed(n: number): string {
	return n >= 0 ? `+${n}` : `${n}`;
}

// =============================================================================
// Command class
// =============================================================================

@Discord()
@Injectable()
@Guild(adminManagerConfig.adminGuildId)
@SlashGroup({ name: "ranked-admin", description: "Arbitrage des matchs classés (staff)" })
@SlashGroup("ranked-admin")
export default class RankedAdminCommands {
	constructor(private db: Database) {}

	// -------------------------------------------------------------------------
	// Garde d'accès — vérifie le rôle de l'appelant en base
	// -------------------------------------------------------------------------

	private async ensureRole(interaction: CommandInteraction, minRole: UserRole): Promise<boolean> {
		const caller = await this.db.get(UserEntity).findOne({ id: interaction.user.id });
		const role = caller?.role ?? UserRole.User;
		if (role < minRole) {
			followUpWithErrorEmbed(
				interaction,
				"Accès refusé : vous n'avez pas les permissions requises pour cette action.",
				true
			);
			return false;
		}
		return true;
	}

	// -------------------------------------------------------------------------
	// Appel HTTP interne au sous-process ranked (secret + acteur)
	// status === 0 ⇒ erreur réseau (sous-process injoignable).
	// -------------------------------------------------------------------------

	private async rankedFetch<T>(
		path: string,
		actorId: string,
		init?: { method?: "GET" | "POST"; body?: unknown }
	): Promise<{ ok: boolean; status: number; data: T | null }> {
		const method = init?.method ?? "GET";
		// IMPORTANT : un POST sans body fait planter la couche express du sous-process
		// (bun-serve-express : « stream argument must be ReadableStream »). On envoie donc
		// TOUJOURS un corps JSON (au moins `{}`) sur les POST.
		const sendBody = method === "POST";
		const headers: Record<string, string> = {
			"x-internal-secret": process.env.RANKED_INTERNAL_SECRET ?? "",
			"x-internal-actor": actorId,
		};
		if (sendBody) headers["content-type"] = "application/json";

		try {
			const res = await fetch(`http://127.0.0.1:${rankedPort()}${path}`, {
				method,
				headers,
				body: sendBody ? JSON.stringify(init?.body ?? {}) : undefined,
			});
			let data: T | null = null;
			try {
				data = (await res.json()) as T;
			} catch {
				data = null;
			}
			return { ok: res.ok, status: res.status, data };
		} catch (err) {
			console.error(`[RankedAdmin] fetch ${path} échoué`, err);
			return { ok: false, status: 0, data: null };
		}
	}

	private networkError(interaction: CommandInteraction): void {
		followUpWithErrorEmbed(
			interaction,
			"Le service ranked est injoignable. Réessayez dans un instant.",
			true
		);
	}

	// -------------------------------------------------------------------------
	// /ranked-admin litiges — liste les matchs contestés
	// -------------------------------------------------------------------------

	@Slash({ name: "litiges", description: "Lister les litiges ranked en attente d'arbitrage" })
	async litiges(interaction: CommandInteraction, _client: Client) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!(await this.ensureRole(interaction, UserRole.Moderator))) return;

		const { ok, status, data } = await this.rankedFetch<DisputeDto[]>(
			"/api/admin/lobbies/disputes",
			interaction.user.id
		);
		if (status === 0) return this.networkError(interaction);
		if (!ok || !Array.isArray(data)) {
			return followUpWithErrorEmbed(
				interaction,
				`Impossible de récupérer les litiges (code ${status}).`,
				true
			);
		}

		if (data.length === 0) {
			const embed = new EmbedBuilder()
				.setColor(Colors.Green)
				.setTitle("🎖️ Litiges ranked")
				.setDescription("Aucun litige en attente. ✅")
				.setTimestamp();
			return interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
		}

		const embed = new EmbedBuilder()
			.setColor(Colors.Orange)
			.setTitle(`🎖️ Litiges ranked en attente (${data.length})`)
			.setDescription(
				"Utilisez `/ranked-admin valider` ou `/ranked-admin annuler` avec l'ID du lobby."
			)
			.setTimestamp();

		// Discord limite à 25 fields ; on affiche les 10 plus anciens.
		const shown = data.slice(0, 10);
		for (const d of shown) {
			const p1 = d.player1;
			const p2 = d.player2;
			const value =
				`**${escapeMarkdown(p1.displayName)}** (${userMention(p1.userId)})\n` +
				`→ a annoncé **${p1.submittedScore}** · adverse réclamé **${p1.claimedOpponentScore}** · ${screenshotLink(p1.screenshotUrl)}\n` +
				`**${escapeMarkdown(p2.displayName)}** (${userMention(p2.userId)})\n` +
				`→ a annoncé **${p2.submittedScore}** · adverse réclamé **${p2.claimedOpponentScore}** · ${screenshotLink(p2.screenshotUrl)}\n` +
				`Créé ${discordTs(d.createdAt)}`;
			embed.addFields({
				name: `🆔 Lobby #${d.lobbyId} — ${modeLabel(d.mode)}`,
				value: value.slice(0, 1024),
				inline: false,
			});
		}

		if (data.length > shown.length) {
			embed.setFooter({
				text: `… et ${data.length - shown.length} autre(s) litige(s) non affiché(s).`,
			});
		}

		await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
	}

	// -------------------------------------------------------------------------
	// /ranked-admin valider — applique le score + ELO
	// -------------------------------------------------------------------------

	@Slash({ name: "valider", description: "Trancher un litige : appliquer un score et l'ELO" })
	async valider(
		@SlashOption({
			name: "lobby",
			description: "ID du lobby à trancher",
			type: ApplicationCommandOptionType.Integer,
			required: true,
			minValue: 1,
		})
		lobbyId: number,
		@SlashOption({
			name: "score1",
			description: "Score de l'équipe 1 (joueur 1)",
			type: ApplicationCommandOptionType.Integer,
			required: true,
			minValue: 0,
			maxValue: 99,
		})
		scoreTeam1: number,
		@SlashOption({
			name: "score2",
			description: "Score de l'équipe 2 (joueur 2)",
			type: ApplicationCommandOptionType.Integer,
			required: true,
			minValue: 0,
			maxValue: 99,
		})
		scoreTeam2: number,
		@SlashOption({
			name: "forfait",
			description: "Joueur déclaré forfait (optionnel)",
			type: ApplicationCommandOptionType.User,
			required: false,
		})
		forfaitUser: DiscordUser | GuildMember | undefined,
		interaction: CommandInteraction,
		_client: Client
	) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!(await this.ensureRole(interaction, UserRole.Administrator))) return;

		const forfeitUserId = forfaitUser
			? forfaitUser instanceof GuildMember
				? forfaitUser.user.id
				: forfaitUser.id
			: undefined;

		const { ok, status, data } = await this.rankedFetch<ValidateResultDto>(
			`/api/admin/lobbies/${lobbyId}/validate`,
			interaction.user.id,
			{ method: "POST", body: { scoreTeam1, scoreTeam2, forfeitUserId } }
		);
		if (status === 0) return this.networkError(interaction);
		if (status === 404) {
			return followUpWithErrorEmbed(interaction, `Lobby #${lobbyId} introuvable.`, true);
		}
		if (!ok || !data?.ok) {
			return followUpWithErrorEmbed(
				interaction,
				`Échec de la validation du lobby #${lobbyId} (code ${status}).`,
				true
			);
		}

		const embed = new EmbedBuilder()
			.setColor(Colors.Green)
			.setTitle(`✅ Litige tranché — Lobby #${lobbyId}`)
			.addFields(
				{ name: "Score appliqué", value: `**${scoreTeam1}** — **${scoreTeam2}**`, inline: true },
				{ name: "ΔELO joueur 1", value: signed(data.eloDelta.p1), inline: true },
				{ name: "ΔELO joueur 2", value: signed(data.eloDelta.p2), inline: true },
				{
					name: "Forfait",
					value: forfeitUserId ? userMention(forfeitUserId) : "Aucun",
					inline: false,
				},
				{ name: "Arbitre", value: userMention(interaction.user.id), inline: false }
			)
			.setTimestamp();

		await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
	}

	// -------------------------------------------------------------------------
	// /ranked-admin annuler — annule le match (aucun ELO)
	// -------------------------------------------------------------------------

	@Slash({ name: "annuler", description: "Annuler un match (aucun ELO appliqué)" })
	async annuler(
		@SlashOption({
			name: "lobby",
			description: "ID du lobby à annuler",
			type: ApplicationCommandOptionType.Integer,
			required: true,
			minValue: 1,
		})
		lobbyId: number,
		interaction: CommandInteraction,
		_client: Client
	) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!(await this.ensureRole(interaction, UserRole.Administrator))) return;

		const { ok, status } = await this.rankedFetch<{ ok: boolean }>(
			`/api/admin/lobbies/${lobbyId}/cancel`,
			interaction.user.id,
			{ method: "POST" }
		);
		if (status === 0) return this.networkError(interaction);
		if (status === 409) {
			return followUpWithErrorEmbed(
				interaction,
				`Le lobby #${lobbyId} n'est pas annulable (déjà résolu ou inexistant).`,
				true
			);
		}
		if (!ok) {
			return followUpWithErrorEmbed(
				interaction,
				`Échec de l'annulation du lobby #${lobbyId} (code ${status}).`,
				true
			);
		}

		const embed = new EmbedBuilder()
			.setColor(Colors.Red)
			.setTitle(`🚫 Match annulé — Lobby #${lobbyId}`)
			.setDescription("Aucun point d'ELO n'a été appliqué.")
			.addFields({ name: "Arbitre", value: userMention(interaction.user.id), inline: false })
			.setTimestamp();

		await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
	}

	// -------------------------------------------------------------------------
	// /ranked-admin logs — journal de télémétrie ranked
	// -------------------------------------------------------------------------

	@Slash({ name: "logs", description: "Consulter le journal des événements ranked" })
	async logs(
		@SlashOption({
			name: "lobby",
			description: "Filtrer par ID de lobby (optionnel)",
			type: ApplicationCommandOptionType.Integer,
			required: false,
			minValue: 1,
		})
		lobbyId: number | undefined,
		interaction: CommandInteraction,
		_client: Client
	) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!(await this.ensureRole(interaction, UserRole.Moderator))) return;

		const limit = 15;
		const query = `?limit=${limit}${lobbyId != null ? `&lobbyId=${lobbyId}` : ""}`;
		const { ok, status, data } = await this.rankedFetch<TelemetryEventDto[]>(
			`/api/admin/ranked/telemetry${query}`,
			interaction.user.id
		);
		if (status === 0) return this.networkError(interaction);
		if (!ok || !Array.isArray(data)) {
			return followUpWithErrorEmbed(
				interaction,
				`Impossible de récupérer le journal (code ${status}).`,
				true
			);
		}

		const scope = lobbyId != null ? ` — Lobby #${lobbyId}` : "";

		if (data.length === 0) {
			const embed = new EmbedBuilder()
				.setColor(Colors.Blue)
				.setTitle(`📜 Journal ranked${scope}`)
				.setDescription("Aucun événement.")
				.setTimestamp();
			return interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
		}

		const lines = data.slice(0, limit).map((e) => {
			const actor = e.displayName
				? escapeMarkdown(e.displayName)
				: e.userId
					? userMention(e.userId)
					: "système";
			const lobbyTag = lobbyId == null && e.lobbyId != null ? ` · lobby #${e.lobbyId}` : "";
			return `${discordTs(e.createdAt, "t")} · \`${e.type}\` · ${actor}${lobbyTag}`;
		});

		const embed = new EmbedBuilder()
			.setColor(Colors.Blue)
			.setTitle(`📜 Journal ranked${scope}`)
			.setDescription(lines.join("\n").slice(0, 4000))
			.setFooter({ text: `${data.length} dernier(s) événement(s)` })
			.setTimestamp();

		await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
	}
}
