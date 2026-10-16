/**
 * Mise en forme des données Achillea pour Discord — logique pure, testée séparément.
 *
 * Elle vit hors de la commande parce que c'est là que sont les vraies règles : un
 * embed Discord refuse un champ de plus de 1024 caractères, et un serveur comme
 * Achillea a 102 rôles et 113 salons. Sans découpage, la commande échoue en
 * production sur un serveur peuplé tout en marchant sur un petit — le pire des cas.
 */

import type { RoleAchillea, SalonAchillea } from "../services/achillea";

/** Limite d'un champ d'embed Discord. On garde une marge pour la mention de troncature. */
export const LIMITE_CHAMP = 1024;

/**
 * Types de salons Discord utiles, en français.
 *
 * La liste n'est pas exhaustive à dessein : un type inconnu est rendu « type N »
 * plutôt qu'omis. Discord en ajoute régulièrement, et un salon qui disparaît de
 * l'affichage est un bogue silencieux ; un libellé technique, non.
 */
export const TYPES_SALON: Readonly<Record<number, string>> = Object.freeze({
  0: "textuel",
  2: "vocal",
  4: "catégorie",
  5: "annonces",
  10: "fil d'annonce",
  11: "fil public",
  12: "fil privé",
  13: "conférence",
  14: "annuaire",
  15: "forum",
  16: "média",
});

export function libelleType(type: number): string {
  return TYPES_SALON[type] ?? `type ${type}`;
}

/** Couleur Discord (entier 24 bits) en notation hexadécimale. 0 = aucune couleur. */
export function couleurHex(couleur: number): string {
  return couleur === 0 ? "—" : `#${couleur.toString(16).padStart(6, "0")}`;
}

/**
 * Rôles du plus haut au plus bas, comme Discord les affiche.
 *
 * `@everyone` est retiré : il est présent dans chaque serveur, n'est attribué à
 * personne explicitement, et occuperait une ligne dans un affichage déjà contraint.
 */
export function rolesUtiles(roles: readonly RoleAchillea[]): RoleAchillea[] {
  return roles.filter(role => role.name !== "@everyone").toSorted((a, b) => b.position - a.position);
}

/** Rôles gérés par une intégration (bots, boosts) : utile pour expliquer un total. */
export function compterRolesGeres(roles: readonly RoleAchillea[]): number {
  return roles.filter(role => role.managed === true).length;
}

/** Nombre de salons par type, du plus fréquent au moins fréquent. */
export function repartitionParType(salons: readonly SalonAchillea[]): Array<[string, number]> {
  const compte = new Map<string, number>();
  for (const salon of salons) {
    const cle = libelleType(salon.type);
    compte.set(cle, (compte.get(cle) ?? 0) + 1);
  }
  return [...compte.entries()].toSorted((a, b) => b[1] - a[1]);
}

/**
 * Salons rangés sous leur catégorie, dans l'ordre où Discord les présente.
 *
 * Les salons sans catégorie sont regroupés sous une entrée sans nom : ce sont ceux
 * du haut du serveur, pas des orphelins à cacher.
 */
export function grouperParCategorie(
  salons: readonly SalonAchillea[],
): Array<{ categorie: string | null; salons: SalonAchillea[] }> {
  const categories = new Map<string, string>();
  for (const salon of salons) {
    if (salon.type === 4) categories.set(salon.id, salon.name);
  }

  const groupes = new Map<string | null, SalonAchillea[]>();
  for (const salon of salons) {
    if (salon.type === 4) continue; // la catégorie elle-même n'est pas son propre enfant
    const cle = salon.parent_id ? (categories.get(salon.parent_id) ?? salon.parent_id) : null;
    groupes.set(cle, [...(groupes.get(cle) ?? []), salon]);
  }

  return (
    [...groupes.entries()]
      .map(([categorie, liste]) => ({
        categorie,
        salons: liste.toSorted((a, b) => (a.position ?? 0) - (b.position ?? 0)),
      }))
      // Les salons hors catégorie d'abord, comme dans la barre latérale de Discord.
      .toSorted((a, b) => {
        if (a.categorie === null) return -1;
        if (b.categorie === null) return 1;
        return a.categorie.localeCompare(b.categorie, "fr");
      })
  );
}

/**
 * Assemble des lignes en un bloc qui tient dans un champ d'embed, et dit ce qu'il a
 * dû laisser de côté.
 *
 * Tronquer en silence donnerait un décompte faux à qui lit : « 102 rôles » en titre
 * et cinquante affichés. La dernière ligne annonce donc explicitement le reste.
 */
export function bloquerLignes(lignes: readonly string[], limite = LIMITE_CHAMP): string {
  if (lignes.length === 0) return "—";
  const retenues: string[] = [];
  let taille = 0;
  for (const [index, ligne] of lignes.entries()) {
    const reste = lignes.length - index;
    const mention = `… et ${reste} de plus`;
    // On réserve la place de la mention AVANT d'ajouter la ligne : sinon le bloc
    // dépasse la limite au moment précis où il faut annoncer la troncature.
    if (taille + ligne.length + 1 + mention.length + 1 > limite) {
      retenues.push(mention);
      break;
    }
    retenues.push(ligne);
    taille += ligne.length + 1;
  }
  return retenues.join("\n");
}

/**
 * Date de scan lisible, ou l'aveu qu'aucun scan n'a eu lieu.
 *
 * L'API rend l'horodatage tel que Postgres l'écrit : « 2026-08-14 18:29:55.510814+00 ».
 * Deux écarts avec ISO 8601, et `new Date()` les refuse tous les deux — un espace au
 * lieu du « T », et un décalage horaire à deux chiffres sans minutes. Sans cette
 * normalisation, la fonction rendait la chaîne brute au visiteur au lieu d'une date
 * relative (attrapé par `achillea-format.test.ts` avant la mise en service).
 */
export function dateScan(scanne: string | null): string {
  if (!scanne) return "jamais scanné";
  const normalise = scanne.replace(" ", "T").replace(/([+-]\d{2})$/u, "$1:00");
  const date = new Date(normalise);
  if (Number.isNaN(date.getTime())) return scanne;
  return `<t:${Math.floor(date.getTime() / 1000)}:R>`;
}
