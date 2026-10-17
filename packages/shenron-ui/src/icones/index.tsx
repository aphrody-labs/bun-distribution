/**
 * icones — jeu de glyphes maison, dessiné pour ce site.
 *
 * Chaque composant est un `Glyphe` figé sur une géométrie de `./geometries`
 * (source unique). Ils remplacent, un pour un, les glyphes `lucide-react` les
 * plus employés de l'interface — même boîte de 24, mêmes props (`size`,
 * `className`, `strokeWidth`, `color`, `absoluteStrokeWidth`), donc un
 * remplacement se réduit à changer la ligne d'import et le nom.
 *
 * Correspondance avec ce qu'ils remplacent, et fréquence mesurée (nombre de
 * fichiers de `apps/shenron/site/src` qui importaient le glyphe lucide) :
 *
 * | maison           | lucide          | fichiers |
 * |------------------|-----------------|---------:|
 * | `Chargement`     | `Loader2`       | 35 |
 * | `Croix`          | `X`             | 28 |
 * | `Corbeille`      | `Trash2`        | 23 |
 * | `Plus`           | `Plus`          | 22 |
 * | `Enregistrer`    | `Save`          | 21 |
 * | `Alerte`         | `AlertTriangle` | 17 |
 * | `LienExterne`    | `ExternalLink`  | 17 |
 * | `Recherche`      | `Search`        | 17 |
 * | `ChevronBas`     | `ChevronDown`   | 16 |
 * | `Livre`          | `BookOpen`      | 15 |
 * | `Oeil`           | `Eye`           | 14 |
 * | `Coche`          | `Check`         | 12 |
 * | `ChevronDroite`  | `ChevronRight`  | 11 |
 * | `ChevronGauche`  | `ChevronLeft`   |  8 |
 * | `Etincelle`      | `Sparkles`      |  9 |
 * | `ChevronHaut`    | `ChevronUp`     |  6 |
 *
 * `Chargement` n'impose pas la rotation : comme avec `Loader2`, l'appelant
 * passe `className="animate-spin"`.
 */

import { Glyphe, type ProprietesIcone } from "./glyphe";

export {
  BOITE_ICONE,
  GEOMETRIES,
  NOMS_ICONES,
  POINTE_ICONE,
  TRAIT_ICONE,
  svgIcone,
  type GeometrieIcone,
  type NomIcone,
} from "./geometries";

export { Glyphe } from "./glyphe";
export type { ProprietesIcone } from "./glyphe";

export const Chargement = (p: ProprietesIcone) => <Glyphe nom="chargement" {...p} />;
export const Croix = (p: ProprietesIcone) => <Glyphe nom="croix" {...p} />;
export const Corbeille = (p: ProprietesIcone) => <Glyphe nom="corbeille" {...p} />;
export const Plus = (p: ProprietesIcone) => <Glyphe nom="plus" {...p} />;
export const Enregistrer = (p: ProprietesIcone) => <Glyphe nom="enregistrer" {...p} />;
export const Alerte = (p: ProprietesIcone) => <Glyphe nom="alerte" {...p} />;
export const LienExterne = (p: ProprietesIcone) => <Glyphe nom="lienExterne" {...p} />;
export const Recherche = (p: ProprietesIcone) => <Glyphe nom="recherche" {...p} />;
export const ChevronBas = (p: ProprietesIcone) => <Glyphe nom="chevronBas" {...p} />;
export const ChevronHaut = (p: ProprietesIcone) => <Glyphe nom="chevronHaut" {...p} />;
export const ChevronDroite = (p: ProprietesIcone) => <Glyphe nom="chevronDroite" {...p} />;
export const ChevronGauche = (p: ProprietesIcone) => <Glyphe nom="chevronGauche" {...p} />;
export const Livre = (p: ProprietesIcone) => <Glyphe nom="livre" {...p} />;
export const Oeil = (p: ProprietesIcone) => <Glyphe nom="oeil" {...p} />;
export const Coche = (p: ProprietesIcone) => <Glyphe nom="coche" {...p} />;
export const Etincelle = (p: ProprietesIcone) => <Glyphe nom="etincelle" {...p} />;

