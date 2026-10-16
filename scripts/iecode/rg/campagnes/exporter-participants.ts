// Export du roster d'une campagne : les personnes, leurs œuvres, et ce qui justifie chaque regroupement.
//
// ── POURQUOI CE SCRIPT EXISTE ──────────────────────────────────────────────────
// Le tirage au sort d'une campagne se joue sur UNE question : qui a combien de tickets.
// Y répondre demande trois arbitrages que la base ne sait pas faire seule :
//   1. quelles créations sont visibles (le rôle `rg` est PROPRIÉTAIRE des tables, donc la
//      RLS ne le filtre pas — chaque clause de visibilité est recopiée à la main, plus bas) ;
//   2. quelles publications sont le MÊME dessin publié deux fois (Discord puis X) — invisible
//      à un `sha256`, puisque X ré-encode systématiquement en JPEG : 27 images, 27 empreintes
//      binaires DISTINCTES, donc zéro doublon trouvé et quatre chances de trop attribuées ;
//   3. quelles identités de plateforme sont la même personne — deux des quatre fusions
//      (kittyshadow_/kittycaillou et Fujo_Kiran/fujorin) sont INVISIBLES à toute règle de
//      pseudo et n'ont pu être établies que par l'empreinte perceptuelle de l'image.
// Un JSON écrit à la main mentirait au premier changement de collecte. Ce script le régénère.
//
// ── CE QUE CE SCRIPT NE FAIT PAS ───────────────────────────────────────────────
// Il n'écrit RIEN en base, ne calcule AUCUNE empreinte d'image (c'est le rôle du passage
// hors ligne qui charge `sharp` et télécharge `pbs.twimg.com`), et ne DEVINE aucune fusion.
// Les regroupements et les fusions lui sont donnés en table MESURÉE, avec leur preuve ; il
// vérifie que cette table s'applique encore à ce que la base contient aujourd'hui, et refuse
// d'écrire un roster incohérent plutôt que d'en produire un faux.
//
// ── PLUS AUCUNE COPIE DE LA REQUÊTE (26/8/2026) ───────────────────────────────
// `SQL_CREATIONS` vivait ici en COPIE de celle de `tirage-queries.ts`, faute de pouvoir importer
// un module qui porte `import "server-only"` et `@/lib/db/pg`. Les deux avaient déjà divergé : la
// copie d'ici s'était enrichie d'une colonne `permalien`. Elle vit désormais dans
// `apps/website/src/lib/x-campagnes/sql-creations.ts`, module PUR sans aucun import, lisible
// aussi bien par le bundle Next que par un script Bun. Le NOYAU du tirage est importé de la même
// façon (`../../apps/website/src/lib/x-campagnes/tirage`). Il ne reste donc rien de dupliqué.
//
// ── CONFIDENTIALITÉ — LA DÉCISION, PAS UNE PRÉCAUTION VAGUE ────────────────────
// Le fichier COMMITTÉ ne porte AUCUN identifiant de plateforme : chaque personne y est
// désignée par sa `cle_publique` — `sha256("RGCLEPUB1" ‖ slug ‖ clé)` tronqué à 16 hex, que
// chacun recompose depuis son propre identifiant avec `clePublique()`, fonction publique.
// Ce qui y figure en clair — pseudos d'auteur, identifiants de publication (tweet, message,
// shortcode) — est DÉJÀ affiché sur https://rosegriffon.fr/iergday : la galerie publie
// `auteur_pseudo` pour les trois sources (`queries.ts`, colonnes de l'`union all`). Ce fichier
// n'y ajoute donc rien de nouveau.
// Ce qui n'est PAS déjà public, et qui n'est donc écrit QUE dans la variante `--complet`
// (gitignorée) : les `author_id` X, les snowflakes Discord, et la table `identifiants` qui les
// relie entre plateformes. Ce lien-là, personne ne l'a publié — c'est nous qui l'avons établi à
// l'empreinte d'image. Aucun e-mail, aucune adresse, aucun `soumis_par` n'est lu nulle part :
// les requêtes ci-dessous ne SÉLECTIONNENT jamais ces colonnes.
//
// ── USAGE ──────────────────────────────────────────────────────────────────────
//   bun scripts/campagnes/exporter-participants.ts [<slug>] [--complet] [--poids <mode>]
//                                                  [--sortie <chemin>] [--json] [--verifier]
//
// Défauts : slug `iergday`, mode de poids `par_oeuvre`, sortie
// `apps/website/src/data/campagnes/<slug>-roster.json` (`--complet` → `<slug>-roster-complet.json`).
// `--verifier` n'écrit rien : il recalcule tout et compare au fichier déjà sur disque.
import { checkoutRoot } from "@aphrody/paths";
import { createBunSql } from "@rosegriffon/db/bun-sql";

import { SQL_CREATIONS } from "../../../../apps/rg-website/src/lib/x-campagnes/sql-creations";

import {
  clePublique,
  empreinteRoster,
  poidsDe,
  rosterDe,
  type ParticipantTirage,
  type PoidsMode,
  type SourceTirage,
} from "../../../../apps/rg-website/src/lib/x-campagnes/tirage";

// ───────────────────────── Réglages ─────────────────────────

const RACINE_REPO = Bun.env.RG_REPO_ROOT ?? checkoutRoot("rg");
const DOSSIER_SORTIE = `${RACINE_REPO}/apps/website/src/data/campagnes`;

/**
 * Analyse d'arguments en UN seul passage. Un `args.find(a => !a.startsWith("--"))` naïf
 * prendrait `par_oeuvre` pour un slug dès qu'on écrit `--poids par_oeuvre` sans slug : les
 * options à valeur consomment donc explicitement l'argument suivant.
 */
const OPTIONS_A_VALEUR = new Set(["--poids", "--sortie"]);
const args = Bun.argv.slice(2);
const drapeaux = new Set<string>();
const valeurs = new Map<string, string>();
const positionnels: string[] = [];
for (let i = 0; i < args.length; i += 1) {
  const a = args[i] as string;
  if (!a.startsWith("--")) {
    positionnels.push(a);
  } else if (OPTIONS_A_VALEUR.has(a)) {
    const v = args[i + 1];
    if (v === undefined) throw new Error(`${a} attend une valeur`);
    valeurs.set(a, v);
    i += 1;
  } else {
    drapeaux.add(a);
  }
}
const option = (nom: string): string | null => valeurs.get(nom) ?? null;

const SLUG = positionnels[0] ?? "iergday";
const COMPLET = drapeaux.has("--complet");
const JSON_SORTIE = drapeaux.has("--json");
const VERIFIER = drapeaux.has("--verifier");

/**
 * `par_oeuvre` par défaut — décision, pas commodité. La règle 3 du règlement en base dit
 * « Vous pouvez participer autant de fois que vous le souhaitez » : écrite dans un règlement
 * de concours, cette phrase ENCOURAGE à produire plus. Retenir `un_par_personne` reviendrait à
 * dire après coup que le deuxième dessin de Sanada et la deuxième publication d'orphelinalius
 * ne comptaient pas, alors que la campagne les a sollicités. L'unité comptée est l'ŒUVRE et
 * non la publication : trois personnes ont publié DEUX FOIS LE MÊME dessin — une chance, pas deux.
 */
const POIDS_MODE = ((): PoidsMode => {
  const brut = option("--poids");
  if (brut === "un_par_personne" || brut === "par_oeuvre") return brut;
  if (brut !== null) throw new Error(`--poids inconnu : ${brut} (attendu un_par_personne | par_oeuvre)`);
  return "par_oeuvre";
})();

// ─────────────────── Table MESURÉE — empreintes des images ───────────────────
//
// MESURÉ LE 23/8/2026, hors ligne, sur les 27 images des 20 créations retenues d'`iergday`.
// Discord et Instagram lus sous `/var/www/rg-storage/assets/<chemin>` ; X téléchargé depuis
// `pbs.twimg.com` avec `?name=orig` — SANS ce paramètre on reçoit la variante « large »
// plafonnée à 2048 px et l'on comparerait deux redimensionnements différents.
// dHash 64 bits (gris, 9×8, comparaison au voisin de droite) ; pHash 64 bits (gris, 32×32,
// DCT-II séparable, bloc 8×8, composante continue jetée, seuil = MÉDIANE des 63 coefficients
// restants et non moyenne — un seul coefficient énorme tirerait la moyenne et viderait
// l'empreinte). Les 27 `sha256` sont TOUS DISTINCTS : c'est la démonstration du piège.
//
// Cette table est le repli. Dès que `public.x_campagne_oeuvres` existe et porte des lignes
// pour la campagne, c'est ELLE qui fait autorité et la table ci-dessous n'est plus lue —
// voir `chargerOeuvresDeLaBase()`.

interface ImageMesuree {
  readonly source: SourceTirage;
  readonly identifiant: string;
  /** Position du fichier dans la création (0 = premier). */
  readonly index: number;
  /** Pseudo public de l'auteur, tel qu'affiché sur la galerie. */
  readonly auteur: string;
  readonly octets: number;
  readonly largeur: number;
  readonly hauteur: number;
  readonly sha256: string;
  /**
   * Empreintes perceptuelles — `null` pour une VIDÉO.
   *
   * `sharp` ne décode pas un flux, et hacher une frame prise au hasard donnerait un nombre qui
   * ne veut rien dire : deux vidéos différentes peuvent ouvrir sur le même plan noir. Une
   * participation vidéo ne peut donc pas être rapprochée d'une autre par l'empreinte — elle est
   * unique par défaut, et c'est un humain qui dirait le contraire.
   */
  readonly dhash: string | null;
  readonly phash: string | null;
}

