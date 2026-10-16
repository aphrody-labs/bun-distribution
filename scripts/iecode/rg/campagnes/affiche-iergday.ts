// Correction typographique de l'affiche du concours #IERGday.
//
// POURQUOI
// L'affiche v2 fournie par l'association (917 x 1268) écrit « 22 aout 2026 » dans le bloc
// « Date de fin : » en haut à droite : il manque l'accent circonflexe d'« août ». Tout le
// reste est juste — en particulier le hashtag « #IERGday » de cette version, qui corrigeait
// déjà la coquille « #InazumaRGday » de la v1.
//
// MÉTHODE — et pourquoi pas la méthode évidente
// Il n'existe AUCUN décor vierge de la v2 (elle a été recomposée) : impossible de rejouer une
// ligne entière par-dessus un fond propre. Reste la voie « repeindre l'aplat puis redessiner
// la ligne »… qui suppose de connaître la police. Elle n'est pas connue : 299 fichiers de
// police (~110 familles Google Fonts + clones Arial/Calibri + les polices du dépôt) ont été
// essayés au dixième de corps, avec interlettrage, faux gras et échelle horizontale ; le
// meilleur résidu reste 0,154 alors que le plancher de bruit du comparateur est 0,015–0,026.
// Redessiner la ligne changerait donc VISIBLEMENT la typo (les « 2 », le « 0 » et le « a » se
// voient en A/B). C'est une police propriétaire d'outil de mise en page, pas une Google Font.
//
// D'où la retouche minimale retenue : « û » est, dans toutes les polices, un glyphe COMPOSITE
// (le « u » inchangé + un accent posé au-dessus). Il ne manque donc que l'accent, et lui seul
// est dessiné, dans une fenêtre d'aplat bleu vérifiée pure. Trois conséquences heureuses :
//   - aucun glyphe existant n'est retouché, donc la typo d'origine est conservée telle quelle ;
//   - la chasse de « û » est celle de « u » : la ligne ne s'élargit pas, son bord droit
//     (aligné à droite, x = 844) ne bouge pas d'un pixel ;
//   - il n'y a rien à effacer : la fenêtre est déjà de l'aplat pur, on n'y ajoute que de l'encre.
//
// SOURCE DE VÉRITÉ
// Toutes les constantes ci-dessous sont MESURÉES sur `affiche-v2.png` (seuillage sur la
// couverture d'encre, pas d'estimation à l'œil). Le script re-vérifie à l'exécution les deux
// hypothèses dont dépend le résultat : la fenêtre est bien un aplat parfaitement uni, et aucun
// pixel n'est modifié en dehors d'elle. Il échoue plutôt que de produire une affiche douteuse.
//
// USAGE
//   bun scripts/campagnes/affiche-iergday.ts --source <affiche-v2.png> [--sortie <png>] [--json]
//
// La sortie par défaut est le fichier source suffixé « -corrigee ».

import { basename, dirname, join } from "node:path";

// ───────────────────────────── Fichiers et palette ─────────────────────────────

/** Couleurs relevées au pixel sur l'affiche — jamais supposées. L'aplat du bandeau est
 *  exactement (49, 87, 147) : écart-type 0,000 sur les trois canaux dans toutes les bandes
 *  testées autour du bloc. Le texte de la date est exactement (252, 236, 155) sur 1 847 px
 *  d'aplat pur ; les deux autres lignes du bloc sont en blanc pur. */
const COULEURS = {
  fond: { css: "#315793", rvb: [49, 87, 147] },
  dateJaune: { css: "#fcec9b", rvb: [252, 236, 155] },
  texteBlanc: { css: "#ffffff", rvb: [255, 255, 255] },
} as const;

// ───────────────────────────── Le bloc de texte mesuré ─────────────────────────────

interface LigneMesuree {
  /** Le texte VOULU (donc « août » accentué), pas forcément celui qui est imprimé. */
  readonly texte: string;
  /** Boîte d'encre relevée sur l'affiche : x1..x2, y1..y2 inclus. */
  readonly encre: { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number };
  readonly couleur: keyof typeof COULEURS;
}

