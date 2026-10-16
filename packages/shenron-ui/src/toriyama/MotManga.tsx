/**
 * MotManga — les lettres du wordmark de couverture, à leur hauteur MESURÉE.
 *
 * Le logo des tankōbon n'est pas une ligne de capitales de même corps : sa
 * hauteur de capitale décroît fortement de gauche à droite dans « DRAGON »,
 * touche son point bas sur la boule, puis remonte dans « BALL ». C'est une
 * VALLÉE centrée sur la boule, et c'est ce qui fait lire le logo plutôt qu'un
 * mot en gras.
 *
 * Relevé sur `db_manga_volumes/124.jpg` — ligne de base commune à y = 219-223,
 * SOMMET de l'aplat de chaque lettre (minimum du profil de haut, colonne par
 * colonne, dans le masque de couleur du mot) :
 *
 * | Lettre | Colonnes | Sommet | Capitale | / capitale du D |
 * |---|---|---|---|---|
 * | D | x 28-96  | y 67 | 156 px | 1,000 |
 * | R | x 100-152 | y 84 | 139 px | 0,891 |
 * | A | x 156-196 | y 105 | 118 px | 0,756 |
 * | G | x 200-267 | y 117 | 106 px | 0,679 |
 * | O (la boule) | x 249-338 | — | Ø 89 px | 0,571 |
 * | N | x 324-380 | y 119 | 100 px | 0,641 |
 * | B | x 390-446 | y 118 | 100 px | 0,641 |
 * | A | x 454-486 | y 114 | 104 px | 0,667 |
 * | L | x 494-518 | y 107 | 111 px | 0,712 |
 * | L | x 534-566 | y  95 | 123 px | 0,788 |
 *
 * **Deux relevés corrigés, et comment.** Les lettres de « DRAGON » se touchent :
 * leurs aplats jaunes forment un seul run de x 26 à x 267, il n'y a aucune
 * gouttière blanche où couper. D'où deux erreurs successives :
 *
 * 1. échantillonner la hauteur une colonne sur douze — une colonne tombant sur
 *    la barre basse du A rendait la hauteur de la BARRE ;
 * 2. couper le run en quatre parts égales — le G, large, y perdait la moitié de
 *    sa largeur au profit du A.
 *
 * Ce qui tranche, c'est le **haut du CERNE NOIR** relevé colonne par colonne :
 * il enveloppe chaque lettre et fait un saut net à chaque frontière (98 → 76 à
 * x 100, 116 → 105 à x 156). Les bornes du tableau en sortent, et le sommet se
 * lit alors sans ambiguïté à l'intérieur de chacune.
 *
 * La descente est plus franche qu'il n'y paraissait — 1,00 → 0,68 sur quatre
 * lettres — mais régulière : −11 %, −15 %, −10 % de lettre à lettre.
 *
 * Chaque lettre porte son propre `data-texte` : les deux cernes du wordmark
 * sont des COPIES du glyphe tracées dessous (cf. `globals.css`, section
 * « Wordmark de couverture »), et une copie par mot ne saurait pas se
 * redimensionner lettre à lettre.
 */

/** [glyphe, échelle de capitale relative au D]. */
export type LettreMesuree = readonly [string, number];

export const LETTRES_DRAGON_AVANT_BOULE: readonly LettreMesuree[] = [
  ["D", 1],
  ["R", 0.891],
  ["A", 0.756],
  ["G", 0.679],
];
export const LETTRES_DRAGON_APRES_BOULE: readonly LettreMesuree[] = [
  ["N", 0.641],
];
export const LETTRES_BALL: readonly LettreMesuree[] = [
  ["B", 0.641],
  ["A", 0.667],
  ["L", 0.712],
  ["L", 0.788],
];

export function MotManga({ lettres }: { lettres: readonly LettreMesuree[] }) {
  return (
    <>
      {lettres.map(([glyphe, echelle], i) => (
        <span
          // Les lettres d'un wordmark figé ne se réordonnent jamais : l'index
          // est ici une clé stable.
          key={`${glyphe}-${i}`}
          className="wordmark-lettre"
          data-texte={glyphe}
          style={{ ["--e" as string]: echelle }}
        >
          {glyphe}
        </span>
      ))}
    </>
  );
}