const IMAGES_MESUREES: readonly ImageMesuree[] = [
  {
    source: "discord",
    identifiant: "1539898224503033877",
    index: 0,
    auteur: "san_la_vraie",
    octets: 10856653,
    largeur: 2734,
    hauteur: 2269,
    sha256: "4204055e1195e92f8e7fe81a51224f504e7f9d39bbae5853147e0b822824fbe3",
    dhash: "2a7234b495b435b0",
    phash: "37cce03f9c614a36",
  },
  {
    source: "discord",
    identifiant: "1540301925298348062",
    index: 0,
    auteur: "san_la_vraie",
    octets: 4623955,
    largeur: 2115,
    hauteur: 2663,
    sha256: "598493423211aa8fa4d0fff0d54168e1ae8175e505ba5c1c7f289e7e04ec71c2",
    dhash: "72e0f8f9f8d2e6a4",
    phash: "362c99c6c5994e6d",
  },
  {
    source: "discord",
    identifiant: "1540456574588559440",
    index: 0,
    auteur: "munfurawa",
    octets: 2149568,
    largeur: 1730,
    hauteur: 1440,
    sha256: "8f0082bcfb4caccdf6cb4d46de9814487616e389d7990c4b2aa9ed064a350d21",
    dhash: "4e1b1d1f9f1f0f0f",
    phash: "4ea6399a7879193c",
  },
  {
    source: "discord",
    identifiant: "1540508422804471819",
    index: 0,
    auteur: "fujorin",
    octets: 4146687,
    largeur: 1720,
    hauteur: 2428,
    sha256: "723fd195645d38b1d1d59b2a89a3fac8a98965606c73edac5d0cc1fbe65809b7",
    dhash: "97077331626c4d58",
    phash: "52d6ce9966653398",
  },
  {
    source: "discord",
    identifiant: "1540742112713379840",
    index: 0,
    auteur: "kittycaillou",
    octets: 532348,
    largeur: 2558,
    hauteur: 2160,
    sha256: "bd2e3682c0b1185759b2634f5187e1a214c74d130f499fd27d20447f56a3e1a3",
    dhash: "373b1f0e0d277365",
    phash: "51cc323349b6676d",
  },
  {
    source: "discord",
    identifiant: "1540784107729064108",
    index: 0,
    auteur: "jennscarlet",
    octets: 6845469,
    largeur: 2550,
    hauteur: 1938,
    sha256: "110c3eb8ab82816976e4bd91235a97d8679b54a0df17dfa0bc62743b6530cc7d",
    dhash: "e892929392222581",
    phash: "076aeda85d69904f",
  },
  {
    source: "discord",
    identifiant: "1540784107729064108",
    index: 1,
    auteur: "jennscarlet",
    octets: 11041321,
    largeur: 2550,
    hauteur: 3507,
    sha256: "a46e63af7807e69d3a486248313fad9cfc1a9505c2462b382067b002738122ea",
    dhash: "ecf8929332a18b96",
    phash: "076ae82dc2177d87",
  },
  // Mesurée le 26/8/2026 par `empreintes-oeuvres.ts` : la seule VIDÉO de la campagne, déposée
  // dans les délais (22/8 18:32 UTC) et restée invisible jusque-là, la récolte Discord n'ayant
  // accepté que les images. `.mov` de 1,26 Mio, 360×432.
  {
    source: "discord",
    identifiant: "1540790666056040508",
    index: 0,
    auteur: "karuminasan",
    octets: 1291366,
    largeur: 360,
    hauteur: 432,
    sha256: "dec23a908e8a7a5728903a5b7cc956115477e7a6ddf1d6838ac8efdb8fda3baa",
    dhash: null,
    phash: null,
  },
  {
    source: "discord",
    identifiant: "1540808591806570586",
    index: 0,
    auteur: "cacabueno",
    octets: 1191936,
    largeur: 3840,
    hauteur: 2160,
    sha256: "47040b77e18cfa19e65ebaeb1e228d2ae5fc922083c0db11bdc1558b7748b7ac",
    dhash: "4ac0c4a4d28cccc2",
    phash: "3ff0c40fc2096b3e",
  },
  {
    source: "discord",
    identifiant: "1540837023487631391",
    index: 0,
    auteur: "thunder_ace",
    octets: 253419,
    largeur: 3225,
    hauteur: 1857,
    sha256: "9f1b54dc87fe7a5667a204df14264c246d228f7feb99e43c68231c10fc4eebd9",
    dhash: "f7373d3f2bab2723",
    phash: "556a331dfa4825e3",
  },
  {
    source: "discord",
    identifiant: "1540837023487631391",
    index: 1,
    auteur: "thunder_ace",
    octets: 355048,
    largeur: 3083,
    hauteur: 1749,
    sha256: "807133ebbd698add73b6d90d1b2ebf43283897e4f9831ac36b68bec8df31e77a",
    dhash: "a4d64e2eb7934b2d",
    phash: "5b3bad374320eca2",
  },
  {
    source: "discord",
    identifiant: "1540837023487631391",
    index: 2,
    auteur: "thunder_ace",
    octets: 229474,
    largeur: 3270,
    hauteur: 1858,
    sha256: "a4ef35cfa8508923071af6a9b11470abff54216ba74ff86fb3f0be3e69e8dd0e",
    dhash: "040b497739597d7f",
    phash: "641b1ae7c3788d96",
  },
  {
    source: "discord",
    identifiant: "1540837023487631391",
    index: 3,
    auteur: "thunder_ace",
    octets: 438418,
    largeur: 3438,
    hauteur: 1969,
    sha256: "84a78b357bc00163f8f1df714f1a4b6e4f69c29102d0ac0a65e440a6604ab18e",
    dhash: "1b1c0d2c0c4d7f7f",
    phash: "490f76761236d572",
  },
  {
    source: "discord",
    identifiant: "1540837023487631391",
    index: 4,
    auteur: "thunder_ace",
    octets: 511084,
    largeur: 3347,
    hauteur: 1913,
    sha256: "3551e998911f74489f1b76fd1f7287ed4911c963f048c6daf72218c3c9d30aeb",
    dhash: "6f2e1fc7c7277773",
    phash: "500d6339387cc7de",
  },
  {
    source: "discord",
    identifiant: "1540837023487631391",
    index: 5,
    auteur: "thunder_ace",
    octets: 264991,
    largeur: 2618,
    hauteur: 1676,
    sha256: "279749476af477733d4b89bde6c35c2e442fc64f3131f6132c79e6c00118d454",
    dhash: "400917476f9cdef7",
    phash: "5f007cedd09e33e0",
  },
  {
    source: "discord",
    identifiant: "1540837023487631391",
    index: 6,
    auteur: "thunder_ace",
    octets: 427728,
    largeur: 3279,
    hauteur: 1904,
    sha256: "b0d449c1e8c48289823b5667bbb5847b0ec8375f221839480e7423031fa8deff",
    dhash: "091d018727cdd59f",
    phash: "0d026c39d33fd933",
  },
  {
    source: "discord",
    identifiant: "1540842925456359557",
    index: 0,
    auteur: "deborah6625",
    octets: 2379863,
    largeur: 1839,
    hauteur: 1381,
    sha256: "0397e5d1502cd5eff91b8b0d854d875bd6254089504c1a0ec51e2ce47ca63882",
    dhash: "0f4fc949474b4349",
    phash: "1c4b4592cd6e2dd3",
  },
  {
    source: "instagram",
    identifiant: "DcUEDDKoTgP",
    index: 0,
    auteur: "orphelinalius",
    octets: 57504,
    largeur: 640,
    hauteur: 853,
    sha256: "4263767b14310c7ee166aa9258a20fa715f7abf99590acd79f2595ae3ccacc27",
    dhash: "414d514d45476777",
    phash: "0015051d2b3f3fbf",
  },
  {
    source: "instagram",
    identifiant: "DcW22ScIdYv",
    index: 0,
    auteur: "orphelinalius",
    octets: 98554,
    largeur: 640,
    hauteur: 853,
    sha256: "88836f4c2844c396fa40e097bbf8da81954fdcd26fe778f2e03a33619d9b9738",
    dhash: "4517735732584e53",
    phash: "00915ded37f834f4",
  },
  {
    source: "x",
    identifiant: "2087922862803841524",
    index: 0,
    auteur: "Ruvi_Seiya",
    octets: 1007220,
    largeur: 3000,
    hauteur: 4000,
    sha256: "0d13041f57cef747d22f48ab1cc0373af149114b6a3288de14ae57fac761b2ec",
    dhash: "0185111301000100",
    phash: "05d75d1d26a92a3b",
  },
  {
    source: "x",
    identifiant: "2087923415000789199",
    index: 0,
    auteur: "inazo__",
    octets: 384239,
    largeur: 1920,
    hauteur: 1080,
    sha256: "47d7790bc3138e22b8d7333224b41fc0bd9c61b8ae4bf93e405ece41e794a123",
    dhash: "d3f1f351f0f2f2f3",
    phash: "36b6920a0d5cf2b7",
  },
  {
    source: "x",
    identifiant: "2087998363211825503",
    index: 0,
    auteur: "grimnape",
    octets: 111982,
    largeur: 1919,
    hauteur: 977,
    sha256: "f2e3de7246c378e3d466940dbac9c00087010b13321cd14065168fdef8a8e4d7",
    dhash: "09992b0b33360737",
    phash: "1635696b3b903373",
  },
  {
    source: "x",
    identifiant: "2090455666267713840",
    index: 0,
    auteur: "San_La_Vraie",
    octets: 1380213,
    largeur: 2734,
    hauteur: 2269,
    sha256: "9f8693ad91253c206965e40d8f7f2a1821f3230a89dbddfdaaaaabbdb6b0bb42",
    dhash: "2a7336b495b435b0",
    phash: "37cce03f9c614a36",
  },
  {
    source: "x",
    identifiant: "2090513552087879823",
    index: 0,
    auteur: "CuicoLya",
    octets: 556604,
    largeur: 2160,
    hauteur: 3055,
    sha256: "fb0a3086c15ff0cda07ddc90824ca8a229a107b95f0be709e282353524279dbb",
    dhash: "8191b0060c3ca242",
    phash: "0ba7b4cdd8386539",
  },
  {
    source: "x",
    identifiant: "2090897441985896710",
    index: 0,
    auteur: "Haroldinho_jr",
    octets: 233386,
    largeur: 2048,
    hauteur: 1204,
    sha256: "0f3157f6310c76c90c8f6fb3294fbeb01ae329ae42cc7b0fd484523a7eeb5cc6",
    dhash: "e87b692763c39359",
    phash: "14692eb6699f1b2c",
  },
  {
    source: "x",
    identifiant: "2090899354148368577",
    index: 0,
    auteur: "FurawaMun",
    octets: 206165,
    largeur: 1730,
    hauteur: 1440,
    sha256: "91f69c9428c89ac8865bc4aa0ff0fd6060c653f2785d80b0891df5ceb5a33311",
    dhash: "4e1b1d1f9f1f0f0f",
    phash: "4ea6399a7879193c",
  },
  {
    source: "x",
    identifiant: "2091112393455632493",
    index: 0,
    auteur: "Fujo_Kiran",
    octets: 168616,
    largeur: 850,
    hauteur: 1200,
    sha256: "e1922a867cced1534d042c245d7d7f6117bde40965b5c51a249a070427f5afe3",
    dhash: "97077331626e4d78",
    phash: "52d6ce9966653394",
  },
  {
    source: "x",
    identifiant: "2091195848247885914",
    index: 0,
    auteur: "kittyshadow_",
    octets: 2153905,
    largeur: 4096,
    hauteur: 3459,
    sha256: "bc729a41095cce703f9bd40f87ab777926efc3570c4d07a011c0a9baaf57d296",
    dhash: "373b1f0f0d277365",
    phash: "51cc323349b6676d",
  },
];