/** Bloc « Date de fin : », coin haut-droit. Les trois lignes sont ALIGNÉES À DROITE
 *  (bords droits 843 / 844 / 843) et non centrées : c'est pour ça qu'ajouter un accent ne
 *  doit surtout pas déplacer quoi que ce soit horizontalement. Interligne constant : 33 px
 *  (lignes de base ≈ 86,5 / 119,5 / 152,5). */
const BLOC_DATE_DE_FIN = {
  alignement: "droite",
  bordDroit: 844,
  interligne: 33,
  lignes: [
    { texte: "Date de fin :", encre: { x1: 687, y1: 64, x2: 843, y2: 86 }, couleur: "texteBlanc" },
    { texte: "22 août 2026", encre: { x1: 631, y1: 95, x2: 844, y2: 119 }, couleur: "dateJaune" },
    { texte: "23h59 (FR)", encre: { x1: 704, y1: 131, x2: 843, y2: 155 }, couleur: "texteBlanc" },
  ] satisfies LigneMesuree[],
} as const;

/** Dimensions exactes de l'affiche v2. Toutes les mesures ci-dessous n'ont de sens que dans
 *  ce repère : le script refuse toute image d'un autre format. */
const AFFICHE = { largeur: 917, hauteur: 1268 } as const;

/** Sommet de la hauteur d'x de la ligne de date : première ligne d'encre du « a », du « o » et
 *  du « u » (les chiffres et le « t », eux, montent jusqu'à y = 95). C'est la limite basse de
 *  l'espace libre où l'accent peut se poser. */
const SOMMET_HAUTEUR_X = 100;

/** Découpage en glyphes de la ligne de date, relevé colonne par colonne. Sert à savoir
 *  exactement où se trouve le « u » à coiffer, et où commencent ses voisins (le « o » finit
 *  en 718, le fût du « t » démarre en 742 : la fenêtre de dessin doit rester entre les deux). */
const GLYPHES_DATE = {
  "2": { x1: 631, x2: 649 },
  "2 (2e)": { x1: 651, x2: 669 },
  a: { x1: 681, x2: 697 },
  o: { x1: 699, x2: 718 },
  u: { x1: 720, x2: 737 },
  t: { x1: 739, x2: 752 },
  "20": { x1: 764, x2: 803 },
  "2 (3e)": { x1: 806, x2: 824 },
  "6": { x1: 826, x2: 844 },
} as const;

// ───────────────────────────── La police de substitution ─────────────────────────────

/** Karla SemiBold. Ce n'est PAS la police de l'affiche (aucune des 299 essayées ne l'est),
 *  c'est sa meilleure approximation disponible : résidu 0,153 contre 0,158 pour la deuxième
 *  et ≥ 0,42 pour Google Sans Flex (la police du dépôt) une fois instanciée en statique.
 *  On ne lui emprunte que le circonflexe — 14 x 8 px. Contre-épreuve : les six familles les
 *  mieux classées (Karla, Noto Sans, Open Sans, Manrope, Montserrat, Figtree), recalées chacune
 *  sur la hauteur d'x et le fût mesurés, dessinent toutes le même accent à ±1 px près
 *  (13 à 15 de large, 5 à 8 de haut) — le choix de la police ne décide donc pas du résultat.
 *
 *  PROVENANCE DU FICHIER `polices/karla-600.ttf` (27 Ko, SIL OFL, notice et URL de licence
 *  conservées dans la table `name`) : instance STATIQUE servie par l'API Google Fonts,
 *      curl -A "Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)" \
 *           "https://fonts.googleapis.com/css2?family=Karla:wght@600"   # → URL du .ttf
 *  L'UA hérité fait servir un TTF statique plutôt que le woff2 variable ; c'est indispensable
 *  car @aphrody/canvas (moteur Skia) N'APPLIQUE PAS l'axe `wght` d'une police variable
 *  (wght 300..800 rendent tous la même chasse). Équivalent hors ligne à partir de la variable :
 *      fonttools varLib.instancer "Karla[wght].ttf" wght=600 -o karla-600.ttf
 *  Vérification faite : le fichier livré n'a pas de table `fvar` et annonce usWeightClass 600.
 *
 *  CORPS ET FAUX GRAS : 35,5 px et 0,4 px de trait sont les valeurs qui reproduisent le mieux
 *  la ligne réelle (boîte d'encre obtenue 631, 95, 214 x 25 contre 631, 95, 213 x 25 mesurée).
 *  Elles ne sont pas choisies « parce que ça rend bien » mais parce qu'elles calent la hauteur
 *  d'x (19,7 px) et le fût (4,73 px) de l'affiche. */
