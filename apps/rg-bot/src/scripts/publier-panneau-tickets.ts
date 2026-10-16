/**
 * Publie le panneau d'ouverture de tickets dans le VRAI salon, et corrige
 * `salonPanneau` en base.
 *
 * ── POURQUOI CE SCRIPT, ET PAS `/gestion ticket panneau` ───────────────────
 * La commande existe et reste la voie normale pour republier le panneau plus
 * tard. Ce script ponctuel corrige un réglage posé sur le mauvais salon lors
 * de la mise en place — `#📩〡demandes-tickets` (catégorie Support) au lieu du
 * vrai salon `#📧〡tickets` — sans attendre qu'un admin retape la commande en
 * Discord. Il réutilise `construirePanneau()` telle quelle : l'embed et les
 * boutons envoyés sont identiques à ceux de la commande, pas une copie.
 *
 * `bun apps/bot/src/scripts/publier-panneau-tickets.ts`
 */
import { RG_GUILD_ID } from "@rosegriffon/types/discord";

import { construirePanneau } from "../commands/ticket";
import { sql } from "../lib/db";
import { fusionnerReglages } from "../lib/reglages-communaute";
import { enregistrerReglages, reglagesDe } from "../services/communaute";

const GUILD_ID = RG_GUILD_ID;
const SALON_REEL = "1097192985524981841"; // #📧〡tickets, donné par le staff le 14/8/2026.

const token = (Bun.env.DISCORD_BOT_TOKEN ?? "").trim();
if (token === "") {
	console.error("DISCORD_BOT_TOKEN manquant.");
	process.exit(1);
}

const actuels = await reglagesDe(GUILD_ID);
console.log(`salonPanneau actuel : ${actuels.tickets.salonPanneau}`);

const modifies = fusionnerReglages(actuels, { tickets: { salonPanneau: SALON_REEL } });
await enregistrerReglages(GUILD_ID, modifies);
console.log(`salonPanneau corrigé → ${SALON_REEL}`);

const panneau = construirePanneau();
const corps = {
	components: panneau.components.map((rangee) => rangee.toJSON()),
	embeds: panneau.embeds.map((embed) => embed.toJSON()),
};

const reponse = await fetch(`https://discord.com/api/v10/channels/${SALON_REEL}/messages`, {
	body: JSON.stringify(corps),
	headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
	method: "POST",
});

if (!reponse.ok) {
	console.error(`Publication refusée (HTTP ${reponse.status}) : ${await reponse.text()}`);
	process.exit(1);
}

const message = (await reponse.json()) as { id: string; channel_id: string };
console.log(
	`Panneau publié : https://discord.com/channels/${GUILD_ID}/${message.channel_id}/${message.id}`
);

await sql.close();
process.exit(0);