/**
 * Seuil de doublon : `dHash ≤ 8 ET pHash ≤ 8`, CONJONCTION obligatoire — une seule empreinte
 * se laisse tromper. Sur les 351 paires (C(27,2)) la distribution est franchement bimodale :
 * dHash intra-groupe max = 2, inter-groupe min = 17 (fossé de 14 bits) ; pHash intra max = 2,
 * inter min = 20 (fossé de 17 bits). 8 tombe au milieu des deux fossés, aucune paire n'est en
 * zone grise, donc aucun arbitrage douteux n'a été nécessaire.
 *
 * ⚠ ANGLE MORT CONNU ET PROUVÉ : ce seuil ne voit PAS un RECADRAGE. Les deux fichiers de
 * `discord:1540784107729064108` sont le même dessin (l'un est un découpage vertical de
 * l'autre : erreur absolue moyenne 5,47/255 à l'offset y = 654 px, contre 93,64 pour un témoin
 * négatif) et pourtant leur dHash vaut 19 et leur pHash 26, en plein cœur de la zone
 * « dessins différents ». Ici cela ne fausse rien — les deux fichiers appartiennent à la MÊME
 * création — mais un doublon recadré entre deux créations DISTINCTES passerait sous le radar.
 */
const SEUIL_DOUBLON = { dhash: 8, phash: 8 } as const;

// ─────────────────── Table MESURÉE — les regroupements d'œuvres ───────────────────
//
// Quatre groupes, tous des paires Discord + X du MÊME auteur : un cross-post légitime, pas un
// vol de dessin. Aucun groupe multi-auteurs. Chaque groupe a été CONFIRMÉ À L'ŒIL sur une
// planche côte à côte avant d'être écrit ici — retirer une chance à quelqu'un exige d'avoir vu
// les deux dessins, pas seulement deux nombres.
//
// `creationGardee` = la publication qui atteste l'éligibilité, donc le post X : la règle 1 du
// règlement en base dit « Postez une image […] sur Twitter ou Instagram », Discord n'étant que
// le salon de dépôt. `imageMaster` = le fichier le MIEUX DÉFINI, indépendamment de la source.
// Les deux répondent à deux questions différentes, d'où deux champs : servir un JPEG deux fois
// plus petit parce que « X compte » abîmerait le dessin pour une raison administrative, et
// créditer Discord parce que le fichier y est meilleur contredirait le règlement.

interface RefCreation {
  readonly source: SourceTirage;
  readonly identifiant: string;
}
interface GroupeMesure {
  readonly code: string;
  readonly creations: readonly RefCreation[];
  readonly creationGardee: RefCreation;
  /** Le fichier à afficher : `index` est la position dans la création désignée. */
  readonly imageMaster: RefCreation & { readonly index: number };
  readonly distanceMax: {
    readonly dhash: number;
    readonly phash: number;
    readonly phashCentre: number;
    readonly ecartRecadrage: number;
  };
  readonly motif: string;
}

const GROUPES_MESURES: readonly GroupeMesure[] = [
  {
    code: "G1",
    creations: [
      { source: "discord", identifiant: "1540456574588559440" },
      { source: "x", identifiant: "2090899354148368577" },
    ],
    creationGardee: { source: "x", identifiant: "2090899354148368577" },
    imageMaster: { source: "discord", identifiant: "1540456574588559440", index: 0 },
    distanceMax: { dhash: 0, phash: 0, phashCentre: 0, ecartRecadrage: 0.0193 },
    motif:
      "Même dessin, la preuve la plus forte des quatre : dHash STRICTEMENT identique des deux côtés " +
      "(4e1b1d1f9f1f0f0f), pHash identique (4ea6399a7879193c), définition identique au pixel près " +
      "(1730×1440). X n'a fait que ré-encoder le PNG en JPEG (2 149 568 o → 206 165 o). La chronologie " +
      "corrobore : le message Discord dit « Je cours la mettre sur Twitter- » et le tweet paraît six " +
      "minutes plus tard. Création gardée = le post X (règle 1). Image master = le PNG Discord, sans perte.",
  },
  {
    code: "G2",
    creations: [
      { source: "discord", identifiant: "1540742112713379840" },
      { source: "x", identifiant: "2091195848247885914" },
    ],
    creationGardee: { source: "x", identifiant: "2091195848247885914" },
    imageMaster: { source: "x", identifiant: "2091195848247885914", index: 0 },
    distanceMax: { dhash: 1, phash: 0, phashCentre: 0, ecartRecadrage: 0.0457 },
    motif:
      "Même dessin : dHash 1, pHash 0, pHash-centre 0, écart de recadrage 0,046. La signature " +
      "« @Kittyshadow_ » est peinte DANS l'illustration des deux côtés, y compris dans la version " +
      "déposée sur Discord par kittycaillou. Création gardée = le post X (règle 1). SEUL groupe où X " +
      "porte la MEILLEURE définition (4096×3459 contre 2558×2160) : l'image master est donc le fichier X.",
  },
  {
    code: "G3",
    creations: [
      { source: "discord", identifiant: "1539898224503033877" },
      { source: "x", identifiant: "2090455666267713840" },
    ],
    creationGardee: { source: "x", identifiant: "2090455666267713840" },
    imageMaster: { source: "discord", identifiant: "1539898224503033877", index: 0 },
    distanceMax: { dhash: 2, phash: 0, phashCentre: 0, ecartRecadrage: 0.0636 },
    motif:
      "Même dessin : dHash 2, pHash 0, pHash-centre 0, écart de recadrage 0,064, définition identique " +
      "(2734×2269). La signature « @San_La_Vraie » est peinte DANS l'illustration des deux côtés. " +
      "Création gardée = le post X (règle 1). Image master = le PNG Discord (10,9 Mo sans perte), le " +
      "JPEG X (1,4 Mo) n'en étant qu'une compression.",
  },
  {
    code: "G4",
    creations: [
      { source: "discord", identifiant: "1540508422804471819" },
      { source: "x", identifiant: "2091112393455632493" },
    ],
    creationGardee: { source: "x", identifiant: "2091112393455632493" },
    imageMaster: { source: "discord", identifiant: "1540508422804471819", index: 0 },
    distanceMax: { dhash: 2, phash: 2, phashCentre: 0, ecartRecadrage: 0.0343 },
    motif:
      "Même dessin : dHash 2, pHash 2, pHash-centre 0, écart de recadrage 0,034 — et c'est le groupe " +
      "le plus fortement réduit (1720×2428 → 850×1200, facteur 2,02), preuve que le redimensionnement " +
      "seul ne casse pas l'empreinte. Création gardée = le post X (règle 1). Écart d'archivage le plus " +
      "marqué des quatre : l'image master est le PNG Discord, deux fois plus défini que ce que sert X.",
  },
];

