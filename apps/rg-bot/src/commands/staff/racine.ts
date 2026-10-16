/**
 * Racine `/staff` — TOUT CE QUI SE CONSULTE.
 *
 * ── LA RÈGLE, SANS EXCEPTION ───────────────────────────────────────────────
 * `/staff` ne modifie RIEN. Pas une ligne en base, pas un fichier, pas un
 * service. Ce qui modifie vit sous `/administration`, et nulle part ailleurs.
 *
 * Cette séparation n'est pas cosmétique. Avant elle, `/rg-user ban` et
 * `/rg-user info` se tapaient à une lettre près dans la même liste
 * d'autocomplétion : bannir quelqu'un par erreur de frappe était à portée de
 * doigt. Désormais, une commande dangereuse ne peut plus être atteinte en
 * cherchant une commande anodine — il faut avoir tapé `/administration`.
 *
 * ── POURQUOI CE FICHIER EXISTE SÉPARÉMENT ──────────────────────────────────
 * Dans `@aphrody/discordx`, un sous-groupe (`@SlashGroup({ …, root: "staff" })`)
 * exige que la racine `staff` ait été déclarée quelque part, sur une classe
 * `@Discord()` : `groupSlashes()` lève « A subgroup declared without root »
 * sinon. La racine est donc déclarée ICI, une seule fois, et chaque fichier de
 * groupe importe ce module pour effet de bord. Résultat : peu importe l'ordre
 * des imports dans `src/index.ts`, et peu importe qu'un groupe soit branché
 * avant un autre — la racine est toujours là.
 *
 * Déclarer la racine dans chaque fichier « marcherait » aussi (la carte de
 * groupes est indexée par nom, le dernier écrasant les précédents), mais ferait
 * dépendre la description affichée par Discord de l'ordre des imports. On
 * préfère un endroit unique.
 */
import { Discord, SlashGroup } from "discordx";

@Discord()
@SlashGroup({
  name: "staff",
  description: "Consultation de l'exploitation Rose Griffon (staff) — ne modifie jamais rien",
})
export class RacineStaff {}