const POLICE = {
  fichier: "polices/karla-600.ttf",
  nom: "karla-600",
  corps: 35.5,
  fauxGras: 0.4,
} as const;

// ───────────────────────────── Les retouches ─────────────────────────────

interface Retouche {
  readonly nom: string;
  /** Ce qui est réellement dessiné. Le glyphe est tracé en entier puis découpé par `fenetre`,
   *  si bien que seule la partie voulue atteint l'image (ici : l'accent, le « u » de « û »
   *  tombant sous le bord bas de la fenêtre). */
  readonly texte: string;
  readonly couleur: keyof typeof COULEURS;
  /** Ligne de base en pixels image. 118,1 et non 119,5 : c'est la valeur qui fait coïncider
   *  le « u » de Karla avec le « u » imprimé (ajustée en minimisant l'écart sur le mot entier).
   *  L'accent hérite donc du bon décalage vertical au lieu d'un décalage nominal. */
  readonly ligneDeBase: number;
  /** Abscisse visée pour le centre de gravité de l'encre de l'accent. 729,0 = milieu du « u »
   *  imprimé (encre x 720..737, donc l'intervalle continu [720, 738)) ; son centre de gravité
   *  réel vaut 728,93 sans la queue et 729,10 avec — les deux encadrent 729,0. Le script mesure
   *  l'accent hors écran au sous-pixel et l'aligne dessus : aucune abscisse n'est codée en dur. */
  readonly centreCible: number;
  /** Seule zone de l'image où des pixels ont le droit de changer. x 716..741, y 87..99 :
   *  338 px, tous exactement (49, 87, 147) — aplat parfaitement uni, donc invisible à la
   *  retouche. Bornée à droite par le fût du « t » (qui commence en x = 742, dès y = 95),
   *  en bas par le sommet du « u » (y = 100), en haut par la ligne « Date de fin : »
   *  (dernière encre en y = 86). */
  readonly fenetre: { readonly x: number; readonly y: number; readonly largeur: number; readonly hauteur: number };
  /** Garde-fous : au-delà, le script refuse d'écrire (police manquante, remplacement muet
   *  par une police de repli, mauvaise version de l'affiche…). */
  readonly attendu: {
    readonly largeur: readonly [number, number];
    readonly hauteur: readonly [number, number];
    readonly pixelsModifies: readonly [number, number];
  };
}

const RETOUCHES: readonly Retouche[] = [
  {
    nom: "accent circonflexe d'« août » (ligne « 22 aout 2026 »)",
    texte: "û",
    couleur: "dateJaune",
    ligneDeBase: 118.1,
    centreCible: (GLYPHES_DATE.u.x1 + GLYPHES_DATE.u.x2 + 1) / 2,
    fenetre: { x: 716, y: 87, largeur: 26, hauteur: 13 },
    attendu: { largeur: [11, 16], hauteur: [6, 10], pixelsModifies: [30, 160] },
  },
];

// ───────────────────────────── Outillage ─────────────────────────────

const RACINE = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const ICI = new URL(".", import.meta.url).pathname.replace(/\/$/, "");

interface Contexte2D {
  drawImage(image: unknown, x: number, y: number): void;
  save(): void;
  restore(): void;
  beginPath(): void;
  rect(x: number, y: number, l: number, h: number): void;
  clip(): void;
  fillRect(x: number, y: number, l: number, h: number): void;
  fillText(texte: string, x: number, y: number): void;
  strokeText(texte: string, x: number, y: number): void;
  getImageData(x: number, y: number, l: number, h: number): { data: Uint8ClampedArray };
  font: string;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  lineJoin: string;
  textBaseline: string;
}
interface Canevas {
  getContext(type: "2d"): Contexte2D;
  toBuffer(type: "image/png"): Uint8Array;
}
interface ImageChargee {
  width: number;
  height: number;
}
interface ModuleCanvas {
  createCanvas(l: number, h: number): Canevas;
  loadImage(chemin: string): Promise<ImageChargee>;
  GlobalFonts: { registerFromPath(chemin: string, alias: string): boolean };
}

