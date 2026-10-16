/**
 * `/staff cron` — la partie CONSULTATION de `rg-cron.service`.
 *
 * Reprend les quatre sous-commandes de lecture de `commands/admin/cron.ts`
 * (`taches`, `metriques`, `statut`, `telemetrie`). Le déclenchement d'une tâche
 * et la publication d'une annonce, qui ÉCRIVENT, sont partis sous
 * `/administration cron`. C'est toute la raison d'être de la coupure : lister
 * les tâches et en lancer une ne doivent plus se taper au même endroit.
 *
 * ── LE PONT PEUT NE PAS ÊTRE LÀ ────────────────────────────────────────────
 * La socket `/var/lib/rg/cron.sock` n'existe qu'après un redémarrage du démon
 * avec le pont branché. Tant qu'elle manque, ces commandes le disent avec
 * l'unité à redémarrer — jamais « erreur inconnue ».
 */
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import {
	ApplicationCommandOptionType,
	type AutocompleteInteraction,
	type ChatInputCommandInteraction,
} from "discord.js";

import { appelerCron } from "../../lib/cron-ipc";
import { TACHES_CRON, niveauTache, resoudreTache, suggererTaches } from "../../lib/cron-taches";
import { rgEmbed } from "../../lib/embeds";
import { blocJson, borner, formaterDuree, formaterNombre, horodatageRelatif } from "./format";
import { differerEnPrive, exigerDroits, messagePanne } from "./garde";
import "./racine";
import { echec, piedTexte, repondre } from "../../lib/ui";

interface DerniereExecution {
	time?: string;
	durationMs?: number;
	success?: boolean;
	error?: string;
}

interface MetriquesCron {
	startedAt?: string;
	tasksTriggered?: number;
	tasksSucceeded?: number;
	tasksFailed?: number;
	lastExecution?: Record<string, DerniereExecution>;
}

/** Verdict d'une exécution, en une ligne. */
function formaterExecution(derniere: DerniereExecution | null | undefined): string {
	if (!derniere?.time) {
		return "jamais exécutée depuis le dernier démarrage du démon";
	}
	const duree =
		typeof derniere.durationMs === "number" ? ` en ${formaterDuree(derniere.durationMs)}` : "";
	const verdict = derniere.success ? "succès" : `**échec** — ${borner(derniere.error ?? "?", 200)}`;
	return `${horodatageRelatif(derniere.time)}${duree} · ${verdict}`;
}

/** Symbole du niveau d'accès requis pour DÉCLENCHER la tâche. */
const SYMBOLES_NIVEAU: Record<string, string> = {
	interdit: "⛔",
	"admin-strict": "🔒",
	admin: "•",
};

@Discord()
@SlashGroup({
	name: "cron",
	description: "Consultation du démon de tâches rg-cron",
	root: "staff",
})
@SlashGroup("cron", "staff")
export class StaffCronCommand {
	@Slash({
		name: "taches",
		description: "Catalogue des tâches, leur planification et le niveau requis pour les lancer",
	})
	async taches(interaction: ChatInputCommandInteraction) {
		await differerEnPrive(interaction);
		if (!(await exigerDroits(interaction))) {
			return;
		}
		try {
			const reponse = await appelerCron<{
				success: boolean;
				taches?: string[];
				schedules?: Record<string, string>;
			}>({ cmd: "tasks.list" });
			const planifications = reponse.schedules ?? {};
			const noms = reponse.taches ?? [...TACHES_CRON];
			const lignes = noms
				.map((nom) => {
					const niveau = niveauTache(nom);
					return `${SYMBOLES_NIVEAU[niveau] ?? "•"} \`${nom}\` — ${planifications[nom] ?? "manuel"}`;
				})
				.join("\n");
			await interaction.editReply({
				embeds: [
					rgEmbed()
						.setTitle(`rg-cron — ${noms.length} tâches`)
						.setDescription(borner(lignes, 4_000))
						.setFooter(
							piedTexte({
								note: "⛔ jamais depuis Discord · 🔒 admin uniquement · • admin ou staff — lancement : /administration cron lancer",
							})
						),
				],
			});
		} catch (err) {
			await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
		}
	}

