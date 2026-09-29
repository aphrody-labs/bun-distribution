import { injectable, inject } from "tsyringe";
import { AttachmentBuilder } from "discord.js";
import { Bot, Discord, On, type ArgsOf } from "discordx";
import { LogService } from "~/services/LogService";
import { logger } from "~/lib/logger";

// Limite de ré-upload Discord (serveur non boosté = 10 Mio). On garde une marge.
const REUPLOAD_MAX_BYTES = 8 * 1024 * 1024;

@Discord()
@Bot("shenron")
@injectable()
export class MessageLogEvent {
	constructor(@inject(LogService) private logs: LogService) {}

	@On({ event: "messageDelete" })
	async onDelete([message]: ArgsOf<"messageDelete">) {
		if (!message.guild || message.author?.bot) return;
		const embed = this.logs.makeEmbed("Message supprimé", 0xef4444).addFields(
			{
				name: "Auteur",
				value: message.author ? `${message.author} (${message.author.id})` : "Inconnu",
				inline: true,
			},
			{ name: "Salon", value: `<#${message.channelId}>`, inline: true },
			{
				name: "Contenu",
				value: message.content ? message.content.slice(0, 1024) : "*(vide ou non caché)*",
			}
		);

		// L'URL CDN d'un message supprimé expire vite → on rapatrie les bytes et on
		// les ré-uploade dans le salon de logs pour que l'image/vidéo persiste.
		const files: AttachmentBuilder[] = [];
		const tooLarge: string[] = [];
		for (const att of message.attachments.values()) {
			if (att.size > REUPLOAD_MAX_BYTES) {
				tooLarge.push(
					`[${att.name ?? "fichier"}](${att.url}) (${(att.size / 1024 / 1024).toFixed(1)} Mo)`
				);
				continue;
			}
			try {
				const res = await fetch(att.url);
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const buf = Buffer.from(await res.arrayBuffer());
				files.push(new AttachmentBuilder(buf, { name: att.name ?? "attachment" }));
			} catch (err) {
				logger.warn({ err, url: att.url }, "Failed to re-upload deleted attachment");
				tooLarge.push(`[${att.name ?? "fichier"}](${att.url}) (récupération échouée)`);
			}
		}
		if (tooLarge.length) {
			embed.addFields({
				name: "Pièces jointes non rapatriées",
				value: tooLarge.join("\n").slice(0, 1024),
			});
		}

		await this.logs.send(message.client, "message", embed, files);
	}

	@On({ event: "messageUpdate" })
	async onUpdate([oldM, newM]: ArgsOf<"messageUpdate">) {
		if (!newM.guild || newM.author?.bot || oldM.content === newM.content) return;
		const embed = this.logs.makeEmbed("Message modifié", 0xfbbf24).addFields(
			{
				name: "Auteur",
				value: newM.author ? `${newM.author} (${newM.author.id})` : "Inconnu",
				inline: true,
			},
			{ name: "Salon", value: `<#${newM.channelId}>`, inline: true },
			{ name: "Avant", value: (oldM.content || "*(vide)*").slice(0, 1024) },
			{ name: "Après", value: (newM.content || "*(vide)*").slice(0, 1024) }
		);
		await this.logs.send(newM.client, "message", embed);
	}
}