/** @aphrody/canvas est déclaré par `@rose-griffon/bot` (catalog: du dépôt) et non à la
 *  racine : on tente la résolution normale, puis celle depuis le workspace qui le porte.
 *  Aucune installation n'est déclenchée (le Bun local écrirait un lockfile v2 illisible par la CI). */
async function chargerCanvas(): Promise<ModuleCanvas> {
  try {
    return (await import("@aphrody/canvas")) as unknown as ModuleCanvas;
  } catch {
    const chemin = Bun.resolveSync("@aphrody/canvas", join(RACINE, "apps/rg-bot"));
    return (await import(chemin)) as unknown as ModuleCanvas;
  }
}

/** Couverture d'encre d'un pixel : 0 = aplat de fond, 1 = couleur de texte pleine.
 *  Le mélange de l'affiche est un fondu exact entre ces deux couleurs (α cohérent sur R, G et B
 *  au centième), donc moyenner deux canaux suffit et évite le bruit du troisième. */
function couverture(px: Uint8ClampedArray, indice: number, encre: readonly number[]): number {
  const f = COULEURS.fond.rvb;
  const a = (px[indice]! - f[0]!) / (encre[0]! - f[0]!);
  const b = (px[indice + 1]! - f[1]!) / (encre[1]! - f[1]!);
  return Math.min(1, Math.max(0, (a + b) / 2));
}

const SEUIL_ENCRE = 0.28; // même seuil que les mesures d'origine : la boîte d'encre est stable de 0,04 à 0,8

// ───────────────────────────── Programme ─────────────────────────────

const args = Bun.argv.slice(2);
const lireOption = (nom: string) => {
  const i = args.indexOf(nom);
  return i >= 0 ? args[i + 1] : undefined;
};
const enJson = args.includes("--json");
const source = lireOption("--source") ?? Bun.env.AFFICHE_SOURCE;
if (!source) {
  console.error("usage : bun scripts/campagnes/affiche-iergday.ts --source <affiche.png> [--sortie <png>] [--json]");
  process.exit(2);
}
const sortie =
  lireOption("--sortie") ?? join(dirname(source), `${basename(source).replace(/\.png$/i, "")}-corrigee.png`);

const { createCanvas, loadImage, GlobalFonts } = await chargerCanvas();
if (!GlobalFonts.registerFromPath(join(ICI, POLICE.fichier), POLICE.nom)) {
  console.error(`police introuvable ou refusée : ${join(ICI, POLICE.fichier)}`);
  process.exit(1);
}

const image = await loadImage(source);
if (image.width !== AFFICHE.largeur || image.height !== AFFICHE.hauteur) {
  console.error(
    `format inattendu : ${image.width}x${image.height}, attendu ${AFFICHE.largeur}x${AFFICHE.hauteur} — les mesures ne s'appliquent pas`,
  );
  process.exit(1);
}
const LARGEUR = AFFICHE.largeur;
const HAUTEUR = AFFICHE.hauteur;
const toile = createCanvas(LARGEUR, HAUTEUR);
const ctx = toile.getContext("2d");
ctx.drawImage(image, 0, 0);

const rapport: Record<string, unknown>[] = [];

