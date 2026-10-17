/**
 * icones — source UNIQUE de la géométrie des glyphes maison du site.
 *
 * Pourquoi ce module existe : l'interface était habillée par 178 glyphes
 * `lucide-react` distincts, dont la forme (bouts arrondis, angles arrondis,
 * grille molle) est celle de n'importe quel tableau de bord. Ce jeu-ci reprend
 * la façon dont le support est encré, mesurée dans
 * `docs/couverture-analyse-visuelle.md` :
 *
 * 1. **Trait d'épaisseur constante.** Le trait d'encre du support fait 4,0 px
 *    de médiane sur une illustration de 654 px, soit **0,61 % de la largeur du
 *    sujet** ; le document en tire lui-même la transposition qui nous
 *    intéresse : sur une carte de 320 px cela donne 1,95 px, et « le trait n'a
 *    pas à grossir » au-delà. Sur la boîte de 24 unités, l'équivalent visuel de
 *    ce filet de 2 px est `TRAIT_ICONE = 2`. Jamais de trait qui s'affine :
 *    aucune géométrie d'ici n'utilise de variation d'épaisseur.
 * 2. **Angles vifs.** `stroke-linejoin: miter` et `stroke-linecap: butt` — le
 *    trait est coupé net, les coudes sont pointus. C'est la différence de forme
 *    la plus visible avec lucide (`round` / `round`), et elle se lit à 16 px.
 * 3. **Aplat sans dégradé.** Les parties pleines (`aplats`) sont peintes en
 *    `currentColor`, jamais en dégradé : le support ne connaît que l'aplat.
 * 4. **Silhouette coupée.** Les formes fermées sont octogonales ou en amande à
 *    pointes, pas circulaires : la loupe, l'œil et la disquette portent des
 *    coins tranchés plutôt que des rayons.
 *
 * Les coordonnées sont sur une boîte `0 0 24 24`, identique à lucide, pour que
 * le remplacement d'un glyphe soit un simple changement d'import — mêmes
 * dimensions rendues, même inertie optique, mêmes props (`size`, `className`,
 * `strokeWidth`).
 *
 * Rendu : `packages/shenron-ui/src/icones/` (composants React, sous-chemin `@shenron/ui/icones`). Contrôle
 * visuel : `apps/shenron/site/scripts/rend-icones.ts` (SVG → PNG à 16/24/32 px).
 */

/** Côté de la boîte de dessin, en unités SVG. Identique à lucide. */
export const BOITE_ICONE = 24;

/**
 * Épaisseur du trait d'encre, en unités de la boîte. Transposition du
 * `0,61 % de la largeur du sujet` mesuré sur la couverture (cf. en-tête).
 */
export const TRAIT_ICONE = 2;

/** Limite de pointe : au-delà, un coude très aigu serait tronqué en biseau. */
export const POINTE_ICONE = 10;

export type GeometrieIcone = {
  /** Nom lisible, utilisé par le script de contrôle et les tests. */
  readonly titre: string;
  /** Chemins encrés (`fill: none`, trait d'épaisseur constante). */
  readonly traits?: readonly string[];
  /** Chemins en aplat (`fill: currentColor`, aucun trait, aucun dégradé). */
  readonly aplats?: readonly string[];
};

/**
 * Géométrie de chaque glyphe. Clés en français, une entrée = un dessin ; les
 * quatre chevrons partagent la même construction (branche de 7 unités, coude
 * mitré au centre) déclinée sur les quatre orientations plutôt qu'une rotation
 * CSS, pour que chaque chemin reste lisible et mesurable tel quel.
 */