/**
 * Créations dont le nombre de FICHIERS n'est pas le nombre d'ŒUVRES. Deux cas, tous deux
 * vérifiés à l'œil, et c'est l'arbitrage le plus lourd de l'exercice : sans lui, thunder_ace
 * emporterait à lui seul 7 tickets sur 22, soit 32 % du tirage, pour avoir appuyé sept fois
 * sur le déclencheur.
 */
const ARBITRAGES_FICHIERS: readonly {
  readonly source: SourceTirage;
  readonly identifiant: string;
  readonly nbFichiers: number;
  readonly nbOeuvres: number;
  readonly imageMasterIndex: number;
  readonly motif: string;
}[] = [
  {
    source: "discord",
    identifiant: "1540837023487631391",
    nbFichiers: 7,
    nbOeuvres: 1,
    imageMasterIndex: 0,
    motif:
      "Sept photos d'un écran de télévision (moiré et reflets visibles) montrant l'OC Fulgur en match : " +
      "une image de dribble, une image du télop « Tempête stellaire », et CINQ images portant le même " +
      "télop « Tir pétri 2 » — cinq trames successives d'une seule technique. Le message lui-même " +
      "annonce « je vais vous envoyer des screens de mon Oc Fulgur qui fait ses techs ! » : un seul " +
      "acte de participation. La paire interne la plus proche est à dHash 22, donc aucun de ces sept " +
      "fichiers n'est un doublon d'une autre création. Lecture alternative défendable si la direction " +
      "préfère compter par technique distincte : 3 œuvres. Ce qui n'est PAS défendable, c'est 7.",
  },
  {
    source: "discord",
    identifiant: "1540784107729064108",
    nbFichiers: 2,
    nbOeuvres: 1,
    imageMasterIndex: 1,
    motif:
      "Deux fichiers, un seul dessin : la première image est un recadrage vertical de la seconde " +
      "(2550×1938 découpé dans 2550×3507 ; erreur absolue moyenne 5,47/255 à l'offset y = 654 px, " +
      "contre 93,64 pour un témoin négatif). Le seuil perceptuel ne le voyait PAS — dHash 19, pHash 26 — " +
      "c'est la recherche de recadrage dédiée qui l'a établi. Image master = le fichier 1, le plus complet.",
  },
];

// ─────────────────── Table MESURÉE — les fusions d'identités ───────────────────
//
// `cle` = un IDENTIFIANT IMMUABLE, jamais un pseudo : elle doit survivre à un changement de
// nom. Le corpus en donne la preuve — l'`author_id` X `1451855639592849409` y porte DEUX
// handles historiques, « yukun_0073DQ » et « yukun073DQ ». Instagram est le seul point
// fragile, et il est irréductible : `campagne_creations_instagram` n'a pas de colonne
// numérique, seulement `auteur_pseudo`.
//
// DEUX NIVEAUX DE PREUVE, et ni l'un ni l'autre ne suffit seul :
//   (a) l'IMAGE — deux fusions étaient IMPOSSIBLES par le pseudo (kittyshadow_/kittycaillou,
//       dont le nom affiché X est « sigmimi » ; Fujo_Kiran/fujorin) et sans l'empreinte ces
//       deux personnes auraient eu 2 chances chacune au lieu d'1 ;
//   (b) le PSEUDO normalisé — la fusion inazo__ était invisible à l'image, sa ligne Discord
//       étant le règlement masqué, sans dessin à comparer.
// La normalisation est en NFKD et non NFC : le nom affiché de Haroldinho est en italiques
// mathématiques Unicode, et un filtrage naïf `[^a-z0-9]` VIDERAIT la chaîne — deux pseudos
// entièrement non-ASCII se « ressembleraient » alors parfaitement.

interface FusionAppliquee {
  /** Clé canonique conservée. */
  readonly cle: string;
  /** Identité de plateforme absorbée : elle n'a plus de ligne propre dans le roster. */
  readonly absorbee: string;
  readonly niveau: "image" | "pseudo" | "image+pseudo";
  readonly preuve: string;
}

const FUSIONS_APPLIQUEES: readonly FusionAppliquee[] = [
  {
    cle: "discord:908269053347504170",
    absorbee: "x:1471410215086170112",
    niveau: "image+pseudo",
    preuve:
      "Les deux niveaux concordent. Image : groupe G3, dHash 2, pHash 0, définition identique " +
      "2734×2269, signature « @San_La_Vraie » peinte dans l'illustration des deux côtés. Pseudo : " +
      "égalité mécanique après normalisation, « San_La_Vraie » → sanlavraie == « san_la_vraie » → sanlavraie.",
  },
  {
    cle: "discord:306135978316136448",
    absorbee: "x:1035885928173260800",
    niveau: "image+pseudo",
    preuve:
      "Les deux niveaux concordent. Image : groupe G1, dHash STRICTEMENT identique, définition " +
      "identique au pixel près, et le message Discord annonce le tweet six minutes avant qu'il ne " +
      "paraisse. Pseudo : « Munfurawa » → munfurawa == « munfurawa » → munfurawa.",
  },
  {
    cle: "discord:309031721016229890",
    absorbee: "x:860237203674472450",
    niveau: "image",
    preuve:
      "Le pseudo seul n'aurait PAS suffi : « Fujo_Kiran » → fujokiran contre « fujorin » → fujorin, " +
      "aucune égalité, quatre caractères de préfixe commun au mieux. Ce qui tranche : groupe G4, " +
      "dHash 2, pHash 2, pHash-centre 0, malgré une réduction d'un facteur 2,02. Corroborations " +
      "indépendantes : les deux noms affichés mentionnent CIERAN et le même statut de commissions.",
  },
  {
    cle: "discord:683044704967065626",
    absorbee: "x:1481333548074344451",
    niveau: "image",
    preuve:
      "Cas où TOUTE méthode par pseudo échouait : « kittyshadow_ » et « kittycaillou » ne partagent " +
      "que le préfixe « kitty », et le nom affiché X est « sigmimi ». Ce qui tranche : groupe G2, " +
      "dHash 1, pHash 0, et la signature « @Kittyshadow_ » écrite DANS l'illustration déposée sur " +
      "Discord par kittycaillou. Corroboration textuelle : les deux messages nomment le même OC, Shirel.",
  },
  {
    cle: "discord:531549483067244566",
    absorbee: "x:1148897100387770369",
    niveau: "pseudo",
    preuve:
      "Seule fusion que l'image ne pouvait pas donner : la ligne Discord de cette personne est le " +
      "règlement masqué, sans dessin à comparer. Égalité mécanique exacte : « inazo__ » → inazo des " +
      "deux côtés. Corroboration forte trouvée en base : le compte Discord a lui-même publié en 2023 " +
      "un lien vers un tweet de son PROPRE handle X — auto-déclaration explicite.",
  },
];

/**
 * SIGNALÉES, JAMAIS APPLIQUÉES. Appliquer un indice sans effet mesurable ne gagne rien et
 * crée un précédent où l'on fusionne sur une ressemblance. Chacune est ici avec sa confiance
 * ET son effet réel sur les comptages — qui est nul dans les trois cas.
 */
const FUSIONS_SUGGEREES: readonly {
  readonly gauche: string;
  readonly droite: string;
  readonly confiance: "élevée" | "moyenne" | "rejetée";
  readonly effetSurLesComptages: string;
  readonly indice: string;
}[] = [
  {
    gauche: "discord:469900328758935552",
    droite: "x:JennScarlet87",
    confiance: "élevée",
    effetSurLesComptages: "aucun — le handle a ZÉRO ligne dans `tweets` et aucune création sur la campagne",
    indice:
      "Auto-déclaration en base : le compte Discord a publié DEUX fois (2023) un lien vers des tweets " +
      "de « JennScarlet87 ». Le rapprochement de pseudo va dans le même sens (inclusion stricte). " +
      "Signalée surtout parce qu'elle documente un point sensible : cette personne POSSÈDE un compte X " +
      "et ne s'en est pas servie pour l'IERG Day, ce qui pèse sur l'arbitrage de la règle 1 la concernant.",
  },
  {
    gauche: "discord:309031721016229890",
    droite: "x:Kiran_inazuma",
    confiance: "moyenne",
    effetSurLesComptages: "aucun — handle absent du corpus, aucune création",
    indice:
      "Ancien handle X auto-déclaré : deux liens publiés en 2023 vers des tweets de « Kiran_inazuma », " +
      "même radical que le handle actuel « Fujo_Kiran ». Non recoupable : « Kiran_inazuma » n'a aucune " +
      "ligne dans `tweets`. Intérêt réel — c'est un exemple concret, sur un participant de CETTE " +
      "campagne, qu'un handle X change avec le temps : argument direct pour clé sur l'identifiant numérique.",
  },
  {
    gauche: "instagram:orphelinalius",
    droite: "discord:309031721016229890",
    confiance: "rejetée",
    effetSurLesComptages: "aucun — écartée sur pièce",
    indice:
      "Seule ressemblance : « Cierra » (nom d'un OC dessiné par orphelinalius) contre « Cieran » " +
      "(alias de la personne fujorin). Un nom d'OC face à un nom de personne, deux catégories " +
      "différentes ; et les OC de fujorin sont explicitement nommés dans son tweet (Tanguy, Sage, " +
      "Nora), aucun ne s'appelle Cierra. Vérification complémentaire : « orphelinalius » n'apparaît " +
      "NULLE PART ailleurs en base. Listée pour montrer qu'elle a été examinée, puis écartée.",
  },
];

