import { container } from "tsyringe";
import type { EmbedBuilder, User } from "discord.js";
import { MessageTemplateService } from "~/services/MessageTemplateService";

// parseDuration + formatDuration wrappent le crate Rust natif (cf. `lib/native.ts`).
// Si tu modifies les unités acceptées, synchronise `native/src/lib.rs`.
import {
	parseDuration as nativeParseDuration,
	formatDuration as nativeFormatDuration,
} from "./native";

export const parseDuration = nativeParseDuration;
export const formatDuration = nativeFormatDuration;

/**
 * DM le membre sanctionné en best-effort. Silence les erreurs (DM fermés,
 * blocked, bot bloqué…) — la sanction reste appliquée même si la notif échoue.
 * Retourne true si le DM est arrivé.
 */
export async function notifyMember(
	target: User,
	embed: EmbedBuilder,
	vars?: Record<string, unknown>
): Promise<boolean> {
	try {
		const templates = container.resolve(MessageTemplateService);
		const r = await templates.render("mod_sanction_dm", vars ?? {});
		if (r && !r.enabled) return false;
		if (r && vars && r.rendered !== r.def.defaultTemplate) {
			embed.addFields({
				name: "Note du serveur",
				value: r.rendered.slice(0, 1024),
			});
		}
		await target.send({ embeds: [embed] });
		return true;
	} catch {
		return false;
	}
}