for (const retouche of RETOUCHES) {
  const encre = COULEURS[retouche.couleur].rvb;
  const f = retouche.fenetre;
  // L'état de référence est relu à CHAQUE retouche : avec plusieurs retouches, comparer à
  // l'image d'origine ferait passer les précédentes pour des débordements.
  const avant = ctx.getImageData(0, 0, LARGEUR, HAUTEUR).data;

  // 1. L'aplat de la fenêtre est-il vraiment uni ? (sinon le rectangle retouché se verrait)
  let horsAplat = 0;
  for (let y = f.y; y < f.y + f.hauteur; y++)
    for (let x = f.x; x < f.x + f.largeur; x++) {
      const i = (y * LARGEUR + x) * 4;
      if (
        avant[i] !== COULEURS.fond.rvb[0] ||
        avant[i + 1] !== COULEURS.fond.rvb[1] ||
        avant[i + 2] !== COULEURS.fond.rvb[2]
      )
        horsAplat++;
    }
  if (horsAplat > 0) {
    console.error(`fenêtre non uniforme (${horsAplat} px hors aplat) — affiche inattendue, rien n'est écrit`);
    process.exit(1);
  }

  // 2. Où tombe l'accent par rapport à l'origine de dessin ? Mesuré hors écran sur la police
  //    elle-même : on compare « û » à « u » et on ne garde que ce qui dépasse au-dessus.
  const L = 160;
  const H = 120;
  const OX = 60;
  const OY = 90;
  const essai = createCanvas(L, H);
  const ec = essai.getContext("2d");
  const tracer = (texte: string, x: number) => {
    ec.fillStyle = "#000000";
    ec.fillRect(0, 0, L, H);
    ec.font = `${POLICE.corps}px "${POLICE.nom}"`;
    ec.textBaseline = "alphabetic";
    ec.fillStyle = "#ffffff";
    ec.strokeStyle = "#ffffff";
    ec.lineJoin = "round";
    if (POLICE.fauxGras > 0) {
      ec.lineWidth = POLICE.fauxGras;
      ec.strokeText(texte, x, OY);
    }
    ec.fillText(texte, x, OY);
    return ec.getImageData(0, 0, L, H).data;
  };
  const sansAccent = tracer(retouche.texte.normalize("NFD").replace(/\p{M}/gu, ""), OX);
  let sommetBase = H;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < L; x++) if (sansAccent[(y * L + x) * 4]! / 255 > SEUIL_ENCRE && y < sommetBase) sommetBase = y;

  //    Le centrage se fait sur le centre de GRAVITÉ de l'encre (sous-pixel) et non sur la boîte
  //    englobante : à 13 px de large, un centrage à la boîte se trompe d'un demi-pixel entier.
  //    Le rendu n'étant pas invariant par translation fractionnaire (la rastérisation change de
  //    phase), on itère : on redessine à la phase trouvée jusqu'à ce que le centre ne bouge plus.
  const centreDeGravite = (x: number) => {
    const px = tracer(retouche.texte, x);
    let masse = 0;
    let moment = 0;
    for (let y = 0; y < sommetBase; y++)
      for (let cx = 0; cx < L; cx++) {
        const c = px[(y * L + cx) * 4]! / 255;
        masse += c;
        moment += c * (cx + 0.5);
      }
    return { masse, centre: moment / masse };
  };
  let origineX = OX;
  for (let passe = 0; passe < 4; passe++) {
    const m = centreDeGravite(OX + (origineX - Math.round(origineX)));
    if (m.masse < 1) {
      console.error("la police ne fournit pas d'accent pour ce glyphe — probable substitution muette");
      process.exit(1);
    }
    const suivant = retouche.centreCible - (m.centre - (OX + (origineX - Math.round(origineX))));
    if (Math.abs(suivant - origineX) < 0.01) {
      origineX = suivant;
      break;
    }
    origineX = suivant;
  }

  // 3. Dessin, strictement découpé à la fenêtre.
  ctx.save();
  ctx.beginPath();
  ctx.rect(f.x, f.y, f.largeur, f.hauteur);
  ctx.clip();
  ctx.font = `${POLICE.corps}px "${POLICE.nom}"`;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = COULEURS[retouche.couleur].css;
  ctx.strokeStyle = COULEURS[retouche.couleur].css;
  ctx.lineJoin = "round";
  if (POLICE.fauxGras > 0) {
    ctx.lineWidth = POLICE.fauxGras;
    ctx.strokeText(retouche.texte, origineX, retouche.ligneDeBase);
  }
  ctx.fillText(retouche.texte, origineX, retouche.ligneDeBase);
  ctx.restore();

  // 4. Contrôle : qu'est-ce qui a bougé, et où ?
  const apres = ctx.getImageData(0, 0, LARGEUR, HAUTEUR).data;
  let modifies = 0;
  let horsFenetre = 0;
  let x1 = LARGEUR;
  let y1 = HAUTEUR;
  let x2 = -1;
  let y2 = -1;
  for (let y = 0; y < HAUTEUR; y++)
    for (let x = 0; x < LARGEUR; x++) {
      const i = (y * LARGEUR + x) * 4;
      if (avant[i] === apres[i] && avant[i + 1] === apres[i + 1] && avant[i + 2] === apres[i + 2]) continue;
      modifies++;
      if (x < f.x || x >= f.x + f.largeur || y < f.y || y >= f.y + f.hauteur) horsFenetre++;
      if (couverture(apres, i, encre) > SEUIL_ENCRE) {
        if (x < x1) x1 = x;
        if (x > x2) x2 = x;
        if (y < y1) y1 = y;
        if (y > y2) y2 = y;
      }
    }
  const largeur = x2 - x1 + 1;
  const hauteur = y2 - y1 + 1;

  // 5. Jeux verticaux : jusqu'où monte l'encre au-dessus, où commence celle du dessous.
  //    (l'accent dépasse forcément la boîte d'encre d'origine de la ligne : c'est attendu,
  //    ce qui ne l'est pas serait qu'il touche la ligne du dessus.)
  const ligneDessus = BLOC_DATE_DE_FIN.lignes[0]!;
  const jeuHaut = y1 - ligneDessus.encre.y2 - 1;
  const jeuBas = SOMMET_HAUTEUR_X - y2 - 1;

  const soucis: string[] = [];
  if (horsFenetre > 0) soucis.push(`${horsFenetre} px modifiés HORS fenêtre`);
  if (largeur < retouche.attendu.largeur[0] || largeur > retouche.attendu.largeur[1])
    soucis.push(`largeur ${largeur} hors de ${retouche.attendu.largeur.join("..")}`);
  if (hauteur < retouche.attendu.hauteur[0] || hauteur > retouche.attendu.hauteur[1])
    soucis.push(`hauteur ${hauteur} hors de ${retouche.attendu.hauteur.join("..")}`);
  if (modifies < retouche.attendu.pixelsModifies[0] || modifies > retouche.attendu.pixelsModifies[1])
    soucis.push(`${modifies} px modifiés hors de ${retouche.attendu.pixelsModifies.join("..")}`);
  if (jeuHaut < 1) soucis.push(`accent collé à la ligne du dessus (jeu ${jeuHaut} px)`);
  if (jeuBas < 0) soucis.push(`accent qui mord sur la hauteur d'x (jeu ${jeuBas} px)`);
  if (soucis.length > 0) {
    console.error(`retouche « ${retouche.nom} » refusée : ${soucis.join(" ; ")}`);
    process.exit(1);
  }

  rapport.push({
    retouche: retouche.nom,
    fenetre: `x ${f.x}..${f.x + f.largeur - 1} y ${f.y}..${f.y + f.hauteur - 1} (${f.largeur * f.hauteur} px, aplat pur)`,
    accent: `x ${x1}..${x2} y ${y1}..${y2} (${largeur}x${hauteur})`,
    pixels_modifies: modifies,
    pixels_hors_fenetre: horsFenetre,
    jeu_ligne_du_dessus: jeuHaut,
    jeu_hauteur_d_x: jeuBas,
    bord_droit_du_bloc: BLOC_DATE_DE_FIN.bordDroit,
  });
}

await Bun.write(sortie, toile.toBuffer("image/png"));

if (enJson) console.log(JSON.stringify({ source, sortie, retouches: rapport }, null, 2));
else {
  for (const r of rapport)
    console.log(
      `${r.retouche} : ${r.accent}, ${r.pixels_modifies} px modifiés, ${r.pixels_hors_fenetre} hors fenêtre, jeu ${r.jeu_ligne_du_dessus} px sous la ligne du dessus`,
    );
  console.log(`sortie=${sortie}`);
}