/**
 * Pseudo affiché retenu pour chaque clé canonique, quand il ne peut pas être déduit
 * mécaniquement. Sanada, Munfurawa, Deb, Isma… sont les noms d'affichage Discord ; pour les
 * fusions on retient le nom sous lequel la personne se présente, pas le handle technique.
 * Toute clé absente de cette table prend le nom d'affichage de sa création la plus récente.
 */
const PSEUDOS_RETENUS: Readonly<Record<string, string>> = {
  // Nom d'affichage X « B A K E D P I G E O N (CIERAN) || COMMS OFF » : la personne se
  // présente comme Cieran des deux côtés, le reste est un statut de commissions.
  "discord:309031721016229890": "Cieran / FujoRin",
  // « NTG V3 | ThunderAce/Kaze » — le préfixe est un tag d'équipe, pas un nom.
  "discord:460001633053704192": "ThunderAce",
  // Sa ligne Discord est le règlement masqué : le nom vient du nom d'affichage X « Inazo | Noa⚡️ ».
  "discord:531549483067244566": "Inazo",
  // Aucun nom d'affichage côté Discord, et « sigmimi » côté X : on retient le handle du dépôt.
  "discord:683044704967065626": "kittycaillou",
  // « Ruvi_Seiya |COMMS OPENED » — même cas que Cieran.
  "x:1946965962932301825": "Ruvi_Seiya",
  // « Lya 🐰 » — l'émoji est une décoration, pas une partie du nom.
  "x:2870776923": "Lya",
  // « 𝐻𝑎𝑟𝑜𝑙𝑑𝑖𝑛ℎ𝑜 𒉭 » : italiques mathématiques Unicode + un signe cunéiforme. Un filtrage
  // naïf `[^a-z0-9]` VIDERAIT la chaîne — d'où un nom écrit ici plutôt que dérivé.
  "x:1674730916139216897": "Haroldinho",
};

/**
 * Arbitrages OUVERTS, écrits nommément dans le JSON pour qu'on ne puisse pas les enterrer.
 * Rien n'est appliqué : le code signale et chiffre, il ne décide pas qui a une chance.
 */
const ARBITRAGES_OUVERTS: readonly { readonly sujet: string; readonly constat: string }[] = [
  {
    sujet: "règle 1 — « sur Twitter ou Instagram »",
    constat:
      "Cinq créations n'existent QUE sur Discord, sans pendant X ni Instagram. Discord n'est que le " +
      "salon de dépôt, pas une surface de publication citée par la règle. Prise à la lettre, cette " +
      "règle retire TOUTE chance à quatre personnes et fait passer Sanada de 2 œuvres à 1. Élément " +
      "aggravant : l'une d'elles possède un compte X qu'elle a elle-même lié deux fois depuis Discord, " +
      "et ne s'en est pas servie ici. Élément atténuant : aucun participant n'a publié en sachant " +
      "qu'un tirage existerait.",
  },
  {
    sujet: "un participant est aussi membre du staff",
    constat:
      "La personne qui a publié le rappel du règlement dans le salon de dépôt (ligne masquée en base, " +
      "motif renseigné) a par ailleurs une vraie création sur X, qui est comptée. Tout indique un " +
      "membre du staff, mais `x_campagnes.comptes_organisateurs` ne contient QUE `rose_griffon`, et " +
      "écarter quelqu'un sur une impression est exactement ce qu'un tirage vérifiable doit rendre " +
      "impossible. Si le staff ne doit pas concourir, c'est cette colonne qu'il faut compléter — pas " +
      "le roster qu'il faut bidouiller.",
  },
  {
    sujet: "aucun lot ni tirage n'a jamais été annoncé",
    constat:
      "Le règlement en base ne comporte que quatre règles, aucune mention de récompense. La mécanique " +
      "de tirage est NEUVE et rétroactive : les gens ont participé pour l'événement. Toute règle " +
      "d'éligibilité durcie après coup retirerait une chance à quelqu'un qui n'a jamais su qu'il en avait une.",
  },
  {
    sujet: "aucune borne basse de fenêtre",
    constat:
      "`x_campagnes.debut_le` est NULL sur cette campagne : il n'y a AUCUNE borne d'ouverture. Toute " +
      "création antérieure qui remonterait un jour à la collecte serait éligible. À surveiller.",
  },
];

// ───────────────────────── Lecture de la base ─────────────────────────
//
// ⚠ Le rôle `rg` est PROPRIÉTAIRE de ces tables : la RLS ne s'applique pas à lui. Les trois
// policies de lecture publique (`x_campagne_posts`, `campagne_creations_discord`,
// `campagne_creations_instagram`) sont donc RECOPIÉES à la main dans le `case` ci-dessous —
// `publiee`, `not masque`, `a_media`, `deleted_at is null`, `suivi`, la fenêtre, et les
// comptes organisateurs. Sans cette recopie, le règlement masqué du staff entrerait dans le
// roster et prendrait une chance à quelqu'un.
//
// La requête elle-même est `SQL_CREATIONS`, importée de
// `apps/website/src/lib/x-campagnes/sql-creations.ts` — c'est LA seule, partagée avec le site et
// avec le script d'empreintes.

/**
 * Le motif de masquage écrit par la modération, à part. Il précise « masquée par la
 * modération » — dire QUE c'est masqué sans dire POURQUOI transforme un arbitrage en décision
 * cachée dans la donnée.
 */
const SQL_MOTIFS_MASQUAGE = `
	select 'x'::text as source, tweet_id as identifiant, motif_masquage
	  from public.x_campagne_posts where campagne_slug = $1 and masque
	union all
	select 'discord', message_id, motif_masquage
	  from public.campagne_creations_discord where campagne_slug = $1 and masque
	union all
	select 'instagram', shortcode, motif_masquage
	  from public.campagne_creations_instagram where campagne_slug = $1 and masque`;

/** Les images déjà ré-hébergées, pour donner au JSON le `chemin` du fichier master. */
const SQL_IMAGES_STOCKEES = `
	select 'discord'::text as source, d.message_id as identifiant,
	       (im.ord - 1)::int as index, im.valeur ->> 'chemin' as chemin,
	       (im.valeur ->> 'largeur')::int as largeur, (im.valeur ->> 'hauteur')::int as hauteur
	  from public.campagne_creations_discord d
	  cross join lateral jsonb_array_elements(d.images) with ordinality as im(valeur, ord)
	 where d.campagne_slug = $1
	union all
	select 'instagram', i.shortcode, (im.ord - 1)::int, im.valeur ->> 'chemin',
	       (im.valeur ->> 'largeur')::int, (im.valeur ->> 'hauteur')::int
	  from public.campagne_creations_instagram i
	  cross join lateral jsonb_array_elements(i.images) with ordinality as im(valeur, ord)
	 where i.campagne_slug = $1`;

interface LigneCreation {
  source: string;
  identifiant: string;
  cle_identite: string | null;
  auteur_nom: string | null;
  auteur_pseudo: string | null;
  horodatage: Date | string | null;
  nb_images: number;
  permalien: string | null;
  motif_ecart: string | null;
}

