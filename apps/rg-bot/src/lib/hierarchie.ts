/**
 * Hiérarchie, permissions et accès — les règles STRICTES d'attribution de rôle.
 *
 * ── LE DANGER QU'ON REFUSE ─────────────────────────────────────────────────
 * Un système de niveaux distribue des rôles TOUT SEUL, sans qu'un humain
 * regarde. C'est exactement le mécanisme qu'il ne faut pas laisser pointer vers
 * un rôle de modération : configurer « niveau 30 → Modérateurs » par
 * distraction, c'est ouvrir le bannissement à quiconque écrit assez de
 * messages. Sur ce serveur, le relevé du 14/8/2026 compte **29 rôles sur 94**
 * porteurs d'au moins une permission dangereuse — la faute est à un clic.
 *
 * Ce module refuse cette configuration à l'écriture ET la refuse encore à
 * l'exécution. Les deux, parce qu'une règle qui ne vit qu'au moment du réglage
 * ne protège pas des lignes déjà en base (import depuis un autre bot, écriture
 * manuelle en SQL), et qu'une règle qui ne vit qu'à l'exécution laisse le staff
 * croire que son réglage a été pris.
 *
 * ── LES QUATRE REFUS ───────────────────────────────────────────────────────
 *  1. `@everyone` — ce n'est pas un rôle qu'on attribue.
 *  2. rôle GÉRÉ par une intégration (bot, Patreon, boost Nitro) : Discord
 *     refuse de l'attribuer, et l'erreur n'arrive qu'au premier membre concerné.
 *  3. rôle à une position SUPÉRIEURE OU ÉGALE au plus haut rôle du bot : la
 *     hiérarchie Discord l'interdit. C'est la panne silencieuse classique — le
 *     réglage est accepté, et rien ne se passe jamais.
 *  4. rôle DANGEREUX (administrateur, gestion du serveur, des rôles, des
 *     salons, bannissement, expulsion, webhooks, mention de tous) : refusé même
 *     si les trois autres passent. Aucune récompense automatique ne distribue
 *     de pouvoir de modération.
 *
 * ── MODULE PUR ─────────────────────────────────────────────────────────────
 * Aucun `discord.js`, aucune E/S : il ne prend que des FAITS (position,
 * bitfield, drapeau `managed`). C'est ce qui permet de le tester exhaustivement,
 * et c'est ce qui compte pour une règle de sécurité.
 */
import { estDangereux, decoderPermissions } from "./discord-roles-catalogue";

/** Ce qu'on sait d'un rôle visé, sans dépendre de `discord.js`. */
export interface FaitsRoleVise {
  id: string;
  nom: string;
  /** Position dans la hiérarchie du serveur. Plus haut = plus fort. */
  position: number;
  /** Bitfield des permissions, en décimal — la forme que rend l'API. */
  permissions: string;
  /** `role.managed` : rôle créé et tenu par une intégration. */
  gereParIntegration: boolean;
  /** Vrai pour `@everyone` (dont l'identifiant est celui de la guilde). */
  estEveryone: boolean;
}

/** Ce qu'on sait du bot dans cette guilde. */
export interface FaitsBot {
  /** Position de SON plus haut rôle. */
  positionMax: number;
  /** A-t-il la permission « Gérer les rôles » au niveau du serveur ? */
  peutGererRoles: boolean;
}

export type Verdict = { ok: true; avertissements: string[] } | { ok: false; motif: string };

/**
 * Ce rôle peut-il être attribué AUTOMATIQUEMENT par le bot ?
 *
 * C'est la seule fonction à appeler avant d'enregistrer une récompense de
 * niveau, et avant de la poser sur un membre.
 */
