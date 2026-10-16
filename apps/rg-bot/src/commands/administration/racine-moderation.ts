/**
 * Racine `/moderation` — les pouvoirs Discord du bot (bannir, rôles, salons).
 *
 * Séparée de `/administration` pour une raison MESURÉE, pas esthétique : Discord
 * plafonne une commande — nom, descriptions et choix de tout son arbre — à
 * 8 000 caractères, et le refuse d'un bloc avec `APPLICATION_COMMAND_TOO_LARGE`
 * (code 50035). Les treize groupes réunis sous `/administration` dépassaient ce
 * plafond : AUCUNE commande du bot ne s'enregistrait, pas seulement celles en
 * trop. Le découpage en trois racines (`/administration`, `/gestion`,
 * `/moderation`) est ce qui rend l'arbre publiable.
 *
 * La frontière reste celle de tout le bot : ici on MODIFIE le serveur Discord ;
 * ce qui se consulte vit sous `/staff`. Chaque sous-commande garde sa garde
 * `requireRgAdmin` / `requireRgAdminStrict` — la racine ne protège rien.
 */
import { Discord, SlashGroup } from "discordx";
import { PermissionFlagsBits } from "discord.js";

@Discord()
@SlashGroup({
  name: "moderation",
  description: "Modération Discord — bannir, expulser, rôles, salons (réservé au staff)",
  defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
})
export class RacineModeration {}