/** Toute date sort en chaîne ISO : un `Date` sérialisé dépend du fuseau du process. */
function versISO(valeur: Date | string | null): string | null {
  if (valeur === null) return null;
  const d = valeur instanceof Date ? valeur : new Date(valeur);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function estSource(v: string): v is SourceTirage {
  return v === "x" || v === "discord" || v === "instagram";
}

// ───────────────────────── Construction du roster ─────────────────────────

const refCle = (r: RefCreation): string => `${r.source}:${r.identifiant}`;

interface CreationRetenue {
  source: SourceTirage;
  identifiant: string;
  cleIdentite: string;
  auteurNom: string | null;
  auteurPseudo: string | null;
  publieLe: string | null;
  nbImages: number;
  permalien: string | null;
}

interface OeuvreConstruite {
  oeuvreId: string;
  cle: string;
  creationGardee: RefCreation;
  creations: CreationRetenue[];
  nbCreations: number;
  groupe: string | null;
  motifRegroupement: string | null;
  imageMaster: { source: SourceTirage; identifiant: string; index: number; chemin: string | null } | null;
  empreintes: { sha256: string; dhash: string; phash: string; largeur: number; hauteur: number; octets: number } | null;
  distanceMax: GroupeMesure["distanceMax"] | null;
  /** Renseigné seulement quand fichiers ≠ œuvres — l'arbitrage le plus lourd, jamais tu. */
  arbitrageFichiers: { nbFichiers: number; motif: string } | null;
}

interface ParticipantConstruit {
  cle: string;
  pseudoAffichage: string;
  sources: SourceTirage[];
  identifiants: Record<string, string>;
  nbCreationsBrutes: number;
  premiereLe: string | null;
  derniereLe: string | null;
  oeuvres: string[];
  eligible: boolean;
  motifIneligible: string | null;
}

/** Identité de plateforme absorbée → clé canonique. Construite une fois, relue partout. */
const FUSION_VERS_CANONIQUE = new Map(FUSIONS_APPLIQUEES.map(f => [f.absorbee, f.cle]));

const canoniser = (cleIdentite: string): string => FUSION_VERS_CANONIQUE.get(cleIdentite) ?? cleIdentite;

/**
 * Appartenance de chaque création à un groupe mesuré. Construite une fois, et surtout
 * VÉRIFIÉE : un groupe dont une création a disparu de la base (démasquée, supprimée, ou
 * simplement jamais recollectée) est une table périmée, et un roster bâti dessus serait faux
 * sans le dire. On échoue plutôt.
 */
function indexerGroupes(retenues: ReadonlyMap<string, CreationRetenue>): {
  parCreation: Map<string, GroupeMesure>;
  anomalies: string[];
} {
  const parCreation = new Map<string, GroupeMesure>();
  const anomalies: string[] = [];
  for (const groupe of GROUPES_MESURES) {
    const manquantes = groupe.creations.filter(c => !retenues.has(refCle(c)));
    if (manquantes.length === groupe.creations.length) {
      // Groupe entièrement absent : la campagne n'est simplement pas celle-là.
      continue;
    }
    if (manquantes.length > 0) {
      anomalies.push(
        `groupe ${groupe.code} périmé : ${manquantes.map(refCle).join(", ")} ne figure(nt) plus parmi les créations retenues`,
      );
      continue;
    }
    if (!groupe.creations.some(c => refCle(c) === refCle(groupe.creationGardee))) {
      anomalies.push(`groupe ${groupe.code} : la création gardée n'est pas membre du groupe`);
      continue;
    }
    // Un même auteur des deux côtés : un groupe multi-auteurs serait un soupçon de vol de
    // dessin, pas un doublon, et ne doit surtout pas retirer une chance en silence.
    const identites = new Set(groupe.creations.map(c => retenues.get(refCle(c))?.cleIdentite ?? ""));
    const canoniques = new Set([...identites].map(i => FUSION_VERS_CANONIQUE.get(i) ?? i));
    if (canoniques.size > 1) {
      anomalies.push(`groupe ${groupe.code} : membres de personnes différentes (${[...canoniques].join(" / ")})`);
      continue;
    }
    for (const c of groupe.creations) parCreation.set(refCle(c), groupe);
  }
  return { anomalies, parCreation };
}

const empreintesParImage = new Map(IMAGES_MESUREES.map(i => [`${i.source}:${i.identifiant}#${i.index}`, i]));
const arbitragesParCreation = new Map(ARBITRAGES_FICHIERS.map(a => [`${a.source}:${a.identifiant}`, a]));

// ───────────────────────── Programme ─────────────────────────

const URL_BASE = Bun.env.DATABASE_URL;
if (!URL_BASE) throw new Error("DATABASE_URL manquant");
const sql = createBunSql({ url: URL_BASE });

const anomalies: string[] = [];

// 1. La campagne. Introuvable → on s'arrête ici plutôt que d'exporter un roster vide.
const [campagne] = await sql`
	select slug, titre, sur_titre, description, debut_le, fin_le, hashtags, hashtags_rattrapage,
	       hashtags_affichage, reglement, salons_depot, comptes_organisateurs, publiee, actif,
	       principale, collecte_le
	  from public.x_campagnes where slug = ${SLUG}`;
if (!campagne) {
  // Sortie terse plutôt qu'une trace de pile : ce n'est pas un défaut du script, c'est une
  // faute de frappe dans le slug, et une pile de vingt lignes la rend plus dure à voir.
  console.log(`roster campagne=${SLUG} echec=campagne-introuvable`);
  await sql.end();
  process.exit(1);
}

// 2. Les créations, retenues ET écartées, chacune motivée par la même requête — les deux
//    listes ne peuvent donc pas diverger.
const lignes = (await sql.unsafe(SQL_CREATIONS, [SLUG])) as unknown as LigneCreation[];
const motifsMasquage = new Map<string, string | null>(
  (
    (await sql.unsafe(SQL_MOTIFS_MASQUAGE, [SLUG])) as unknown as {
      source: string;
      identifiant: string;
      motif_masquage: string | null;
    }[]
  ).map(m => [`${m.source}:${m.identifiant}`, m.motif_masquage]),
);
const cheminsImages = new Map<string, string | null>(
  (
    (await sql.unsafe(SQL_IMAGES_STOCKEES, [SLUG])) as unknown as {
      source: string;
      identifiant: string;
      index: number;
      chemin: string | null;
    }[]
  ).map(i => [`${i.source}:${i.identifiant}#${i.index}`, i.chemin]),
);

const retenues = new Map<string, CreationRetenue>();
const ecartees: {
  source: string;
  identifiant: string;
  auteur_pseudo: string | null;
  publie_le: string | null;
  motif: string;
}[] = [];
for (const l of lignes) {
  if (!estSource(l.source)) {
    anomalies.push(`source inconnue en base : ${l.source}`);
    continue;
  }
  if (l.motif_ecart !== null || l.cle_identite === null) {
    const detail = motifsMasquage.get(`${l.source}:${l.identifiant}`);
    ecartees.push({
      auteur_pseudo: l.auteur_pseudo,
      identifiant: l.identifiant,
      // Le motif du `case` dit la RÈGLE, celui de la modération dit le FAIT : les deux.
      motif: detail
        ? `${l.motif_ecart ?? "sans identité exploitable"} — ${detail}`
        : (l.motif_ecart ?? "sans identité exploitable"),
      publie_le: versISO(l.horodatage),
      source: l.source,
    });
    continue;
  }
  retenues.set(`${l.source}:${l.identifiant}`, {
    auteurNom: l.auteur_nom,
    auteurPseudo: l.auteur_pseudo,
    cleIdentite: l.cle_identite,
    identifiant: l.identifiant,
    nbImages: Number(l.nb_images) || 1,
    permalien: l.permalien,
    publieLe: versISO(l.horodatage),
    source: l.source,
  });
}

// 3. Les ARBITRAGES déjà posés en base. `x_campagne_participants` n'est pas une copie de ce
//    que ce script recalcule : c'est là que vivent les décisions HUMAINES — le nom sous lequel
//    une personne veut apparaître, une éligibilité basculée avec son motif, une fusion établie
//    à la main que ni le pseudo ni l'empreinte ne donnaient. Les relire ici est ce qui empêche
//    l'export de contredire l'écran d'admin : mesuré, deux pseudos divergeaient avant ce bloc
//    (« kittycaillou » contre « kittycaillou / sigmimi »), et c'est la base qui a raison.
const tableParticipants = Number(
  (
    await sql`select count(*)::int as n from information_schema.tables
		           where table_schema = 'public' and table_name = 'x_campagne_participants'`
  )[0]?.n ?? 0,
);
interface ArbitrageBase {
  cle: string;
  pseudo_affichage: string;
  eligible: boolean;
  motif_ineligible: string | null;
  fusionne_dans: string | null;
  verrouille: boolean;
}
const arbitragesBase = new Map<string, ArbitrageBase>();
if (tableParticipants > 0) {
  const rangs = (await sql.unsafe(
    `select cle, pseudo_affichage, eligible, motif_ineligible, fusionne_dans, verrouille
		   from public.x_campagne_participants where campagne_slug = $1`,
    [SLUG],
  )) as unknown as ArbitrageBase[];
  for (const r of rangs) {
    arbitragesBase.set(r.cle, r);
    // Une fusion posée à la main s'ajoute aux fusions mesurées, sinon l'export rendrait
    // deux lignes à quelqu'un que l'admin vient tout juste de réunir en une seule.
    if (r.fusionne_dans) FUSION_VERS_CANONIQUE.set(r.cle, r.fusionne_dans);
  }
}

// 4. Les groupes de doublons. La table mesurée est le repli ; `x_campagne_oeuvres`, quand elle
//    existe et porte des lignes, fait autorité — c'est elle que l'écran d'admin corrige.
const oeuvresEnBase = Number(
  (
    await sql`select count(*)::int as n from information_schema.tables
		           where table_schema = 'public' and table_name = 'x_campagne_oeuvres'`
  )[0]?.n ?? 0,
);
const autoriteOeuvres = oeuvresEnBase > 0 ? "x_campagne_oeuvres" : "table mesurée du script";
/** Compté seulement si la table existe ; comparé plus bas, une fois les œuvres construites. */
const nbOeuvresEnBase =
  oeuvresEnBase > 0
    ? Number(
        (
          (await sql.unsafe("select count(*)::int as n from public.x_campagne_oeuvres where campagne_slug = $1", [
            SLUG,
          ])) as unknown as { n: number }[]
        )[0]?.n ?? 0,
      )
    : null;

const { anomalies: anomaliesGroupes, parCreation } = indexerGroupes(retenues);
anomalies.push(...anomaliesGroupes);

// 5. Une œuvre par groupe, plus une par création isolée.
const oeuvres = new Map<string, OeuvreConstruite>();
for (const [cle, creation] of retenues) {
  const groupe = parCreation.get(cle);
  const gardee: RefCreation = groupe
    ? groupe.creationGardee
    : { identifiant: creation.identifiant, source: creation.source };
  const oeuvreId = refCle(gardee);
  const deja = oeuvres.get(oeuvreId);
  if (deja) {
    deja.creations.push(creation);
    deja.nbCreations = deja.creations.length;
    continue;
  }
  const master = groupe
    ? groupe.imageMaster
    : { ...gardee, index: arbitragesParCreation.get(oeuvreId)?.imageMasterIndex ?? 0 };
  const mesure = empreintesParImage.get(`${master.source}:${master.identifiant}#${master.index}`);
  if (!mesure)
    anomalies.push(`image master sans empreinte mesurée : ${master.source}:${master.identifiant}#${master.index}`);
  const arbitrage = arbitragesParCreation.get(oeuvreId);
  oeuvres.set(oeuvreId, {
    arbitrageFichiers: arbitrage ? { motif: arbitrage.motif, nbFichiers: arbitrage.nbFichiers } : null,
    cle: canoniser(creation.cleIdentite),
    creationGardee: gardee,
    creations: [creation],
    distanceMax: groupe?.distanceMax ?? null,
    empreintes: mesure
      ? {
          dhash: mesure.dhash,
          hauteur: mesure.hauteur,
          largeur: mesure.largeur,
          octets: mesure.octets,
          phash: mesure.phash,
          sha256: mesure.sha256,
        }
      : null,
    groupe: groupe?.code ?? null,
    imageMaster: {
      ...master,
      chemin: cheminsImages.get(`${master.source}:${master.identifiant}#${master.index}`) ?? null,
    },
    motifRegroupement: groupe?.motif ?? null,
    nbCreations: 1,
    oeuvreId,
  });
}
// La clé porteuse est celle de la création GARDÉE, jamais celle de la dernière lue.
for (const oeuvre of oeuvres.values()) {
  const gardee = retenues.get(refCle(oeuvre.creationGardee));
  if (!gardee) {
    anomalies.push(`œuvre ${oeuvre.oeuvreId} : création gardée absente des créations retenues`);
    continue;
  }
  oeuvre.cle = canoniser(gardee.cleIdentite);
  oeuvre.creations.sort((a, b) => (a.publieLe ?? "").localeCompare(b.publieLe ?? ""));
}

// 6. Les personnes. Une ligne par identité CANONIQUE : les identités absorbées n'en ont pas.
const participants = new Map<string, ParticipantConstruit>();
for (const creation of retenues.values()) {
  const cle = canoniser(creation.cleIdentite);
  const existant = participants.get(cle);
  const p: ParticipantConstruit = existant ?? {
    cle,
    derniereLe: null,
    eligible: true,
    identifiants: {},
    motifIneligible: null,
    nbCreationsBrutes: 0,
    oeuvres: [],
    premiereLe: null,
    pseudoAffichage: "",
    sources: [],
  };
  p.nbCreationsBrutes += 1;
  if (!p.sources.includes(creation.source)) p.sources.push(creation.source);
  // L'identité de plateforme brute, source par source — écrite UNIQUEMENT dans `--complet`.
  const [plateforme, valeur] = [
    creation.cleIdentite.slice(0, creation.cleIdentite.indexOf(":")),
    creation.cleIdentite.slice(creation.cleIdentite.indexOf(":") + 1),
  ];
  p.identifiants[`${plateforme}_id`] = valeur;
  if (creation.auteurPseudo) p.identifiants[`${plateforme}_handle`] = creation.auteurPseudo;
  if (creation.publieLe) {
    if (p.premiereLe === null || creation.publieLe < p.premiereLe) p.premiereLe = creation.publieLe;
    if (p.derniereLe === null || creation.publieLe > p.derniereLe) p.derniereLe = creation.publieLe;
  }
  participants.set(cle, p);
}
for (const oeuvre of oeuvres.values()) {
  const p = participants.get(oeuvre.cle);
  if (!p) {
    anomalies.push(`œuvre ${oeuvre.oeuvreId} rattachée à une personne absente du roster (${oeuvre.cle})`);
    continue;
  }
  p.oeuvres.push(oeuvre.oeuvreId);
}
for (const p of participants.values()) {
  // Tris EN PLACE assumés : ces deux tableaux appartiennent au participant qu'on est en train
  // de finir de construire, personne d'autre ne les tient. L'ordre canonique des œuvres entre
  // dans le poids et dans le tirage de l'œuvre mise en avant — il ne doit pas dépendre de
  // l'ordre de lecture de la base.
  p.oeuvres.sort();
  p.sources.sort();
  // Le pseudo affiché : arbitré à la main quand la personne se présente sous un autre nom
  // que son handle technique, sinon le nom d'affichage de sa création la plus RÉCENTE — un
  // nom d'affichage change, le dernier connu est le moins faux.
  const siennes = [...retenues.values()]
    .filter(c => canoniser(c.cleIdentite) === p.cle)
    .toSorted((a, b) => (a.publieLe ?? "").localeCompare(b.publieLe ?? ""));
  const derniere = siennes.at(-1);
  const arbitre = arbitragesBase.get(p.cle);
  p.pseudoAffichage =
    arbitre?.pseudo_affichage ??
    PSEUDOS_RETENUS[p.cle] ??
    (derniere?.auteurNom || derniere?.auteurPseudo || p.cle.slice(p.cle.indexOf(":") + 1));
  // Écarter quelqu'un est une DÉCISION, jamais une sortie de script : elle ne peut venir que
  // de la table, où le CHECK `x_campagne_participants_motif_si_ineligible` interdit qu'elle
  // soit prise sans motif écrit. En l'absence de table, tout le monde concourt.
  if (arbitre && !arbitre.eligible) {
    p.eligible = false;
    p.motifIneligible = arbitre.motif_ineligible;
  }
}

// 7. Poids et empreinte canonique — calculés par le NOYAU, jamais réimplémentés ici.
const pourTirage: ParticipantTirage[] = [...participants.values()]
  .filter(p => p.eligible)
  .map(p => ({ cle: p.cle, nbOeuvres: p.oeuvres.length, oeuvres: [...p.oeuvres], pseudoAffichage: p.pseudoAffichage }));
const empreinteParOeuvre = await empreinteRoster(rosterDe(pourTirage, "par_oeuvre"));
const empreinteUnParPersonne = await empreinteRoster(rosterDe(pourTirage, "un_par_personne"));
const empreinteCourante = POIDS_MODE === "par_oeuvre" ? empreinteParOeuvre : empreinteUnParPersonne;

// 8. Contrôles de traçabilité. Chacun protège une façon précise de se tromper.
const sommeOeuvres = [...participants.values()].reduce((n, p) => n + p.oeuvres.length, 0);
const sommeBrutes = [...participants.values()].reduce((n, p) => n + p.nbCreationsBrutes, 0);
if (sommeOeuvres !== oeuvres.size)
  anomalies.push(`Σ nb_oeuvres = ${sommeOeuvres} ≠ ${oeuvres.size} œuvres construites`);
if (sommeBrutes !== retenues.size)
  anomalies.push(`Σ nb_creations_brutes = ${sommeBrutes} ≠ ${retenues.size} créations retenues`);
if (retenues.size + ecartees.length !== lignes.length) {
  anomalies.push(`${retenues.size} retenues + ${ecartees.length} écartées ≠ ${lignes.length} créations brutes`);
}
if (nbOeuvresEnBase !== null && nbOeuvresEnBase !== oeuvres.size) {
  anomalies.push(
    `x_campagne_oeuvres porte ${nbOeuvresEnBase} œuvre(s) là où le script en construit ${oeuvres.size} — ` +
      `la collecte est plus récente que les empreintes : relancer le calcul avant de tirer`,
  );
}
// Une identité absorbée qui reprendrait une ligne, et la personne aurait deux fois ses tickets.
for (const f of FUSIONS_APPLIQUEES) {
  if (participants.has(f.absorbee)) anomalies.push(`identité fusionnée revenue dans le roster : ${f.absorbee}`);
  if (arbitragesBase.size > 0 && arbitragesBase.has(f.absorbee) && !arbitragesBase.get(f.absorbee)?.fusionne_dans) {
    anomalies.push(`${f.absorbee} a une ligne CANONIQUE en base alors que le script la fusionne dans ${f.cle}`);
  }
  if (![...retenues.values()].some(c => canoniser(c.cleIdentite) === f.cle) && participants.has(f.cle)) {
    anomalies.push(`clé canonique sans création retenue : ${f.cle}`);
  }
}
// La table des participants, quand elle existe, doit dire EXACTEMENT la même chose.
const nbEnBase =
  tableParticipants > 0 ? [...arbitragesBase.values()].filter(r => r.fusionne_dans === null).length : null;
if (nbEnBase !== null && nbEnBase !== participants.size) {
  anomalies.push(
    `x_campagne_participants porte ${nbEnBase} personne(s) canonique(s) contre ${participants.size} construite(s)`,
  );
}
// Une clé construite qui n'existe pas en base = un participant que l'écran d'admin ne voit pas.
for (const cle of participants.keys()) {
  if (tableParticipants > 0 && !arbitragesBase.has(cle))
    anomalies.push(`personne absente de x_campagne_participants : ${cle}`);
}

// 9. Le document. Les personnes sont désignées par leur `cle_publique` — sauf en `--complet`.
const clesDuRoster = [...participants.keys()];
const clesPubliques = new Map(
  // `clePublique` est asynchrone (WebCrypto) : les 14 dérivations partent ensemble plutôt
  // qu'en file d'attente. Elles sont indépendantes, l'ordre du tableau est conservé.
  (await Promise.all(clesDuRoster.map(cle => clePublique(SLUG, cle)))).map((pub, i) => [
    clesDuRoster[i] as string,
    pub,
  ]),
);

const ordonnees = [...participants.values()].toSorted(
  (a, b) => b.oeuvres.length - a.oeuvres.length || (a.premiereLe ?? "").localeCompare(b.premiereLe ?? ""),
);

/** Toujours la clé publique dans le document committé : la clé de plateforme n'apparaît qu'en `--complet`. */
const designer = (cle: string): Record<string, string> =>
  COMPLET ? { cle, cle_publique: clesPubliques.get(cle) ?? "" } : { cle_publique: clesPubliques.get(cle) ?? "" };

/**
 * Un côté de suggestion de fusion. Une clé de participant est pseudonymisée comme partout
 * ailleurs ; une référence qui n'est qu'un HANDLE public (`x:JennScarlet87`, `x:Kiran_inazuma`)
 * reste en clair — il n'y a rien à protéger dans un pseudo que son porteur affiche lui-même, et
 * l'anonymiser rendrait la suggestion invérifiable.
 */
const designerCote = (reference: string): Record<string, string> =>
  participants.has(reference) ? designer(reference) : { reference };

const document = {
  avertissement:
    "Fichier GÉNÉRÉ par scripts/campagnes/exporter-participants.ts. Ne jamais l'éditer à la main : " +
    "il est reconstruit à chaque collecte et toute correction manuelle serait écrasée sans bruit. " +
    "Un arbitrage se pose dans x_campagne_participants (colonnes eligible, motif_ineligible, " +
    "fusionne_dans, verrouille), pas ici.",
  campagne: {
    collecte_le: versISO(campagne.collecte_le),
    comptes_organisateurs: campagne.comptes_organisateurs,
    debut_le: versISO(campagne.debut_le),
    fin_le: versISO(campagne.fin_le),
    hashtags: campagne.hashtags,
    hashtags_affichage: campagne.hashtags_affichage,
    hashtags_rattrapage: campagne.hashtags_rattrapage,
    publiee: campagne.publiee,
    reglement: campagne.reglement,
    salons_depot: campagne.salons_depot,
    slug: campagne.slug,
    sur_titre: campagne.sur_titre,
    titre: campagne.titre,
  },
  comptages: {
    creations_brutes: lignes.length,
    creations_ecartees: ecartees.length,
    creations_retenues: retenues.size,
    fusions_appliquees: FUSIONS_APPLIQUEES.filter(f => participants.has(f.cle)).length,
    identites_de_plateforme_retenues: new Set([...retenues.values()].map(c => c.cleIdentite)).size,
    images: IMAGES_MESUREES.length,
    oeuvres: oeuvres.size,
    oeuvres_regroupees: [...oeuvres.values()].filter(o => o.nbCreations > 1).length,
    personnes: participants.size,
    personnes_eligibles: [...participants.values()].filter(p => p.eligible).length,
    poids_total: pourTirage.reduce((n, p) => n + poidsDe(p, POIDS_MODE), 0),
  },
  genere_le: new Date().toISOString(),
  genere_par: "scripts/campagnes/exporter-participants.ts",
  // L'empreinte de roster est ce que le message d'engagement publiera : elle scelle QUI
  // concourt et avec combien de tickets, AVANT que le round d'aléa public ne tombe.
  empreinte: {
    autorite_arbitrages: tableParticipants > 0 ? "x_campagne_participants" : "table mesurée du script",
    autorite_oeuvres: autoriteOeuvres,
    note:
      "sha256 de la sérialisation canonique à préfixe de longueur du roster (domaine RGROSTER1), " +
      "calculée par empreinteRoster() du noyau. Indépendante de l'ordre d'arrivée, insensible à la " +
      "forme de normalisation Unicode du pseudo — qui n'y entre pas : corriger une orthographe ne " +
      "doit pas détruire une preuve.",
    par_oeuvre: empreinteParOeuvre,
    poids_mode: POIDS_MODE,
    roster: empreinteCourante,
    un_par_personne: empreinteUnParPersonne,
  },
  participants: ordonnees.map(p => ({
    ...designer(p.cle),
    derniere_le: p.derniereLe,
    eligible: p.eligible,
    ...(COMPLET ? { identifiants: p.identifiants } : {}),
    motif_ineligible: p.motifIneligible,
    nb_creations_brutes: p.nbCreationsBrutes,
    nb_oeuvres: p.oeuvres.length,
    oeuvres: p.oeuvres,
    poids: poidsDe(
      { cle: p.cle, nbOeuvres: p.oeuvres.length, oeuvres: p.oeuvres, pseudoAffichage: p.pseudoAffichage },
      POIDS_MODE,
    ),
    premiere_le: p.premiereLe,
    pseudo_affichage: p.pseudoAffichage,
    sources: p.sources,
  })),
  oeuvres: [...oeuvres.values()]
    .toSorted((a, b) => a.oeuvreId.localeCompare(b.oeuvreId))
    .map(o => ({
      ...designer(o.cle),
      arbitrage_fichiers: o.arbitrageFichiers
        ? { motif: o.arbitrageFichiers.motif, nb_fichiers: o.arbitrageFichiers.nbFichiers }
        : null,
      creation_gardee: { identifiant: o.creationGardee.identifiant, source: o.creationGardee.source },
      // LES PUBLICATIONS QUI PORTENT L'ŒUVRE : c'est ce qui justifie le dédoublonnage.
      // Pseudos et identifiants de publication sont déjà affichés sur la galerie publique.
      creations: o.creations.map(c => ({
        auteur_pseudo: c.auteurPseudo,
        identifiant: c.identifiant,
        nb_fichiers: c.nbImages,
        permalien: c.permalien,
        publie_le: c.publieLe,
        source: c.source,
      })),
      // Aplati en snake_case comme tout le reste du document : un seul objet en camelCase
      // et le consommateur doit se souvenir lequel.
      distance_max: o.distanceMax
        ? {
            dhash: o.distanceMax.dhash,
            ecart_recadrage: o.distanceMax.ecartRecadrage,
            phash: o.distanceMax.phash,
            phash_centre: o.distanceMax.phashCentre,
          }
        : null,
      empreintes: o.empreintes,
      groupe: o.groupe,
      image_master: o.imageMaster,
      motif_regroupement: o.motifRegroupement,
      nb_creations: o.nbCreations,
      oeuvre_id: o.oeuvreId,
    })),
  creations_ecartees: ecartees,
  fusions_appliquees: FUSIONS_APPLIQUEES.filter(f => participants.has(f.cle)).map(f => ({
    ...designer(f.cle),
    ...(COMPLET ? { identite_absorbee: f.absorbee } : {}),
    niveau_de_preuve: f.niveau,
    preuve: f.preuve,
  })),
  // ⚠ Les DEUX côtés passent par `designerCote()` : une suggestion cite forcément une clé de
  // participant, et la laisser en clair rouvrirait par la bande le graphe d'identités que
  // `designer()` referme partout ailleurs. Vérifié à l'exécution — sans ce passage, deux
  // snowflakes Discord ressortaient dans le fichier committé.
  fusions_suggerees_non_appliquees: FUSIONS_SUGGEREES.map(f => ({
    confiance: f.confiance,
    droite: designerCote(f.droite),
    effet_sur_les_comptages: f.effetSurLesComptages,
    gauche: designerCote(f.gauche),
    indice: f.indice,
  })),
  arbitrages_ouverts: ARBITRAGES_OUVERTS,
  seuil_doublon: {
    ...SEUIL_DOUBLON,
    note:
      "Conjonction obligatoire dHash ≤ 8 ET pHash ≤ 8. Sur les 351 paires des 27 images, la " +
      "distribution est bimodale : dHash intra-groupe max 2 / inter-groupe min 17, pHash intra 2 / " +
      "inter 20. Les 27 sha256 sont TOUS DISTINCTS — une déduplication octet à octet aurait trouvé " +
      "zéro doublon et attribué quatre chances de trop, X ré-encodant systématiquement en JPEG.",
  },
  anomalies,
};

// 10. Écriture. Clés triées et indentation 2 : deux exécutions sans changement de données
//    produisent le même fichier, donc un diff git ne montre que ce qui a vraiment bougé.
/** La date de génération change à chaque exécution : la comparaison porte sur tout le reste. */
const sansDate = (t: string): string => t.replace(/"genere_le": "[^"]*"/, '"genere_le": "-"');

function trierCles(valeur: unknown): unknown {
  if (Array.isArray(valeur)) return valeur.map(trierCles);
  if (valeur && typeof valeur === "object" && !(valeur instanceof Date)) {
    const source = valeur as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(source)
        .toSorted()
        .map(k => [k, trierCles(source[k])]),
    );
  }
  return valeur;
}