export const GEOMETRIES = {
  /**
   * Arc de 270° coupé net aux deux bouts. Remplace `Loader2` : les appelants
   * continuent de passer `className="animate-spin"`, la rotation n'est pas
   * imposée ici. La goutte d'encre qui marquait la tête a été retirée après
   * contrôle — à 16 px elle se soudait à l'arc et ne lisait plus que comme un
   * empâtement.
   */
  chargement: {
    titre: "Chargement",
    traits: ["M 12 3 A 9 9 0 1 1 3 12"],
  },

  /** Croix d'annulation : deux traits pleine boîte, bouts coupés net. */
  croix: {
    titre: "Fermer",
    traits: ["M 4.5 4.5 L 19.5 19.5", "M 19.5 4.5 L 4.5 19.5"],
  },

  /** Croix d'ajout : deux traits pleine boîte, bouts coupés net. */
  plus: {
    titre: "Ajouter",
    traits: ["M 12 3.5 L 12 20.5", "M 3.5 12 L 20.5 12"],
  },

  /** Coche à coude mitré : la pointe est franche, pas arrondie. */
  coche: {
    titre: "Valider",
    traits: ["M 3.5 12.5 L 9.5 18.5 L 20.5 5.5"],
  },

  /**
   * Corbeille à cuve tronconique : les flancs fuient vers le fond, le
   * couvercle et l'anse sont rectilignes. Deux fentes seulement — trois
   * deviennent une bouillie à 16 px (mesuré au rendu PNG).
   */
  corbeille: {
    titre: "Supprimer",
    traits: [
      "M 3 6 L 21 6",
      "M 9.5 6 L 9.5 3.5 L 14.5 3.5 L 14.5 6",
      "M 5.5 6 L 6.9 21 L 17.1 21 L 18.5 6",
      "M 9.8 10 L 9.8 17.5",
      "M 14.2 10 L 14.2 17.5",
    ],
  },

  /**
   * Disquette à coin coupé : le coin supérieur droit est biseauté (silhouette
   * tranchée) et l'obturateur est un aplat. L'étiquette du bas a été RETIRÉE
   * après contrôle : à 16 px ses deux montants venaient toucher le cadre et la
   * silhouette s'empâtait en rectangle noir.
   */
  enregistrer: {
    titre: "Enregistrer",
    traits: ["M 3.5 3.5 L 16.5 3.5 L 20.5 7.5 L 20.5 20.5 L 3.5 20.5 Z"],
    aplats: ["M 7.5 3.5 L 15.5 3.5 L 15.5 9.5 L 7.5 9.5 Z"],
  },

  /**
   * Triangle d'alerte à trois pointes vives (lucide arrondit les siennes) ;
   * la barre est un trait, le point un losange en aplat.
   */
  alerte: {
    titre: "Alerte",
    traits: ["M 12 2.5 L 22 20.5 L 2 20.5 Z", "M 12 8.5 L 12 13.6"],
    aplats: ["M 12 16.2 L 13.6 17.8 L 12 19.4 L 10.4 17.8 Z"],
  },

  /**
   * Lien externe : cadre ouvert sur son coin supérieur droit + hampe et
   * pointe en aplat. La pointe pleine est la signature d'encrage — deux
   * traits en chevron feraient une flèche de barre d'outils.
   */
  lienExterne: {
    titre: "Ouvrir dans un nouvel onglet",
    traits: ["M 19.5 13 L 19.5 20.5 L 3.5 20.5 L 3.5 4.5 L 11 4.5", "M 12 12 L 18.5 5.5"],
    aplats: ["M 21.5 2.5 L 21.5 10 L 14 2.5 Z"],
  },

  /**
   * Loupe à monture octogonale : les coins de la lentille sont tranchés, la
   * poignée part à 45° et se termine coupée net.
   */
  recherche: {
    titre: "Rechercher",
    traits: [
      "M 6.2 3.6 L 13.8 3.6 L 16.4 6.2 L 16.4 13.8 L 13.8 16.4 L 6.2 16.4 L 3.6 13.8 L 3.6 6.2 Z",
      "M 15.6 15.6 L 20.8 20.8",
    ],
  },

  /**
   * Chevrons : branche de 7 unités, coude mitré. Quatre orientations, même
   * construction — c'est le glyphe le plus répandu de l'interface, donc celui
   * où l'angle vif se remarque le plus.
   */
  chevronBas: { titre: "Dérouler", traits: ["M 4.5 8.5 L 12 16 L 19.5 8.5"] },
  chevronHaut: { titre: "Replier", traits: ["M 4.5 15.5 L 12 8 L 19.5 15.5"] },
  chevronDroite: { titre: "Suivant", traits: ["M 8.5 4.5 L 16 12 L 8.5 19.5"] },
  chevronGauche: {
    titre: "Précédent",
    traits: ["M 15.5 4.5 L 8 12 L 15.5 19.5"],
  },

  /**
   * Livre ouvert : deux pages en trapèze, dos vertical au centre. Tous les
   * coins sont des sommets, aucun arrondi.
   */
  livre: {
    titre: "Lire",
    traits: ["M 12 7.5 L 2.5 4.5 L 2.5 18.5 L 12 21.5 L 21.5 18.5 L 21.5 4.5 Z", "M 12 7.5 L 12 21.5"],
  },

  /**
   * Œil en amande à pointes : les deux courbes se rejoignent en angle, comme
   * un œil de planche, et la pupille est un aplat. Pas d'ellipse.
   */
  oeil: {
    titre: "Afficher",
    traits: ["M 2 12 C 6.5 4.4 17.5 4.4 22 12 C 17.5 19.6 6.5 19.6 2 12 Z"],
    aplats: ["M 12 9.2 A 2.8 2.8 0 1 1 11.99 9.2 Z"],
  },

  /**
   * Éclat de ki : quatre pointes concaves, la forme la plus reconnaissable du
   * support. Un seul aplat, aucune bordure — il doit rester net à 16 px.
   */
  etincelle: {
    titre: "Mise en avant",
    aplats: [
      "M 10.5 3.5 L 12.4 11.1 L 20 13 L 12.4 14.9 L 10.5 22.5 L 8.6 14.9 L 1 13 L 8.6 11.1 Z",
      "M 19 1 L 20.1 3.9 L 23 5 L 20.1 6.1 L 19 9 L 17.9 6.1 L 15 5 L 17.9 3.9 Z",
    ],
  },

  /* ------------------------------------------------------------------ *
   * Lot 2 — les glyphes suivants par fréquence. Mêmes règles : boîte de
   * 24, trait de 2, bouts coupés (`butt`), coudes pointus (`miter`),
   * aplats en `currentColor`. Trois familles de construction reviennent :
   *  - la **pointe pleine** (aplat triangulaire) pour toute flèche, déjà
   *    posée par `lienExterne` au lot 1 ;
   *  - le **bezel octogonal** de 3,5 à 20,5 avec chanfrein de 5, décliné
   *    par `cocheCercle`, `alerteCercle`, `info`, `horloge` et `reglages`
   *    — c'est la version pleine taille de la lentille de la loupe ;
   *  - le **losange** de 3,2 unités en aplat pour tout point (pupille,
   *    point d'exclamation, pastille de peinture), déjà posé par `alerte`.
   * ------------------------------------------------------------------ */

  /** Flèche à hampe coupée et pointe pleine. Remplace `ArrowLeft`. */
  flecheGauche: {
    titre: "Retour",
    traits: ["M 9.5 12 L 21.5 12"],
    aplats: ["M 2.5 12 L 10.5 6 L 10.5 18 Z"],
  },

  /** Symétrique de `flecheGauche`. Remplace `ArrowRight`. */
  flecheDroite: {
    titre: "Suivant",
    traits: ["M 2.5 12 L 14.5 12"],
    aplats: ["M 21.5 12 L 13.5 6 L 13.5 18 Z"],
  },

  /** Remplace `ArrowUp` (tri croissant, remonter). */
  flecheHaut: {
    titre: "Monter",
    traits: ["M 12 9.5 L 12 21.5"],
    aplats: ["M 12 2.5 L 18 10.5 L 6 10.5 Z"],
  },

  /** Remplace `ArrowDown` (tri décroissant, descendre). */
  flecheBas: {
    titre: "Descendre",
    traits: ["M 12 2.5 L 12 14.5"],
    aplats: ["M 12 21.5 L 6 13.5 L 18 13.5 Z"],
  },

  /**
   * Flèche oblique montante. Reprend exactement la pointe de `lienExterne`
   * pour que « sortir » se lise pareil partout. Remplace `ArrowUpRight`.
   */
  flecheCoin: {
    titre: "Aller à",
    traits: ["M 5 19 L 15.5 8.5"],
    aplats: ["M 21.5 2.5 L 21.5 10 L 14 2.5 Z"],
  },

  /**
   * Deux arcs de 120° tournant dans le sens horaire, chacun scellé par une
   * pointe pleine tangente. Remplace `RefreshCw`. Les arcs sont volontairement
   * courts : un anneau presque fermé se lit comme un `Loader2` à 16 px.
   */
  rafraichir: {
    titre: "Rafraîchir",
    traits: ["M 4.6 13.3 A 7.5 7.5 0 0 1 14.6 5", "M 19.4 10.7 A 7.5 7.5 0 0 1 9.4 19"],
    aplats: ["M 18.5 6.4 L 13.1 7.3 L 15 2.2 Z", "M 5.5 17.6 L 10.9 16.7 L 9 21.8 Z"],
  },

  /**
   * Arc de 305° ouvert en haut, pointe pleine tournée vers la gauche : le
   * sens antihoraire est celui du retour en arrière. Remplace `RotateCcw`.
   */
  reinitialiser: {
    titre: "Réinitialiser",
    traits: ["M 12.6 3.62 A 8.4 8.4 0 1 1 5.1 7.2"],
    aplats: ["M 6.3 4.2 L 13.2 0.9 L 13.2 7.5 Z"],
  },

  /**
   * Le même arc antihoraire, avec les deux aiguilles au centre : c'est le
   * temps qu'on remonte. Remplace `History`.
   */
  historique: {
    titre: "Historique",
    traits: ["M 12.6 3.62 A 8.4 8.4 0 1 1 5.1 7.2", "M 12 7.6 L 12 12.4 L 15.8 14.6"],
    aplats: ["M 6.3 4.2 L 13.2 0.9 L 13.2 7.5 Z"],
  },

  /** Bezel octogonal plein cadre et deux aiguilles. Remplace `Clock`. */
  horloge: {
    titre: "Horaire",
    traits: [
      "M 8.5 3.5 L 15.5 3.5 L 20.5 8.5 L 20.5 15.5 L 15.5 20.5 L 8.5 20.5 L 3.5 15.5 L 3.5 8.5 Z",
      "M 12 7 L 12 12.4 L 16 14.6",
    ],
  },

  /**
   * Coche inscrite dans le bezel octogonal. Remplace `CheckCircle2`,
   * `CheckCircle` et `BadgeCheck` — trois façons lucide de dire « validé ».
   */
  cocheCercle: {
    titre: "Validé",
    traits: [
      "M 8.5 3.5 L 15.5 3.5 L 20.5 8.5 L 20.5 15.5 L 15.5 20.5 L 8.5 20.5 L 3.5 15.5 L 3.5 8.5 Z",
      "M 7.6 12.2 L 10.7 15.3 L 16.6 8.8",
    ],
  },

  /** Même bezel, barre et losange : l'avertissement rond. Remplace `AlertCircle`. */
  alerteCercle: {
    titre: "Attention",
    traits: [
      "M 8.5 3.5 L 15.5 3.5 L 20.5 8.5 L 20.5 15.5 L 15.5 20.5 L 8.5 20.5 L 3.5 15.5 L 3.5 8.5 Z",
      "M 12 7 L 12 12.6",
    ],
    aplats: ["M 12 14.9 L 13.6 16.5 L 12 18.1 L 10.4 16.5 Z"],
  },

  /** Le losange passe en haut, la barre en bas : le « i ». Remplace `Info`. */
  info: {
    titre: "Information",
    traits: [
      "M 8.5 3.5 L 15.5 3.5 L 20.5 8.5 L 20.5 15.5 L 15.5 20.5 L 8.5 20.5 L 3.5 15.5 L 3.5 8.5 Z",
      "M 12 11.4 L 12 17",
    ],
    aplats: ["M 12 6 L 13.6 7.6 L 12 9.2 L 10.4 7.6 Z"],
  },

  /**
   * Cadenas à anse brisée (deux pans obliques plutôt qu'un demi-cercle) et
   * serrure en losange. Remplace `Lock`.
   */
  cadenas: {
    titre: "Verrouillé",
    traits: [
      "M 4.5 10.5 L 19.5 10.5 L 19.5 20.5 L 4.5 20.5 Z",
      "M 8 10.5 L 8 6.8 L 9.8 4.5 L 14.2 4.5 L 16 6.8 L 16 10.5",
    ],
    aplats: ["M 12 13.4 L 13.9 15.3 L 12 17.2 L 10.1 15.3 Z"],
  },

  /** Écu hexagonal à pointe basse, aucun galbe. Remplace `Shield`. */
  bouclier: {
    titre: "Protection",
    traits: ["M 12 2.5 L 20.5 5.5 L 20.5 12 L 12 21.5 L 3.5 12 L 3.5 5.5 Z"],
  },

  /** Le même écu, coche à l'intérieur. Remplace `ShieldCheck`. */
  bouclierCoche: {
    titre: "Vérifié",
    traits: ["M 12 2.5 L 20.5 5.5 L 20.5 12 L 12 21.5 L 3.5 12 L 3.5 5.5 Z", "M 8 10.8 L 11 13.8 L 16 8.2"],
  },

  /**
   * Crayon taillé : fût à quatre pans le long de la diagonale, mine en aplat.
   * Remplace `Pencil`, `PenLine` et `Edit` — trois glyphes lucide pour le même
   * geste, un seul dessin ici.
   */
  crayon: {
    titre: "Modifier",
    traits: ["M 4.5 19.5 L 5.7 15 L 17.9 2.9 L 21.1 6.1 L 9 18.3 Z"],
    aplats: ["M 4.5 19.5 L 5.7 15 L 9 18.3 Z"],
  },

  /** Feuille à coin replié (le pli est un aplat) et deux lignes. Remplace `FileText`. */
  document: {
    titre: "Document",
    traits: ["M 4 2.5 L 14 2.5 L 20 8.5 L 20 21.5 L 4 21.5 Z", "M 7.5 12.5 L 16.5 12.5", "M 7.5 16.5 L 16.5 16.5"],
    aplats: ["M 14 2.5 L 20 8.5 L 14 8.5 Z"],
  },

  /** Porte-bloc : pince en aplat, deux lignes seulement. Remplace `ClipboardList`. */
  presse: {
    titre: "Journal",
    traits: [
      "M 8 4.5 L 4.5 4.5 L 4.5 21.5 L 19.5 21.5 L 19.5 4.5 L 16 4.5",
      "M 8.5 12 L 15.5 12",
      "M 8.5 17 L 15.5 17",
    ],
    aplats: ["M 8 2 L 16 2 L 16 7 L 8 7 Z"],
  },

  /** Deux cadres décalés, angles vifs. Remplace `Copy`. */
  copie: {
    titre: "Copier",
    traits: ["M 8 8 L 20.5 8 L 20.5 20.5 L 8 20.5 Z", "M 16.5 8 L 16.5 3.5 L 3.5 3.5 L 3.5 16.5 L 8 16.5"],
  },

  /** Quatre équerres de visée et deux lignes de texte. Remplace `ScanText`. */
  scan: {
    titre: "Transcrire",
    traits: [
      "M 3 8 L 3 3 L 8 3",
      "M 16 3 L 21 3 L 21 8",
      "M 21 16 L 21 21 L 16 21",
      "M 8 21 L 3 21 L 3 16",
      "M 7 9.5 L 17 9.5",
      "M 7 14.5 L 17 14.5",
    ],
  },

  /**
   * Feuille + lentille octogonale. La lentille était pleine au premier essai :
   * à 16 px elle formait une tache d'encre au milieu du document. Au trait,
   * elle se lit. Remplace `FileSearch`.
   */
  loupeDoc: {
    titre: "Chercher dans les documents",
    traits: [
      "M 4.5 2.5 L 13 2.5 L 19.5 9 L 19.5 21.5 L 4.5 21.5 Z",
      "M 9.1 9.2 L 12.9 9.2 L 15 11.3 L 15 14.9 L 12.9 17 L 9.1 17 L 7 14.9 L 7 11.3 Z",
      "M 14.6 16.6 L 18.5 20.5",
    ],
    aplats: ["M 13 2.5 L 19.5 9 L 13 9 Z"],
  },

  /** Trois losanges empilés vus de trois quarts. Remplace `Layers`. */
  couches: {
    titre: "Couches",
    traits: ["M 12 2.5 L 21.5 8 L 12 13.5 L 2.5 8 Z", "M 2.5 12 L 12 17.5 L 21.5 12", "M 2.5 16 L 12 21.5 L 21.5 16"],
  },

  /**
   * Baguette en diagonale et deux éclats à quatre pointes. Le petit éclat a été
   * ÉPAISSI après contrôle : à 16 px ses bras d'origine (0,8 unité) tombaient
   * sous le pixel et ne rendaient plus que trois points isolés.
   * Remplace `Wand2`.
   */
  baguette: {
    titre: "Assistance",
    traits: ["M 2.5 21.5 L 14 10"],
    aplats: [
      "M 18.5 1.5 L 19.7 4.3 L 22.5 5.5 L 19.7 6.7 L 18.5 9.5 L 17.3 6.7 L 14.5 5.5 L 17.3 4.3 Z",
      "M 6.5 2 L 7.8 4.2 L 10 5.5 L 7.8 6.8 L 6.5 9 L 5.2 6.8 L 3 5.5 L 5.2 4.2 Z",
    ],
  },

  /** Triangle plein, sans le moindre congé. Remplace `Play`. */
  lecture: {
    titre: "Lire",
    aplats: ["M 6 3.5 L 20.5 12 L 6 20.5 Z"],
  },

  /** Clap : ardoise pleine en biais sur un corps rectangulaire. Remplace `Film`. */
  film: {
    titre: "Film",
    traits: ["M 2.5 9.5 L 21.5 9.5 L 21.5 20.5 L 2.5 20.5 Z"],
    aplats: ["M 2.6 4.2 L 21.2 6.9 L 20.7 10.4 L 2.1 7.7 Z"],
  },

  /** Écran et deux antennes en V. Remplace `Tv` et `Tv2`. */
  tv: {
    titre: "Diffusion",
    traits: ["M 2.5 6.5 L 21.5 6.5 L 21.5 19.5 L 2.5 19.5 Z", "M 7 2.5 L 12 6.5", "M 17 2.5 L 12 6.5"],
  },

  /** Cadre, ligne d'horizon brisée, soleil en losange. Remplace `ImageIcon` et `Image`. */
  image: {
    titre: "Image",
    traits: ["M 3 4.5 L 21 4.5 L 21 19.5 L 3 19.5 Z", "M 3 16 L 9 9 L 13.5 14 L 16.5 11.5 L 21 16"],
    aplats: ["M 16.5 7 L 17.9 8.4 L 16.5 9.8 L 15.1 8.4 Z"],
  },

  /** Le même cadre, barré. Le paysage disparaît : à 16 px, barre et relief se confondent. */
  imageBarree: {
    titre: "Image absente",
    traits: ["M 3 4.5 L 21 4.5 L 21 19.5 L 3 19.5 Z", "M 3.5 20.5 L 20.5 3.5"],
  },

  /** Capsule octogonale, berceau en arc, pied droit. Remplace `Mic`. */
  micro: {
    titre: "Micro",
    traits: [
      "M 9 6.5 L 11 4.5 L 13 4.5 L 15 6.5 L 15 11 L 13 13 L 11 13 L 9 11 Z",
      "M 5 11 A 7 7 0 0 0 19 11",
      "M 12 18 L 12 21.5",
    ],
  },

  /**
   * Livre FERMÉ, dos à gauche, signet en aplat. Premier essai : quatre dos de
   * livres sur une tablette — à 16 px cela ne se distinguait plus d'un
   * code-barres. Le livre fermé se lit, et reste franchement différent du
   * `livre` ouvert du lot 1, avec lequel il cohabite dans trois fichiers.
   * Remplace `Library` et `BookMarked`.
   */
  bibliotheque: {
    titre: "Collection",
    traits: ["M 4.5 3 L 19.5 3 L 19.5 21 L 4.5 21 Z", "M 8.5 3 L 8.5 21"],
    aplats: ["M 12.5 3 L 17.5 3 L 17.5 13 L 15 10.4 L 12.5 13 Z"],
  },

  /** Bulle rectangulaire à queue triangulaire. Remplace `MessageSquare`. */
  bulle: {
    titre: "Message",
    traits: ["M 3 4.5 L 21 4.5 L 21 16.5 L 10.5 16.5 L 5 21 L 6.5 16.5 L 3 16.5 Z"],
  },

  /** Deux bustes : têtes en aplat (seules lisibles à 16 px), épaules au trait. Remplace `Users`. */
  groupe: {
    titre: "Membres",
    traits: [
      "M 2.6 20.5 L 2.6 17.3 L 5.9 13.7 L 13.3 13.7 L 16.6 17.3 L 16.6 20.5",
      "M 16.8 13.7 L 19.3 13.7 L 21.6 17.3 L 21.6 20.5",
    ],
    aplats: ["M 9.6 4 A 3.2 3.2 0 1 1 9.59 4 Z", "M 17.9 4.2 A 2.4 2.4 0 1 1 17.89 4.2 Z"],
  },

  /** Cœur à sept sommets, aucun arc. Remplace `Heart`. */
  coeur: {
    titre: "Favori",
    aplats: ["M 12 21.2 L 2.8 11.4 L 2.8 7.6 L 6.6 3.8 L 12 7.6 L 17.4 3.8 L 21.2 7.6 L 21.2 11.4 Z"],
  },

  /** Étoile à cinq branches, pleine. Remplace `Star`. */
  etoile: {
    titre: "Note",
    aplats: [
      "M 12 3.1 L 14.29 9.45 L 21.04 9.66 L 15.71 13.81 L 17.58 20.29 L 12 16.5 L 6.42 20.29 L 8.29 13.81 L 2.96 9.66 L 9.71 9.45 Z",
    ],
  },

  /** Coupe et socle en aplat, anses au trait. Remplace `Trophy`. */
  trophee: {
    titre: "Classement",
    traits: ["M 6.5 5 L 3 5 L 3 8 L 6.4 10.5", "M 17.5 5 L 21 5 L 21 8 L 17.6 10.5", "M 12 12.5 L 12 17"],
    aplats: [
      "M 6.5 3.5 L 17.5 3.5 L 17.5 8.5 L 14.5 12.5 L 9.5 12.5 L 6.5 8.5 Z",
      "M 8 17 L 16 17 L 17.5 20.5 L 6.5 20.5 Z",
    ],
  },

  /** Médaille octogonale pleine sur ruban croisé. Remplace `Award` et `Medal`. */
  recompense: {
    titre: "Récompense",
    traits: ["M 9.5 13.2 L 7 21.5 L 12 18.8 L 17 21.5 L 14.5 13.2"],
    aplats: ["M 9.6 2.5 L 14.4 2.5 L 17.5 5.6 L 17.5 10.4 L 14.4 13.5 L 9.6 13.5 L 6.5 10.4 L 6.5 5.6 Z"],
  },

  /** Couronne à trois pointes, pleine. Remplace `Crown`. */
  couronne: {
    titre: "Rang",
    aplats: ["M 2.5 6 L 7.2 11.5 L 12 3.5 L 16.8 11.5 L 21.5 6 L 19.8 19.5 L 4.2 19.5 Z"],
  },

  /**
   * Pièces de Zénis (monnaie officielle de l'univers Dragon Ball).
   * Jeton octogonal gravé du « Z » canonique au premier plan, second jeton en retrait.
   * Remplace `Coins`.
   */
  piece: {
    titre: "Zenis",
    traits: [
      "M 7.8 9.4 L 12.2 9.4 L 15 12.2 L 15 16.6 L 12.2 19.4 L 7.8 19.4 L 5 16.6 L 5 12.2 Z",
      "M 10 9.6 L 10 6.2 L 12.8 3.4 L 17.2 3.4 L 20 6.2 L 20 10.6 L 17.2 13.4 L 14.9 13.4",
      "M 8.2 13 L 11.8 13 L 8.2 16 L 11.8 16",
    ],
  },

  /** Sac à anse trapézoïdale. Remplace `ShoppingBag` et `ShoppingCart`. */
  sac: {
    titre: "Boutique",
    traits: ["M 3.5 7.5 L 20.5 7.5 L 20.5 20.5 L 3.5 20.5 Z", "M 8.5 11 L 8.5 6 L 12 2.5 L 15.5 6 L 15.5 11"],
  },

  /** Boîte, ruban vertical, nœud en deux ailes pleines. Remplace `Gift`. */
  cadeau: {
    titre: "Cadeau",
    traits: [
      "M 3 9.5 L 21 9.5 L 21 13.5 L 3 13.5 Z",
      "M 4.5 13.5 L 4.5 20.5 L 19.5 20.5 L 19.5 13.5",
      "M 12 9.5 L 12 20.5",
    ],
    aplats: ["M 12 9.4 L 5.5 9.4 L 6.6 5 L 12 7.6 Z", "M 12 9.4 L 18.5 9.4 L 17.4 5 L 12 7.6 Z"],
  },

  /** Hampe au trait, oriflamme à échancrure en aplat. Remplace `Flag`. */
  drapeau: {
    titre: "Signaler",
    traits: ["M 4.5 2.5 L 4.5 21.5"],
    aplats: ["M 6 3.5 L 20.5 3.5 L 17.5 8 L 20.5 12.5 L 6 12.5 Z"],
  },

  /** Flamme à pans coupés, avec l'échancrure gauche qui la distingue d'une goutte. Remplace `Flame`. */
  flamme: {
    titre: "Série en cours",
    aplats: ["M 12.5 1.5 L 19 12 L 19 16.5 L 14.5 21.5 L 9 21.5 L 5 16.5 L 5.5 11.5 L 9.5 15.5 L 8.5 7.5 Z"],
  },

  /** Éclair plein à six sommets. Remplace `Zap`. */
  eclair: {
    titre: "Éclair",
    aplats: ["M 13.5 1.5 L 4 13.5 L 11 13.5 L 10.5 22.5 L 20 10.5 L 13 10.5 Z"],
  },

  /** Chevron d'invite et curseur, sans cadre : c'est ce qui reste lisible à 16 px. Remplace `Terminal`. */
  terminal: {
    titre: "Console",
    traits: ["M 3.5 5.5 L 11.5 12 L 3.5 18.5", "M 12.5 18.5 L 20.5 18.5"],
  },

  /** Barre verticale et anneau ouvert. Remplace `Power`. */
  alimentation: {
    titre: "Allumer",
    traits: ["M 12 2.5 L 12 11.5", "M 6.5 6.5 A 8 8 0 1 0 17.5 6.5"],
  },

  /** Le même anneau, barré : l'arrêt. Remplace `PowerOff`. */
  alimentationCoupee: {
    titre: "Éteindre",
    traits: ["M 12 2.5 L 12 9", "M 6.5 6.5 A 8 8 0 1 0 17.5 6.5", "M 4.5 19.5 L 19.5 4.5"],
  },

  /** Cylindre à facettes : trois losanges et deux flancs droits. Remplace `Database`. */
  base: {
    titre: "Base de données",
    traits: [
      "M 3.5 6 L 12 3 L 20.5 6 L 12 9 Z",
      "M 3.5 6 L 3.5 18 L 12 21 L 20.5 18 L 20.5 6",
      "M 3.5 12 L 12 15 L 20.5 12",
    ],
  },

  /** Palette à pans coupés, échancrure du pouce, trois godets en losange. Remplace `Palette`. */
  palette: {
    titre: "Apparence",
    traits: [
      "M 12 2.5 L 19 5.5 L 21.5 12 L 18.5 16.5 L 14.5 16.5 L 13 19 L 14 21.5 L 9 21.5 L 4 18 L 2.5 11 L 6 4.5 Z",
    ],
    aplats: [
      "M 8 6.6 L 9.4 8 L 8 9.4 L 6.6 8 Z",
      "M 13.8 6.2 L 15.2 7.6 L 13.8 9 L 12.4 7.6 Z",
      "M 6.6 13.4 L 8 14.8 L 6.6 16.2 L 5.2 14.8 Z",
    ],
  },

  /** Trois rails et trois molettes rectangulaires pleines. Remplace `SlidersHorizontal`. */
  curseurs: {
    titre: "Réglages fins",
    traits: ["M 2.5 6.5 L 21.5 6.5", "M 2.5 12 L 21.5 12", "M 2.5 17.5 L 21.5 17.5"],
    aplats: [
      "M 7.5 3.5 L 11 3.5 L 11 9.5 L 7.5 9.5 Z",
      "M 13.5 9 L 17 9 L 17 15 L 13.5 15 Z",
      "M 5.5 14.5 L 9 14.5 L 9 20.5 L 5.5 20.5 Z",
    ],
  },

  /**
   * Roue à six dents plates, percée. Premier essai : un écrou octogonal percé
   * — au contrôle il se lisait comme une CIBLE (deux cercles concentriques),
   * pas comme un réglage. Le moyeu est ici une sous-boucle enroulée en sens
   * INVERSE de la denture : le remplissage non nul y creuse un trou franc,
   * sans avoir à poser `fill-rule`. Remplace `Settings`.
   */
  reglages: {
    titre: "Réglages",
    aplats: [
      "M 21.7 14.42 L 21.7 9.58 L 18.3 9.45 L 17.36 7.81 L 18.95 4.81 L 14.76 2.39 L 12.95 5.27 " +
        "L 11.05 5.27 L 9.24 2.39 L 5.05 4.81 L 6.64 7.81 L 5.7 9.45 L 2.3 9.58 L 2.3 14.42 L 5.7 14.55 " +
        "L 6.64 16.19 L 5.05 19.19 L 9.24 21.61 L 11.05 18.73 L 12.95 18.73 L 14.76 21.61 L 18.95 19.19 " +
        "L 17.36 16.19 L 18.3 14.55 Z M 12 8.4 A 3.6 3.6 0 1 1 11.99 8.4 Z",
    ],
  },

  /** Deux maillons à pans coupés reliés par une barre. Remplace `Link2`. */
  lien: {
    titre: "Lien",
    traits: [
      "M 9.5 6.5 L 5.5 6.5 L 2.5 9.5 L 2.5 14.5 L 5.5 17.5 L 9.5 17.5",
      "M 14.5 6.5 L 18.5 6.5 L 21.5 9.5 L 21.5 14.5 L 18.5 17.5 L 14.5 17.5",
      "M 8 12 L 16 12",
    ],
  },

  /** Dard de papier : deux triangles pleins pliés sur la même arête. Remplace `Send`. */
  envoyer: {
    titre: "Envoyer",
    aplats: ["M 21.5 2.5 L 2 10.2 L 9.6 13.2 Z", "M 21.5 2.5 L 9.6 13.2 L 12.6 21 Z"],
  },

  /** Hampe, pointe pleine, plateau ouvert. Remplace `Download`. */
  telecharger: {
    titre: "Télécharger",
    traits: ["M 12 2 L 12 8.5", "M 3.5 17.5 L 3.5 21 L 20.5 21 L 20.5 17.5"],
    aplats: ["M 12 15.5 L 6.5 8 L 17.5 8 Z"],
  },

  /** L'amande du lot 1, barrée ; la pupille saute, la barre la remplace. Remplace `EyeOff`. */
  oeilBarre: {
    titre: "Masquer",
    traits: ["M 2 12 C 6.5 4.4 17.5 4.4 22 12 C 17.5 19.6 6.5 19.6 2 12 Z", "M 3.5 20.5 L 20.5 3.5"],
  },

  /** Croisillon à montants penchés. Remplace `Hash`. */
  diese: {
    titre: "Salon",
    traits: ["M 8.5 3 L 6.5 21", "M 17.5 3 L 15.5 21", "M 3.5 8.5 L 20.5 8.5", "M 3 15.5 L 20 15.5"],
  },

  /** Ligne brisée montante terminée par la pointe pleine. Remplace `TrendingUp`. */
  tendance: {
    titre: "Tendance",
    traits: ["M 2.5 18 L 9 11.5 L 13 15.5 L 19.5 9"],
    aplats: ["M 21.5 4.5 L 21.5 11.5 L 14.5 4.5 Z"],
  },

  /** Tracé de pouls : deux paliers, un pic. Remplace `Activity`. */
  activite: {
    titre: "Activité",
    traits: ["M 2.5 12 L 7.5 12 L 10 5 L 14 19 L 16.5 12 L 21.5 12"],
  },

  /**
   * Maison : pignon à deux pentes et corps rectangulaire, pour la première
   * destination de la barre de navigation mobile. Le faîte est un coude MITRÉ
   * comme le reste du jeu — c'est ce qui la distingue du toit arrondi de
   * `Home` chez lucide, et ça se voit à 24 px.
   *
   * Le pignon déborde du corps de 1,5 unité de chaque côté (avant-toit) : sans
   * ce débord, le triangle se pose sur le rectangle et les deux se lisent
   * comme une seule forme fermée.
   */
  maison: {
    titre: "Accueil",
    traits: ["M 2 11.5 L 12 3 L 22 11.5", "M 4.5 9.6 L 4.5 20.5 L 19.5 20.5 L 19.5 9.6"],
  },

  /**
   * Maison PLEINE — l'état actif de la barre de navigation. Material 3 fait
   * porter l'état sélectionné par un glyphe rempli, le repos par un glyphe au
   * trait ; la silhouette est identique à `maison`, elle est seulement encrée.
   */
  maisonPleine: {
    titre: "Accueil",
    aplats: ["M 12 2.6 L 1.4 11.6 L 3 13.5 L 4 12.65 L 4 21.5 L 20 21.5 L 20 12.65 L 21 13.5 L 22.6 11.6 Z"],
  },

  /**
   * Trois points en ligne : le « plus d'options » des barres natives. Les
   * points sont des LOSANGES, la construction du jeu pour tout point — un
   * cercle se lirait comme une bulle, et le losange garde ses quatre arêtes
   * quand le disque devient une tache.
   *
   * **Diagonale portée de 3,2 à 5,2 unités au contrôle.** À 3,2, chaque point
   * mesurait 3,2/24 × 16 = 2,1 px sur la planche à 16 px, et le rendu ne
   * laissait qu'un pixel gris par point : trois grains, pas trois points. À
   * 5,2 il en reste 3,5 px, soit un losange plein cerné d'un pixel de
   * transition — le glyphe se lit.
   */
  ellipse: {
    titre: "Plus d'options",
    aplats: [
      "M 4.8 9.4 L 7.4 12 L 4.8 14.6 L 2.2 12 Z",
      "M 12 9.4 L 14.6 12 L 12 14.6 L 9.4 12 Z",
      "M 19.2 9.4 L 21.8 12 L 19.2 14.6 L 16.6 12 Z",
    ],
  },

  /* ==========================================================================
	   Canon Dragon Ball — Official Vector Geometries (Toriyama Style)
	   Precision measured 24x24 viewBox, constant stroke = 2, sharp miters.
	   ========================================================================== */

  /**
   * Dragon Ball (Su Shinchū / Four-Star Dragon Ball).
   * Iconic crystal sphere housing the four sharp Toriyama stars in diamond arrangement.
   */
  dragonBall: {
    titre: "Dragon Ball",
    traits: ["M 12 2.5 A 9.5 9.5 0 1 1 11.99 2.5 Z"],
    aplats: [
      // Top star (cx=12, cy=7.2)
      "M 12 5.6 L 12.45 6.75 L 13.7 6.8 L 12.7 7.55 L 13.05 8.75 L 12 8.05 L 10.95 8.75 L 11.3 7.55 L 10.3 6.8 L 11.55 6.75 Z",
      // Bottom star (cx=12, cy=16.8)
      "M 12 15.25 L 12.45 16.45 L 13.7 16.5 L 12.7 17.25 L 13.05 18.45 L 12 17.75 L 10.95 18.45 L 11.3 17.25 L 10.3 16.5 L 11.55 16.45 Z",
      // Left star (cx=7.2, cy=12)
      "M 7.2 10.45 L 7.65 11.65 L 8.9 11.7 L 7.9 12.45 L 8.25 13.65 L 7.2 12.95 L 6.15 13.65 L 6.5 12.45 L 5.5 11.7 L 6.75 11.65 Z",
      // Right star (cx=16.8, cy=12)
      "M 16.8 10.45 L 17.25 11.65 L 18.5 11.7 L 17.5 12.45 L 17.85 13.65 L 16.8 12.95 L 15.75 13.65 L 16.1 12.45 L 15.1 11.7 L 16.35 11.65 Z",
    ],
  },

  /**
   * Dragon Radar (Radar Dragon).
   * Bulma's iconic locator with top push button, concentric scan ring, crosshair grid, and blinking target blips.
   */
  dragonRadar: {
    titre: "Dragon Radar",
    traits: [
      "M 10 1.5 L 14 1.5 L 14 4 L 10 4 Z",
      "M 7.5 4 L 16.5 4",
      "M 12 4.5 A 8.5 8.5 0 1 1 11.99 4.5 Z",
      "M 5.5 13 L 18.5 13",
      "M 12 6.5 L 12 19.5",
      "M 12 9.5 A 3.5 3.5 0 1 1 11.99 9.5 Z",
    ],
    aplats: ["M 14.5 9.5 L 17.5 11 L 15 12.5 Z", "M 8 15.5 L 9.5 14 L 9.5 17 Z"],
  },

  /**
   * Capsule Corporation (Capsule Corp).
   * The definitive double concentric "C" emblem designed by Akira Toriyama.
   */
  capsuleCorp: {
    titre: "Capsule Corp",
    traits: ["M 16.5 6 A 7.5 7.5 0 1 0 16.5 18", "M 14 9 A 4 4 0 1 0 14 15"],
    aplats: [
      "M 15 5 L 17.5 5 L 17.5 7.5 L 15 7.5 Z",
      "M 15 16.5 L 17.5 16.5 L 17.5 19 L 15 19 Z",
      "M 13 8.5 L 15 8.5 L 15 10 L 13 10 Z",
      "M 13 14 L 15 14 L 15 15.5 L 13 15.5 Z",
    ],
  },

  /**
   * Kame Crest (Tortue / 龜).
   * Master Roshi's Turtle School kanji crest emblazoned on Goku and Krillin's dōgi.
   */
  kame: {
    titre: "Kame",
    traits: [
      "M 12 2.5 A 9.5 9.5 0 1 1 11.99 2.5 Z",
      "M 7.5 6.5 L 16.5 6.5",
      "M 10 6.5 L 7.5 9",
      "M 7.5 9.5 L 16.5 9.5 L 16.5 15.5 L 7.5 15.5 Z",
      "M 7.5 12.5 L 16.5 12.5",
      "M 12 9.5 L 12 15.5",
      "M 8 18 L 10 18",
      "M 14 18 L 16 18",
      "M 12 15.5 L 12 18",
    ],
  },

  /**
   * Scouter (Détecteur de puissance / Scouter).
   * Saiyan and Frieza Force targeting eyewear with ear unit, bracket arm, and digital reticle.
   */
  scouter: {
    titre: "Scouter",
    traits: [
      "M 17 8 L 22 8 L 22 16 L 17 16 Z",
      "M 19.5 10.5 L 19.5 13.5",
      "M 17 9 L 13.5 9 L 13.5 6 L 4.5 6 L 3.5 15.5 L 13 16.5 L 13.5 14",
      "M 6 8 L 12 8",
    ],
    aplats: ["M 7.5 10.5 L 10.5 10.5 L 10.5 13.5 L 7.5 13.5 Z"],
  },

  /**
   * Kinto-un (Nuage Magique / Flying Nimbus).
   * Pure Toriyama cloud geometry with bulging lobes, trailing tail, and inward spiral volute.
   */
  kintoUn: {
    titre: "Kinto-un",
    traits: [
      "M 5 15 C 2.5 14 2.5 10 5 8.5 C 5.5 5.5 9.5 4.5 12.5 5.5 C 15.5 4.5 19 6 20 8.5 C 22.5 10.5 22.5 14 20 15.5 C 18 16.5 15.5 16 14 15.5 L 20 19 L 13 17.5 C 10 18.5 6.5 17.5 5 15 Z",
      "M 10 11.5 C 10 9.5 12 9.5 12.5 11 C 13 12.5 11.5 13.5 10 12.5",
    ],
  },

  /**
   * Senzu Bean (仙豆 / Haricot Magique).
   * Korin Tower's miraculous healing bean with kidney curvature and central germ line.
   */
  senzu: {
    titre: "Senzu",
    traits: [
      "M 7 5.5 C 11 3.5 16.5 5 17.5 8.5 C 18.5 12 15.5 14.5 14 15.5 C 13 16.5 13.5 18.5 12 19.5 C 9.5 21 6 19.5 5.5 15.5 C 5 11.5 5 8 7 5.5 Z",
      "M 10.5 9 C 11.5 11.5 10 14 11.5 16",
    ],
  },

  /**
   * Potara Earrings (Boucle Potara).
   * Supreme Kai fusion artifact featuring ear hoop, clasp bead, and hanging glowing orb.
   */
  potara: {
    titre: "Potara",
    traits: ["M 12 2.5 A 3.5 3.5 0 0 1 12 9.5 L 12 11", "M 12 13.5 A 4.5 4.5 0 1 1 11.99 13.5 Z"],
    aplats: ["M 10.5 10.5 L 13.5 10.5 L 13.5 12.5 L 10.5 12.5 Z", "M 10 14 A 1.2 1.2 0 1 1 9.99 14 Z"],
  },

  /**
   * Z-Sword (Épée Z).
   * Legendary blade of the Kaioshin Realm with tapered double-edge blade, heavy crossguard, and pommel.
   */
  zSword: {
    titre: "Épée Z",
    traits: [
      "M 12 1.5 L 15 5.5 L 14 14.5 L 10 14.5 L 9 5.5 Z",
      "M 12 4.5 L 12 13.5",
      "M 6.5 14.5 L 17.5 14.5 L 16.5 16.5 L 7.5 16.5 Z",
      "M 11 16.5 L 11 20.5 L 13 20.5 L 13 16.5",
      "M 10 20.5 L 14 20.5 L 14 22.5 L 10 22.5 Z",
    ],
  },

  /**
   * Majin Emblem (Marque Majin "M").
   * The sinister cursive "M" branded upon Babidi's thralls and Majin Vegeta.
   */
  majin: {
    titre: "Majin",
    aplats: ["M 3 6 L 6 6 L 8.5 13 L 12 8 L 15.5 13 L 18 6 L 21 6 L 18 18 L 15 18 L 12 13 L 9 18 L 6 18 Z"],
  },

  /**
   * Shenron Dragon Crest (神龍 / Shenron).
   * Divine Dragon crest with twin branched antlers, sharp draconic muzzle, and whiskers.
   */
  shenron: {
    titre: "Shenron",
    traits: [
      "M 4 8 L 6 3 L 8 6 L 10 2 L 11 7",
      "M 20 8 L 18 3 L 16 6 L 14 2 L 13 7",
      "M 7 11 L 12 7 L 17 11 L 16 18 L 12 21 L 8 18 Z",
      "M 4 15 C 5 19 8 18 8 18",
      "M 20 15 C 19 19 16 18 16 18",
    ],
    aplats: ["M 9.5 12.5 L 11 13 L 9.5 14 Z", "M 14.5 12.5 L 13 13 L 14.5 14 Z"],
  },

  /**
   * Red Ribbon Army Crest (Armée du Ruban Rouge / RR).
   * Geometric dual "R" emblem of Commander Red and Dr. Gero's android army.
   */
  rubanRouge: {
    titre: "Ruban Rouge",
    traits: [
      "M 3 5.5 L 21 5.5 L 21 18.5 L 3 18.5 Z",
      "M 6.5 8.5 L 10 8.5 A 2 2 0 0 1 10 12.5 L 6.5 12.5 L 6.5 15.5",
      "M 9 12.5 L 11 15.5",
      "M 13.5 8.5 L 17 8.5 A 2 2 0 0 1 17 12.5 L 13.5 12.5 L 13.5 15.5",
      "M 16 12.5 L 18 15.5",
    ],
  },
  /**
   * Manga & Guides (Planche de Manga & Cases Toriyama).
   * Planche de bande dessinée japonaise avec cases dynamiques au trait net,
   * distinguant immédiatement le manga original et les guides des simples livres.
   */
  manga: {
    titre: "Manga & Guides",
    traits: ["M 3 3.5 L 21 3.5 L 21 20.5 L 3 20.5 Z", "M 3 11 L 21 11", "M 13 11 L 11 20.5", "M 6.5 7.25 L 12 7.25"],
  },
} as const satisfies Record<string, GeometrieIcone>;

export type NomIcone = keyof typeof GEOMETRIES;

/** Liste stable des noms, pour le script de contrôle et les tests. */
export const NOMS_ICONES = Object.keys(GEOMETRIES) as NomIcone[];

/**
 * Rend une géométrie en document SVG autonome. Sert au contrôle visuel
 * (rasterisation par `sharp`) et à tout usage hors React ; les composants React
 * n'en dépendent pas — ils lisent `GEOMETRIES` directement.
 */
export function svgIcone(
  nom: NomIcone,
  { taille = 24, couleur = "#131B08", trait = TRAIT_ICONE }: { taille?: number; couleur?: string; trait?: number } = {},
): string {
  const g: GeometrieIcone = GEOMETRIES[nom];
  const traits = (g.traits ?? [])
    .map(d => `<path d="${d}" fill="none" stroke="${couleur}" stroke-width="${trait}" />`)
    .join("");
  const aplats = (g.aplats ?? []).map(d => `<path d="${d}" fill="${couleur}" stroke="none" />`).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${taille}" height="${taille}" viewBox="0 0 ${BOITE_ICONE} ${BOITE_ICONE}" ` +
    `stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="${POINTE_ICONE}">${traits}${aplats}</svg>`
  );
}
