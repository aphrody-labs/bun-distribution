// SPDX-License-Identifier: Apache-2.0
import { resolveApiUrl } from "@shenron/config/public-urls";
import { injectable, inject } from "tsyringe";
import { Bot, ButtonComponent, Discord, Guard, Slash, SlashGroup, SlashOption } from "discordx";
import {
	ActionRowBuilder,
	ApplicationCommandOptionType,
	ButtonBuilder,
	ButtonStyle,
	EmbedBuilder,
	MessageFlags,
	type ButtonInteraction,
	type CommandInteraction,
} from "discord.js";
import { GuildOnly } from "~/guards/GuildOnly";
import { DatabaseService } from "~/db/index";
import {
	countMangaCandidates,
	extractTranslationPairs,
	getMangaCandidate,
	listMangaCandidates,
	type MangaCandidateRow,
} from "~/db/manga-candidates";
import { approveAndPublishMangaCandidate, rejectMangaCandidate } from "~/lib/manga-publish";
import { isBotStaff } from "~/api/staff-check";
import { SHENRON_THEME } from "~/lib/embeds";

/**
 * `/scanlate` — revue staff des traductions de planches proposées par Koharu
 * (`shenron.manga.review-candidate/v1`). Approuver publie la traduction.
 */

const ASSETS = resolveApiUrl(Bun.env);

const STATUS_LABEL: Record<MangaCandidateRow["status"], string> = {
	unreviewed: "🕒 À relire",
	approved: "✅ Approuvé",
	rejected: "❌ Rejeté",
	published: "📖 Publié",
};

/** URL de l'image de planche : http(s) tel quel, sinon servie par le bot. */
export function plancheImageUrl(row: MangaCandidateRow): string | null {
	const candidates = [row.payload.source.url, row.payload.image];
	for (const value of candidates) {
		if (!value) continue;
		if (/^https?:\/\//.test(value)) return value;
	}
	const image = row.payload.image;
	if (!image || image.includes("..")) return null;
	return `${ASSETS}/${image.replace(/^\.?\/*/, "")}`;
}

function clip(text: string | null, max: number): string {
	const value = (text ?? "").trim() || "—";
	return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** Embed de revue : paires source → traduction + image de planche. */
export function candidateEmbed(row: MangaCandidateRow): EmbedBuilder {
	const pairs = extractTranslationPairs(row.payload);
	const embed = new EmbedBuilder()
		.setColor(row.status === "unreviewed" ? SHENRON_THEME.gold : SHENRON_THEME.saiyanBlue)
		.setTitle(`Planche ${row.pageId} · candidat #${row.id}`)
		.setDescription(
			`${STATUS_LABEL[row.status]}${row.reviewer ? ` · ${row.reviewer}` : ""}\n` +
				`Pipeline : \`${row.payload.pipeline.name} ${row.payload.pipeline.version}\` · ` +
				`${pairs.length} bulle(s) traduite(s)`
		)
		.setFooter({ text: `hash ${row.candidateHash.slice(0, 12)}` });
	for (const [index, pair] of pairs.slice(0, 12).entries()) {
		embed.addFields({
			name: clip(`${index + 1}. ${pair.sourceText ?? "(source absente)"}`, 256),
			value: clip(pair.translatedText, 1024),
		});
	}
	if (pairs.length > 12) {
		embed.addFields({ name: "…", value: `${pairs.length - 12} bulle(s) non affichée(s).` });
	}
	const image = plancheImageUrl(row);
	if (image) embed.setImage(image);
	return embed;
}

function reviewButtons(id: number): ActionRowBuilder<ButtonBuilder> {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId(`scanlate:approve:${id}`)
			.setStyle(ButtonStyle.Success)
			.setLabel("Approuver et publier"),
		new ButtonBuilder()
			.setCustomId(`scanlate:reject:${id}`)
			.setStyle(ButtonStyle.Danger)
			.setLabel("Rejeter")
	);
}

@Discord()
@Bot("shenron")
@Guard(GuildOnly)
@SlashGroup({
	name: "scanlate",
	description: "Revue des traductions de planches manga (staff)",
})
@SlashGroup("scanlate")
@injectable()
export class ScanlateCommands {
	constructor(@inject(DatabaseService) private dbs: DatabaseService) {}

	private async denyNonStaff(interaction: CommandInteraction | ButtonInteraction): Promise<boolean> {
		if (isBotStaff(interaction.user.id)) return false;
		await interaction.reply({
			content: "Réservé au staff.",
			flags: MessageFlags.Ephemeral,
		});
		return true;
	}

	@Slash({ name: "queue", description: "Candidats en attente de relecture" })
	async queue(interaction: CommandInteraction): Promise<void> {
		if (await this.denyNonStaff(interaction)) return;
		const sqlite = this.dbs.sqlite;
		const rows = listMangaCandidates(sqlite, { status: "unreviewed", limit: 20 });
		const total = countMangaCandidates(sqlite, "unreviewed");
		const embed = new EmbedBuilder()
			.setColor(SHENRON_THEME.gold)
			.setTitle(`Scanlate · ${total} candidat(s) à relire`)
			.setDescription(
				rows.length === 0
					? "Aucun candidat en attente."
					: rows
							.map(
								(row) =>
									`**#${row.id}** · \`${row.pageId}\` · ${extractTranslationPairs(row.payload).length} bulle(s)`
							)
							.join("\n")
			)
			.setFooter({ text: "/scanlate voir <id> pour relire" });
		await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
	}

	@Slash({ name: "voir", description: "Relire un candidat (source, traduction, planche)" })
	async voir(
		@SlashOption({
			name: "id",
			description: "Numéro du candidat",
			type: ApplicationCommandOptionType.Integer,
			required: true,
			minValue: 1,
		})
		id: number,
		interaction: CommandInteraction
	): Promise<void> {
		if (await this.denyNonStaff(interaction)) return;
		const row = getMangaCandidate(this.dbs.sqlite, id);
		if (!row) {
			await interaction.reply({ content: `Candidat #${id} introuvable.`, flags: MessageFlags.Ephemeral });
			return;
		}
		await interaction.reply({
			embeds: [candidateEmbed(row)],
			components: row.status === "unreviewed" ? [reviewButtons(row.id)] : [],
			flags: MessageFlags.Ephemeral,
		});
	}

	@ButtonComponent({ id: /^scanlate:(approve|reject):\d+$/ })
	async review(interaction: ButtonInteraction): Promise<void> {
		if (await this.denyNonStaff(interaction)) return;
		const [, action, rawId] = interaction.customId.split(":");
		const id = Number(rawId);
		const reviewer = `discord:${interaction.user.id}`;
		const sqlite = this.dbs.sqlite;
		let message: string;
		if (action === "approve") {
			const r = approveAndPublishMangaCandidate(sqlite, id, reviewer);
			message = r.ok
				? `Candidat #${id} publié : ${r.translation.pairs.length} bulle(s) pour ${r.translation.pageId}.`
				: r.code === "no_translation"
					? `Candidat #${id} sans texte traduit : rien à publier.`
					: r.code === "not_found"
						? `Candidat #${id} introuvable.`
						: `Candidat #${id} déjà traité.`;
		} else {
			const r = rejectMangaCandidate(sqlite, id, reviewer);
			message = r.ok
				? `Candidat #${id} rejeté.`
				: r.code === "not_found"
					? `Candidat #${id} introuvable.`
					: `Candidat #${id} déjà traité.`;
		}
		const row = getMangaCandidate(sqlite, id);
		await interaction.update({
			content: message,
			embeds: row ? [candidateEmbed(row)] : [],
			components: [],
		});
	}
}
