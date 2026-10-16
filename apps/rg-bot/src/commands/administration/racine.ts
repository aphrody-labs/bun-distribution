/**
 * Racine `/administration` — TOUT CE QUI MODIFIE.
 *
 * ── LA RÈGLE, SANS EXCEPTION ───────────────────────────────────────────────
 * Une commande qui écrit — en base, sur un service, dans un salon — vit ici et
 * nulle part ailleurs. Ce qui se consulte vit sous `/staff`, qui ne modifie
 * jamais rien. C'est le pendant exact de `commands/staff/racine.ts`.
 *
 * Cette séparation répare un vrai danger de l'arbre précédent : `/rg-user ban`
 * et `/rg-user info` se tapaient à une lettre près dans la même liste
 * d'autocomplétion. Bannir un membre en cherchant à lire sa fiche était à
 * portée d'une faute de frappe. Désormais il faut avoir tapé `/administration`
 * pour qu'une commande destructrice apparaisse.
 *
 * ── DEUX VERROUS, PAS UN ───────────────────────────────────────────────────
 * 1. Discord : `defaultMemberPermissions = ManageGuild` retire la commande de
 *    la liste des membres ordinaires. C'est du confort d'interface, PAS une
 *    sécurité — un administrateur du serveur Discord n'est pas forcément un
 *    administrateur Rose Griffon, et l'inverse est vrai aussi.
 * 2. Le vrai contrôle reste `requireRgAdmin` / `requireRgAdminStrict`
 *    (`lib/rbac.ts`), qui lit le rôle dans `profiles`. Chaque sous-commande
 *    l'appelle, sans exception : c'est lui qui décide, jamais Discord.
 *
 * ── POURQUOI CE FICHIER EXISTE SÉPARÉMENT ──────────────────────────────────
 * `@aphrody/discordx` exige que la racine d'un sous-groupe soit déclarée sur une
 * classe `@Discord()` avant que `groupSlashes()` ne l'assemble (« A subgroup
 * declared without root » sinon). On la déclare donc ICI, une seule fois, et
 * chaque fichier de groupe importe ce module pour effet de bord : l'ordre des
 * imports dans `src/index.ts` n'a alors plus d'importance.
 */
import { Discord, SlashGroup } from "discordx";
import { PermissionFlagsBits } from "discord.js";

@Discord()
@SlashGroup({
	name: "administration",
	description: "Administration Rose Griffon — écrit vraiment (réservé au staff)",
	defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
})
export class RacineAdministration {}