/**
 * Lot 2 — les 57 glyphes suivants par fréquence mesurée dans `apps/shenron/site/src`.
 * Même contrat : `Glyphe` + une entrée de `GEOMETRIES`, API lucide.
 *
 * Plusieurs glyphes lucide tombent sur un seul dessin quand ils disent la même
 * chose : `Pencil`/`PenLine`/`Edit` → `Crayon`, `CheckCircle2`/`CheckCircle`/
 * `BadgeCheck` → `CocheCercle`, `Award`/`Medal` → `Recompense`,
 * `Library`/`BookMarked` → `Bibliotheque`, `Tv`/`Tv2` → `Tv`.
 *
 * `Image` de lucide devient `Illustration` : le nom `Image` est déjà pris par
 * `next/image` dans plusieurs de ces fichiers, et un import qui masque l'autre
 * est un piège silencieux.
 */
export const FlecheGauche = (p: ProprietesIcone) => <Glyphe nom="flecheGauche" {...p} />;
export const FlecheDroite = (p: ProprietesIcone) => <Glyphe nom="flecheDroite" {...p} />;
export const FlecheHaut = (p: ProprietesIcone) => <Glyphe nom="flecheHaut" {...p} />;
export const FlecheBas = (p: ProprietesIcone) => <Glyphe nom="flecheBas" {...p} />;
export const FlecheCoin = (p: ProprietesIcone) => <Glyphe nom="flecheCoin" {...p} />;
export const Rafraichir = (p: ProprietesIcone) => <Glyphe nom="rafraichir" {...p} />;
export const Reinitialiser = (p: ProprietesIcone) => <Glyphe nom="reinitialiser" {...p} />;
export const Historique = (p: ProprietesIcone) => <Glyphe nom="historique" {...p} />;
export const Horloge = (p: ProprietesIcone) => <Glyphe nom="horloge" {...p} />;
export const CocheCercle = (p: ProprietesIcone) => <Glyphe nom="cocheCercle" {...p} />;
export const AlerteCercle = (p: ProprietesIcone) => <Glyphe nom="alerteCercle" {...p} />;
export const Info = (p: ProprietesIcone) => <Glyphe nom="info" {...p} />;
export const Cadenas = (p: ProprietesIcone) => <Glyphe nom="cadenas" {...p} />;
export const Bouclier = (p: ProprietesIcone) => <Glyphe nom="bouclier" {...p} />;
export const BouclierCoche = (p: ProprietesIcone) => <Glyphe nom="bouclierCoche" {...p} />;
export const Crayon = (p: ProprietesIcone) => <Glyphe nom="crayon" {...p} />;
export const Document = (p: ProprietesIcone) => <Glyphe nom="document" {...p} />;
export const Presse = (p: ProprietesIcone) => <Glyphe nom="presse" {...p} />;
export const Copie = (p: ProprietesIcone) => <Glyphe nom="copie" {...p} />;
export const Scan = (p: ProprietesIcone) => <Glyphe nom="scan" {...p} />;
export const LoupeDoc = (p: ProprietesIcone) => <Glyphe nom="loupeDoc" {...p} />;
export const Couches = (p: ProprietesIcone) => <Glyphe nom="couches" {...p} />;
export const Baguette = (p: ProprietesIcone) => <Glyphe nom="baguette" {...p} />;
export const Lecture = (p: ProprietesIcone) => <Glyphe nom="lecture" {...p} />;
export const Film = (p: ProprietesIcone) => <Glyphe nom="film" {...p} />;
export const Tv = (p: ProprietesIcone) => <Glyphe nom="tv" {...p} />;
export const Illustration = (p: ProprietesIcone) => <Glyphe nom="image" {...p} />;
export const IllustrationAbsente = (p: ProprietesIcone) => <Glyphe nom="imageBarree" {...p} />;
export const Micro = (p: ProprietesIcone) => <Glyphe nom="micro" {...p} />;
export const Bibliotheque = (p: ProprietesIcone) => <Glyphe nom="bibliotheque" {...p} />;
export const Bulle = (p: ProprietesIcone) => <Glyphe nom="bulle" {...p} />;
export const Groupe = (p: ProprietesIcone) => <Glyphe nom="groupe" {...p} />;
export const Coeur = (p: ProprietesIcone) => <Glyphe nom="coeur" {...p} />;
export const Etoile = (p: ProprietesIcone) => <Glyphe nom="etoile" {...p} />;
export const Trophee = (p: ProprietesIcone) => <Glyphe nom="trophee" {...p} />;
export const Recompense = (p: ProprietesIcone) => <Glyphe nom="recompense" {...p} />;
export const Couronne = (p: ProprietesIcone) => <Glyphe nom="couronne" {...p} />;
export const Piece = (p: ProprietesIcone) => <Glyphe nom="piece" {...p} />;
export const Sac = (p: ProprietesIcone) => <Glyphe nom="sac" {...p} />;
export const Cadeau = (p: ProprietesIcone) => <Glyphe nom="cadeau" {...p} />;
export const Drapeau = (p: ProprietesIcone) => <Glyphe nom="drapeau" {...p} />;
export const Flamme = (p: ProprietesIcone) => <Glyphe nom="flamme" {...p} />;
export const Eclair = (p: ProprietesIcone) => <Glyphe nom="eclair" {...p} />;
export const Terminal = (p: ProprietesIcone) => <Glyphe nom="terminal" {...p} />;
export const Alimentation = (p: ProprietesIcone) => <Glyphe nom="alimentation" {...p} />;
export const AlimentationCoupee = (p: ProprietesIcone) => <Glyphe nom="alimentationCoupee" {...p} />;
export const Base = (p: ProprietesIcone) => <Glyphe nom="base" {...p} />;
export const Palette = (p: ProprietesIcone) => <Glyphe nom="palette" {...p} />;
export const Curseurs = (p: ProprietesIcone) => <Glyphe nom="curseurs" {...p} />;
export const Reglages = (p: ProprietesIcone) => <Glyphe nom="reglages" {...p} />;
export const Lien = (p: ProprietesIcone) => <Glyphe nom="lien" {...p} />;
export const Envoyer = (p: ProprietesIcone) => <Glyphe nom="envoyer" {...p} />;
export const Telecharger = (p: ProprietesIcone) => <Glyphe nom="telecharger" {...p} />;
export const OeilBarre = (p: ProprietesIcone) => <Glyphe nom="oeilBarre" {...p} />;
export const Diese = (p: ProprietesIcone) => <Glyphe nom="diese" {...p} />;
export const Tendance = (p: ProprietesIcone) => <Glyphe nom="tendance" {...p} />;
export const Activite = (p: ProprietesIcone) => <Glyphe nom="activite" {...p} />;

