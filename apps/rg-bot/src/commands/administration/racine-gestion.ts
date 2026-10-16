/**
 * Racine `/gestion` — le contenu éditorial : articles, événements, planning de
 * streams.
 *
 * Détachée de `/administration` pour la même raison mesurée que
 * `/moderation` (cf. `racine-moderation.ts`) : le plafond de 8 000 caractères
 * par commande, dépassé quand les treize groupes tenaient sous une seule
 * racine, faisait échouer l'enregistrement de TOUT l'arbre.
 *
 * Ces trois groupes ÉCRIVENT en base (`articles`, `events`,
 * `stream_schedules`) ; leur pendant en lecture est public (`/article`,
 * `/agenda`).
 */
import { Discord, SlashGroup } from "discordx";
import { PermissionFlagsBits } from "discord.js";

@Discord()
@SlashGroup({
	name: "gestion",
	description: "Contenu Rose Griffon — articles, événements, planning (réservé au staff)",
	defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
})
export class RacineGestion {}