const nomDefaut = `${DOSSIER_SORTIE}/${SLUG}-roster${COMPLET ? "-complet" : ""}.json`;
const chemin = option("--sortie") ?? nomDefaut;
const contenu = `${JSON.stringify(trierCles(document), null, 2)}\n`;

let octets = 0;
if (VERIFIER) {
  const surDisque = await Bun.file(chemin)
    .text()
    .catch(() => "");
  if (sansDate(surDisque) !== sansDate(contenu))
    anomalies.push(`le fichier sur disque diffère du roster recalculé : ${chemin}`);
  octets = surDisque.length;
} else {
  await Bun.write(chemin, contenu);
  octets = contenu.length;
}

if (JSON_SORTIE) console.log(contenu.trimEnd());
console.log(
  `roster campagne=${SLUG} personnes=${participants.size} eligibles=${document.comptages.personnes_eligibles} ` +
    `oeuvres=${oeuvres.size} regroupees=${document.comptages.oeuvres_regroupees} retenues=${retenues.size} ` +
    `brutes=${lignes.length} ecartees=${ecartees.length} fusions=${document.comptages.fusions_appliquees} ` +
    `poids_mode=${POIDS_MODE} poids_total=${document.comptages.poids_total} empreinte=${empreinteCourante.slice(0, 16)} ` +
    `autorite=${autoriteOeuvres === "x_campagne_oeuvres" ? "base" : "script"} ` +
    `participants_en_base=${nbEnBase ?? "table-absente"} fichier=${chemin} octets=${octets} ` +
    `mode=${VERIFIER ? "verification" : COMPLET ? "complet" : "public"} anomalies=${anomalies.length}`,
);
for (const a of anomalies) console.log(`anomalie ${a}`);

await sql.end();
if (anomalies.length) process.exitCode = 1;