export function verifierAttributionAutomatique(role: FaitsRoleVise, bot: FaitsBot): Verdict {
  if (!bot.peutGererRoles) {
    return {
      motif: "Le bot n'a pas la permission « Gérer les rôles » sur ce serveur : il ne peut attribuer aucun rôle.",
      ok: false,
    };
  }
  if (role.estEveryone) {
    return {
      motif: "`@everyone` n'est pas un rôle qui s'attribue : tout le monde l'a déjà.",
      ok: false,
    };
  }
  if (role.gereParIntegration) {
    return {
      motif:
        `Le rôle « ${role.nom} » est géré par une intégration (bot, Patreon, boost Nitro). ` +
        "Discord interdit de l'attribuer à la main — le réglage serait accepté et sans effet.",
      ok: false,
    };
  }
  if (role.position >= bot.positionMax) {
    return {
      motif:
        `Le rôle « ${role.nom} » est en position ${role.position}, au niveau ou au-dessus du plus haut rôle du bot (${bot.positionMax}). ` +
        "La hiérarchie Discord l'interdit : la récompense serait enregistrée et ne se poserait jamais. " +
        "Remonte le rôle du bot au-dessus, ou choisis un rôle plus bas.",
      ok: false,
    };
  }
  if (estDangereux(role.permissions)) {
    const nommees = decoderPermissions(role.permissions);
    return {
      motif:
        `Le rôle « ${role.nom} » porte des permissions sensibles (${nommees.slice(0, 4).join(", ")}). ` +
        "Une récompense de niveau s'attribue toute seule, sans qu'un humain regarde : " +
        "ce serait donner de la modération à qui écrit assez de messages. Refusé.",
      ok: false,
    };
  }
  return { avertissements: [], ok: true };
}

/**
 * Ce rôle est-il un rôle de PRISE EN CHARGE crédible ?
 *
 * Ici on n'attribue rien : on désigne qui traite les tickets. Les permissions
 * élevées sont donc normales — mais deux formes restent des erreurs, et elles
 * se voient mal :
 *
 *   - un rôle géré par une intégration (le rôle d'un BOT) : personne ne le
 *     porte à part le bot, donc le ticket n'a aucun destinataire humain ;
 *   - `@everyone` : « tout le monde est staff » veut dire « le fil privé n'est
 *     plus privé », ce qui vide de sens la catégorie Signalement.
 */
export function verifierRolePriseEnCharge(role: FaitsRoleVise): Verdict {
  if (role.estEveryone) {
    return {
      motif:
        "`@everyone` comme rôle de prise en charge rendrait chaque ticket visible de tout le serveur. " +
        "C'est l'inverse de ce qu'un ticket protège.",
      ok: false,
    };
  }
  if (role.gereParIntegration) {
    return {
      motif:
        `« ${role.nom} » est le rôle d'une intégration : aucun humain ne le porte, ` +
        "donc aucun ticket ne trouverait de destinataire.",
      ok: false,
    };
  }
  const avertissements: string[] = [];
  if (!estDangereux(role.permissions)) {
    avertissements.push(
      `« ${role.nom} » ne porte aucune permission de modération : vérifie que c'est bien un rôle de staff.`,
    );
  }
  return { avertissements, ok: true };
}

/**
 * Un membre du staff peut-il agir sur un rôle donné ?
 *
 * Règle de Discord, réécrite ici pour être appliquée AVANT l'appel d'API :
 * personne ne peut toucher un rôle situé au niveau ou au-dessus de son propre
 * plus haut rôle. Le propriétaire du serveur y échappe.
 */
export function peutAgirSurRole(positionMaxDuStaff: number, positionDuRole: number, estProprietaire = false): boolean {
  return estProprietaire || positionDuRole < positionMaxDuStaff;
}

/**
 * Trie une liste de récompenses en « posables » et « bloquées », avec la raison.
 *
 * Utilisé à l'exécution : les lignes déjà en base peuvent avoir été écrites
 * avant cette règle, ou par un import. On ne pose que ce qui est sûr, et on dit
 * ce qu'on n'a pas posé — un rôle silencieusement ignoré est un bogue qu'on
 * cherche pendant des semaines.
 */
export function filtrerRecompenses<T extends { roleId: string }>(
  recompenses: readonly T[],
  faits: ReadonlyMap<string, FaitsRoleVise>,
  bot: FaitsBot,
): { posables: T[]; bloquees: Array<{ recompense: T; motif: string }> } {
  const posables: T[] = [];
  const bloquees: Array<{ recompense: T; motif: string }> = [];
  for (const recompense of recompenses) {
    const role = faits.get(recompense.roleId);
    if (!role) {
      bloquees.push({
        motif: `Le rôle \`${recompense.roleId}\` n'existe plus sur ce serveur.`,
        recompense,
      });
      continue;
    }
    const verdict = verifierAttributionAutomatique(role, bot);
    if (verdict.ok) {
      posables.push(recompense);
    } else {
      bloquees.push({ motif: verdict.motif, recompense });
    }
  }
  return { bloquees, posables };
}