/* Barre de navigation mobile — Material 3 fait porter l'état sélectionné par un
   glyphe PLEIN et le repos par un glyphe au trait ; d'où le doublet `Maison` /
   `MaisonPleine`, de silhouette identique. */
export const Maison = (p: ProprietesIcone) => <Glyphe nom="maison" {...p} />;
export const MaisonPleine = (p: ProprietesIcone) => <Glyphe nom="maisonPleine" {...p} />;
export const Ellipse = (p: ProprietesIcone) => <Glyphe nom="ellipse" {...p} />;

/* ==========================================================================
   Dragon Ball Canon — Official Icons (Akira Toriyama Vector Suite)
   ========================================================================== */
export const DragonBall = (p: ProprietesIcone) => <Glyphe nom="dragonBall" {...p} />;
export const BouleDeCristal = DragonBall;

export const DragonRadar = (p: ProprietesIcone) => <Glyphe nom="dragonRadar" {...p} />;
export const RadarDragon = DragonRadar;

export const CapsuleCorp = (p: ProprietesIcone) => <Glyphe nom="capsuleCorp" {...p} />;
export const Kame = (p: ProprietesIcone) => <Glyphe nom="kame" {...p} />;
export const Tortue = Kame;

export const Scouter = (p: ProprietesIcone) => <Glyphe nom="scouter" {...p} />;
export const Detecteur = Scouter;

export const KintoUn = (p: ProprietesIcone) => <Glyphe nom="kintoUn" {...p} />;
export const NuageMagique = KintoUn;

export const Senzu = (p: ProprietesIcone) => <Glyphe nom="senzu" {...p} />;
export const HaricotMagique = Senzu;

export const Potara = (p: ProprietesIcone) => <Glyphe nom="potara" {...p} />;
export const ZSword = (p: ProprietesIcone) => <Glyphe nom="zSword" {...p} />;
export const EpeeZ = ZSword;

export const Majin = (p: ProprietesIcone) => <Glyphe nom="majin" {...p} />;
export const Shenron = (p: ProprietesIcone) => <Glyphe nom="shenron" {...p} />;
export const RubanRouge = (p: ProprietesIcone) => <Glyphe nom="rubanRouge" {...p} />;

export const Manga = (p: ProprietesIcone) => <Glyphe nom="manga" {...p} />;
export const PlancheManga = Manga;
export const Rouage = Reglages;