	@Slash({ name: "metriques", description: "Compteurs d'exécution du démon depuis son démarrage" })
	async metriques(interaction: ChatInputCommandInteraction) {
		await differerEnPrive(interaction);
		if (!(await exigerDroits(interaction))) {
			return;
		}
		try {
			const reponse = await appelerCron<{ success: boolean; metrics?: MetriquesCron }>({
				cmd: "metrics",
			});
			const metriques = reponse.metrics ?? {};
			const dernieres = Object.entries(metriques.lastExecution ?? {})
				.toSorted(([, a], [, b]) => String(b.time ?? "").localeCompare(String(a.time ?? "")))
				.slice(0, 10)
				.map(([nom, execution]) => `\`${nom}\` — ${formaterExecution(execution)}`)
				.join("\n");
			await interaction.editReply({
				embeds: [
					rgEmbed()
						.setTitle("rg-cron — métriques")
						.setDescription(
							[
								`Démarré ${horodatageRelatif(metriques.startedAt)}`,
								`Déclenchées : **${formaterNombre(metriques.tasksTriggered ?? 0)}** · ` +
									`réussies : **${formaterNombre(metriques.tasksSucceeded ?? 0)}** · ` +
									`échouées : **${formaterNombre(metriques.tasksFailed ?? 0)}**`,
							].join("\n")
						)
						.addFields({
							name: "Dernières exécutions",
							value: dernieres.length > 0 ? borner(dernieres, 1_000) : "aucune",
						}),
				],
			});
		} catch (err) {
			await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
		}
	}

	@Slash({ name: "statut", description: "Dernière exécution d'une tâche : succès, durée, erreur" })
	async statut(
		@SlashOption({
			name: "tache",
			description: "Nom de la tâche",
			type: ApplicationCommandOptionType.String,
			required: true,
			autocomplete: async (interaction: AutocompleteInteraction) => {
				await interaction.respond(
					suggererTaches(String(interaction.options.getFocused() ?? "")).map((nom) => ({
						name: nom,
						value: nom,
					}))
				);
			},
		})
		tache: string,
		interaction: ChatInputCommandInteraction
	) {
		await differerEnPrive(interaction);
		if (!(await exigerDroits(interaction))) {
			return;
		}
		const nom = resoudreTache(tache);
		if (!nom) {
			await interaction.editReply({
				content: `Tâche « ${borner(tache, 60)} » inconnue. Voir \`/staff cron taches\`.`,
			});
			return;
		}
		try {
			const reponse = await appelerCron<{
				success: boolean;
				derniere?: DerniereExecution | null;
				enCours?: boolean;
			}>({ cmd: "task.status", nom });
			await interaction.editReply({
				embeds: [
					rgEmbed()
						.setTitle(`Tâche \`${nom}\``)
						.setDescription(
							[
								`Niveau requis pour la lancer : **${niveauTache(nom)}**`,
								`En cours : **${reponse.enCours ? "oui" : "non"}**`,
								`Dernière exécution : ${formaterExecution(reponse.derniere)}`,
							].join("\n")
						),
				],
			});
		} catch (err) {
			await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
		}
	}

	@Slash({ name: "telemetrie", description: "Télémétrie Discord tenue par le démon" })
	async telemetrie(interaction: ChatInputCommandInteraction) {
		await differerEnPrive(interaction);
		if (!(await exigerDroits(interaction))) {
			return;
		}
		try {
			const reponse = await appelerCron<{ success: boolean; telemetry?: unknown; error?: string }>({
				cmd: "telemetry.discord",
			});
			if (!reponse.success) {
				await repondre(
					interaction,
					echec(
						"La commande a échoué",
						reponse.error ?? "Télémétrie indisponible : la passerelle du démon n'est pas prête."
					)
				);
				return;
			}
			await interaction.editReply({
				embeds: [
					rgEmbed()
						.setTitle("Télémétrie Discord (rg-cron)")
						.setDescription(blocJson(reponse.telemetry, 3_800)),
				],
			});
		} catch (err) {
			await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
		}
	}
}
