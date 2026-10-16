/*
 * Le NOYAU du tirage au sort d'une campagne : sérialisation canonique, empreintes,
 * dérivation de l'aléa, classement Efraimidis–Spirakis, et vérification.
 *
 * ── POURQUOI CE MODULE N'IMPORTE RIEN ──────────────────────────────────────
 * Zéro `import`, pas même `import type`. Ce n'est pas de la coquetterie : ce
 * fichier est lu par des îlots `"use client"` (l'animation a besoin de ses types
 * et de `clePublique`), par les server actions, par les scripts Bun d'export et,
 * un jour, par une page de vérification qu'un tiers ouvrira chez lui. Un seul
 * import serveur remonté ici (`server-only`, `node:crypto`, `pg`) casserait le
 * bundle navigateur avec « Can't resolve 'fs' / 'tls' » — piège documenté du
 * dépôt, et le plus coûteux à diagnostiquer parce qu'il ne casse qu'au build.
 *
 * « Zéro import » n'est PAS « zéro global ». Ce module utilise :
 *   · `TextEncoder` et `String.prototype.normalize` (WHATWG Encoding, ECMA-402) —
 *     présents dans Bun, dans Node et dans tout navigateur, y compris en `file://` ;
 *   · `globalThis.crypto.subtle` pour SHA-256 et HMAC-SHA-256.
 *
 * ⚠ CONSÉQUENCE DE `crypto.subtle`, À CONNAÎTRE AVANT DE S'EN SERVIR AILLEURS.
 * 1. TOUT CE QUI HACHE EST ASYNCHRONE. WebCrypto n'a aucune variante synchrone :
 *    `importKey` et `sign` rendent des `Promise` (vérifié par exécution sous Bun
 *    1.4.0). L'`async` remonte donc jusqu'à `executerTirage` et `verifierTirage`.
 *    Les fonctions PURES et synchrones (comparateur, dérivation de `u`, clé de
 *    tri, sérialisation) restent synchrones : c'est ce qui permet à l'animation
 *    d'ordonner un classement déjà calculé sans jamais rien attendre.
 * 2. `Crypto.subtle` est déclaré `[SecureContext]` par la spécification WebCrypto
 *    du W3C : il vaut `undefined` en `http://` non-localhost et en `file://`. Nos
 *    deux domaines sont en HTTPS, donc le site et l'admin ne sont pas concernés ;
 *    en revanche une page de vérification qu'un tiers ouvrirait par double-clic
 *    depuis son disque n'aurait PAS `crypto.subtle`. `exigerSubtle()` lève alors
 *    un message qui dit quoi faire, au lieu d'un « Cannot read properties of
 *    undefined » illisible. La parade côté vérificateur est de servir la page
 *    (`bunx serve`) ou d'utiliser le script Bun d'export.
 *
 * ── CE QUE CE MODULE NE FAIT PAS ───────────────────────────────────────────
 * Il ne lit RIEN et n'écrit RIEN : pas de base, pas de réseau, pas d'horloge
 * (l'instant est toujours un PARAMÈTRE, cf. `roundPour`). `Math.random` n'y
 * apparaît nulle part. La seule source d'aléa acceptée est une graine fournie
 * par l'appelant, et le seul usage légitime de `crypto.getRandomValues` du
 * dispositif entier est la graine d'un tirage de RÉPÉTITION, tiré côté serveur.
 *
 * ── LES TROIS CHOSES QUI ONT ÉTÉ RÉFUTÉES PAR LA MESURE ────────────────────
 * (Campagne « iergday », 14 personnes, 16 œuvres. Tous les chiffres cités dans
 * ce fichier ont été obtenus par exécution, jamais estimés.)
 *
 * 1. UNE GRAINE TIRÉE PAR L'ORGANISATEUR N'EST PAS UN TIRAGE ÉQUITABLE.
 *    Débit mesuré : 28 884 tirages complets par seconde sur un cœur. Forcer la
 *    personne la plus défavorisée au rang 1 demande 8 essais ; imposer un trio
 *    EXACT ET DANS L'ORDRE en demande 902, soit 0,03 s. Un commit-reveal à une
 *    seule partie n'y change rien : il suffit de moudre les graines d'abord et
 *    de n'engager que celle qui plaît. D'où `graineDepuisBalise()` : la graine
 *    est la signature d'un round drand FUTUR, que personne ne contrôle.
 * 2. UNE SÉRIALISATION À SÉPARATEURS EST FALSIFIABLE. Collision réelle, obtenue
 *    par exécution : avec `cle:poids` joint par `\n`, le roster à deux entrées
 *    `[{p:alice,1},{p:bob,3}]` et le roster à UNE entrée
 *    `[{"p:alice:1\np:bob",3}]` produisent la même chaîne et le même SHA-256
 *    `11f5f957…62dc`. D'où le préfixe de longueur (cf. `serialiserChamps`).
 * 3. TROIS FAÇONS DE DÉRIVER `u` SUR QUATRE SORTENT DE L'INTERVALLE OUVERT.
 *    Détail et contre-exemples au-dessus de `uDepuisEmpreinte`.
 */

/* ── TYPES PARTAGÉS ────────────────────────────────────────────────────────
 *
 * ⚠ `SourceTirage` DUPLIQUE VOLONTAIREMENT `SourceCreation` de `./types`.
 * Importer ce type coûterait le « zéro import » qui fait tout l'intérêt de ce
 * fichier, pour trois chaînes littérales. La dérive n'est pas laissée au hasard :
 * `tirage-alignement.test.ts` est le seul test qui importe les deux modules à la
 * fois et affirme `["x","discord","instagram"] satisfies SourceCreation[]`. Si
 * une quatrième source apparaît dans `./types` sans arriver ici, le test échoue.
 */
export type SourceTirage = "x" | "discord" | "instagram";

/** Comment le poids d'une personne est calculé — entre dans l'empreinte d'engagement. */
export type PoidsMode = "un_par_personne" | "par_oeuvre";

/**
 * D'où vient la graine.
 *
 * `balise` : signature d'un round drand futur — le SEUL mode publiable.
 * `locale` : graine tirée par nous. C'est un JOURNAL de répétition, jamais une
 * preuve d'équité (cf. le point 1 de l'en-tête). La base elle-même refuse de
 * publier ou d'annoncer un tirage `locale` (CHECK `x_campagne_tirages_locale_jamais_publique`),
 * et `verifierTirage` lève l'anomalie `mode_locale_publie` si l'un passe quand même.
 */
export type GraineOrigine = "balise" | "locale";

/** Une entrée du roster, réduite à ce qui entre dans l'empreinte : la clé et le poids. */
export interface EntreeRoster {
  /**
   * ⚠ IDENTIFIANT IMMUABLE, JAMAIS UN PSEUDO. `discord:908269053347504170`,
   * `x:2870776923`, `instagram:orphelinalius`.
   *
   * Pourquoi c'est structurel et pas conventionnel : `u = HMAC(graine, cle)`. Si
   * `cle` était un pseudo affiché, un participant qui change de pseudo APRÈS la
   * révélation de la graine se refabrique un ticket — même coût que l'attaque
   * mesurée au point 1, soit 8 essais. Le CHECK
   * `x_campagne_participants_cle_immuable` refuse `x:San_La_Vraie` en base, et le
   * corpus prouve que le besoin est réel : l'`author_id` X `1451855639592849409`
   * y porte DEUX handles historiques (`yukun_0073DQ` puis `yukun073DQ`).
   *
   * Instagram est le seul point fragile : `campagne_creations_instagram` n'a pas
   * de colonne d'identifiant numérique, seulement `auteur_pseudo`. Cette clé-là
   * ne survivrait donc PAS à un changement de pseudo. C'est écrit, pas caché.
   */
  cle: string;
  /** Entier de 1 à 64 — le plafond est justifié au-dessus de `MAX_POIDS`. */
  poids: number;
}

/** Un participant tel que le roster gelé le connaît, avant calcul des poids. */
export interface ParticipantTirage {
  cle: string;
  pseudoAffichage: string;
  nbOeuvres: number;
  /** Identifiants d'œuvres, en ordre canonique (trié) : `tirerOeuvre` en dépend. */
  oeuvres: string[];
}

/** Une entrée après calcul — c'est exactement ce que `x_campagne_tirage_entrees` gèle. */
export interface EntreeCalculee {
  cle: string;
  pseudoAffichage: string;
  poids: number;
  oeuvres: string[];
  /** Les 32 octets du HMAC, en hexadécimal minuscule (64 caractères). */
  empreinte: string;
  u: number;
  cleTri: number;
  /** 1 = mieux classé. Rempli par `executerTirage`. */
  rang: number;
}

/** Un gagnant, avec l'œuvre TIRÉE (pas choisie) et son lot. */
export interface Gagnant {
  rang: number;
  cle: string;
  pseudoAffichage: string;
  /** L'œuvre mise en avant, tirée par `tirerOeuvre`. `null` si la personne n'en a aucune. */
  oeuvreId: string | null;
  lot: string | null;
}

export interface ParametresTirage {
  /** Graine en hexadécimal, 64 caractères (32 octets). */
  graine: string;
  nbGagnants: number;
  poidsMode: PoidsMode;
}

export interface ResultatTirage {
  /** TOUTES les entrées, triées, `rang` de 1 à n. */
  classement: EntreeCalculee[];
  /** Les `nbGagnants` premières. */
  gagnants: Gagnant[];
  empreinteParticipants: string;
  empreinteGraine: string;
  nbParticipants: number;
}

/** Le contenu d'un ENGAGEMENT : ce qui est figé AVANT que le round visé n'existe. */
export interface Engagement {
  campagneSlug: string;
  poidsMode: PoidsMode;
  nbGagnants: number;
  /** Un libellé par rang, dans l'ordre. `[]` = classement nu, explicitement vide. */
  lots: string[];
  /** Poids DÉJÀ résolus par le mode. */
  entrees: EntreeRoster[];
  baliseReseau: string;
  baliseChaine: string;
  /** Le round VISÉ, dans le futur. */
  baliseRound: number;
}

/* ── PRIMITIVES ────────────────────────────────────────────────────────────
 * Rien d'astucieux ici, et c'est voulu : un vérificateur tiers doit pouvoir lire
 * ces quinze lignes et n'avoir plus rien à croire du reste de notre pile.
 */

/**
 * Octets UTF-8 d'une chaîne, TOUJOURS normalisée en NFC.
 *
 * ⚠ Le NFC n'est pas décoratif : mesuré, `"café"` composé (U+00E9) et décomposé
 * (U+0065 U+0301) donnent des empreintes de roster DIFFÉRENTES sans lui. Deux
 * saisies visuellement identiques du même pseudo casseraient la vérification.
 */
export function octetsUtf8(texte: string): Uint8Array {
  return new TextEncoder().encode(texte.normalize("NFC"));
}

/** Hexadécimal minuscule, deux chiffres par octet. */
export function hex(octets: Uint8Array): string {
  let sortie = "";
  for (const octet of octets) {
    sortie += octet.toString(16).padStart(2, "0");
  }
  return sortie;
}

/** Lève sur longueur impaire ou caractère hors `[0-9a-f]` — un hexa douteux est un bug, pas une donnée. */
export function depuisHex(hexa: string): Uint8Array {
  if (hexa.length % 2 !== 0) {
    throw new Error(`Hexadécimal de longueur impaire (${hexa.length}) : impossible à décoder en octets.`);
  }
  if (!/^[0-9a-f]*$/.test(hexa)) {
    throw new Error("Hexadécimal invalide : seuls les chiffres 0-9 et les lettres a-f minuscules sont acceptés.");
  }
  const octets = new Uint8Array(hexa.length / 2);
  for (let i = 0; i < octets.length; i += 1) {
    octets[i] = Number.parseInt(hexa.slice(i * 2, i * 2 + 2), 16);
  }
  return octets;
}

export function concat(...morceaux: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const morceau of morceaux) {
    total += morceau.length;
  }
  const sortie = new Uint8Array(total);
  let decalage = 0;
  for (const morceau of morceaux) {
    sortie.set(morceau, decalage);
    decalage += morceau.length;
  }
  return sortie;
}

/**
 * Ordre lexicographique OCTET, total.
 *
 * ⚠ Ce n'est PAS `a < b` sur des chaînes : `<` compare des unités UTF-16 et range
 * donc U+E000..U+FFFF AVANT les caractères astraux (U+10000+), alors que leurs
 * octets UTF-8 disent l'inverse. Ce n'est pas non plus `localeCompare`, qui
 * dépend de l'ICU embarquée par le moteur — un vérificateur tiers n'aurait pas
 * forcément la même. L'ordre des octets, lui, est le même partout.
 */
export function comparerOctets(a: Uint8Array, b: Uint8Array): number {
  const minimum = Math.min(a.length, b.length);
  for (let i = 0; i < minimum; i += 1) {
    // Les `?? 0` sont inatteignables (boucle bornée) mais exigés par
    // `noUncheckedIndexedAccess`, actif sur tout le monorepo.
    const oa = a[i] ?? 0;
    const ob = b[i] ?? 0;
    if (oa !== ob) {
      return oa < ob ? -1 : 1;
    }
  }
  if (a.length === b.length) {
    return 0;
  }
  return a.length < b.length ? -1 : 1;
}

/** Entier 32 bits non signé, gros-boutiste. Le SEUL encodage d'entier du module. */
export function u32be(valeur: number): Uint8Array {
  if (!Number.isInteger(valeur) || valeur < 0 || valeur > 0xff_ff_ff_ff) {
    throw new Error(`u32be attend un entier de 0 à 4294967295, reçu ${String(valeur)}.`);
  }
  const octets = new Uint8Array(4);
  new DataView(octets.buffer).setUint32(0, valeur, false);
  return octets;
}

/**
 * WebCrypto, avec un message lisible quand il manque.
 *
 * Voir l'en-tête : `crypto.subtle` est `[SecureContext]` et vaut `undefined` en
 * `file://` ou en `http://` non-localhost. Sans cette garde, une page de
 * vérification ouverte par double-clic échouerait sur « Cannot read properties
 * of undefined (reading 'digest') », ce qui n'aide personne.
 */
function exigerSubtle(): SubtleCrypto {
  const sous = globalThis.crypto?.subtle;
  if (!sous) {
    throw new Error(
      "crypto.subtle indisponible : la Web Crypto API n'existe qu'en contexte sécurisé (HTTPS ou localhost). " +
        "Pour vérifier un tirage hors ligne, servez la page (par exemple `bunx serve`) au lieu de l'ouvrir en file://.",
    );
  }
  return sous;
}

/** SHA-256, 32 octets. Asynchrone : WebCrypto n'offre aucune variante synchrone. */
export async function sha256(message: Uint8Array): Promise<Uint8Array> {
  const condensat = await exigerSubtle().digest("SHA-256", message as BufferSource);
  return new Uint8Array(condensat);
}

/** SHA-256 rendu directement en hexadécimal — le format de toutes nos empreintes. */
export async function sha256Hex(message: Uint8Array): Promise<string> {
  return hex(await sha256(message));
}

/**
 * HMAC-SHA-256, 32 octets.
 *
 * ⚠ SENS DES ARGUMENTS, ET C'EST UN BUG FRANC SI ON L'INVERSE. La graine est la
 * CLÉ, l'identifiant du participant est le MESSAGE. Deux raisons, la première
 * démontrée par exécution :
 *
 * (a) LA CLÉ HMAC EST DÉGÉNÉRÉE PAR CONSTRUCTION. La RFC 2104 §2 complète la clé
 *     par des zéros jusqu'à 64 octets et pré-hache toute clé plus longue.
 *     Mesuré : `HMAC(clé="san_la_vraie")`, `HMAC(clé="san_la_vraie\0")` et
 *     `HMAC(clé="san_la_vraie\0\0\0\0")` rendent TOUS
 *     `b1da3540…1464` — identiques. Et `HMAC(clé de 100 o) === HMAC(SHA256(clé))`.
 *     Mettre l'identifiant du participant en position de clé, c'est offrir deux
 *     familles de collisions exploitables. Dans le bon sens, les trois messages
 *     donnent trois empreintes distinctes.
 * (b) HMAC N'EST PROUVÉ PRF QUE SOUS CLÉ SECRÈTE (Bellare, CRYPTO 2006). C'est
 *     exactement l'hypothèse dont on a besoin : tant que la graine n'est pas
 *     révélée, `cle ↦ u` est indiscernable d'une fonction aléatoire, donc
 *     personne ne peut se choisir un identifiant avantageux. Dans l'autre sens,
 *     la clé serait publique et choisie par l'adversaire : on quitterait
 *     l'hypothèse pour du « known-key », que HMAC ne promet pas.
 *
 * Note de coût, pour qui serait tenté d'optimiser : mettre la graine en clé
 * permettrait de n'importer la clé QU'UNE FOIS pour tout le roster (1,037 ms
 * mesurées contre 3,602 ms avec une `importKey` par participant, sur 14 clés).
 * Ce module ne l'exploite pas — un tirage se fait une fois par campagne, et une
 * clé réutilisée entre deux appels serait un état partagé dans un module qui n'en
 * a aucun. La possibilité est notée ; l'échanger contre de la simplicité serait
 * un mauvais marché ici.
 */
export async function hmacSha256(cle: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  if (cle.length === 0) {
    // WebCrypto refuse une clé HMAC vide. Le dire ici plutôt que de laisser
    // remonter un `OperationError` sans contexte.
    throw new Error("Clé HMAC vide : la graine doit faire 32 octets.");
  }
  const cleImportee = await exigerSubtle().importKey(
    "raw",
    cle as BufferSource,
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await exigerSubtle().sign("HMAC", cleImportee, message as BufferSource);
  return new Uint8Array(signature);
}

/* ── SÉRIALISATION CANONIQUE À PRÉFIXE DE LONGUEUR ─────────────────────────── */

/** Étiquettes de domaine : deux usages différents du même HMAC ne doivent jamais coïncider. */
export const DOMAINE_ROSTER = "RGROSTER1";
export const DOMAINE_ENGAGEMENT = "RGENGAGE1";
export const DOMAINE_CLE_PUBLIQUE = "RGCLEPUB1";
export const DOMAINE_OEUVRE = "RGOEUVRE1";

/**
 * Plafond de poids, et ce n'est pas un chiffre rond posé au hasard.
 *
 * Deux raisons cumulées : (1) le comparateur exact calcule `a ** poids` en BigInt,
 * borné ici à ~3 400 bits, ce qui reste instantané — au-delà il gonflerait pour
 * rien ; (2) 65 œuvres d'une seule personne sur une campagne est une erreur de
 * donnée (un dédoublonnage raté), pas un cas d'usage. Le CHECK
 * `x_campagne_tirage_entrees` porte la même borne en base.
 */
export const MAX_POIDS = 64;

/**
 * Plafond d'entrées. À 100 000 personnes, l'empreinte reste calculable ; au-delà,
 * c'est qu'une jointure a explosé, et hacher le produit cartésien serait une
 * façon très lente de ne rien découvrir.
 */
export const MAX_ENTREES = 100_000;

/**
 * Champs à longueur préfixée : `u32be(n)` puis, pour chaque champ,
 * `u32be(longueur des octets UTF-8) ‖ octets`.
 *
 * ⚠ AUCUN SÉPARATEUR, et c'est tout l'intérêt : aucun octet de la donnée ne peut
 * jouer le rôle de délimiteur. La collision démontrée en tête de fichier
 * (`11f5f957…62dc`) disparaît sous ce format, parce que la longueur annoncée
 * avant chaque champ ne peut pas, elle, être contrefaite depuis l'intérieur du
 * champ. C'est la même raison qui fait préfixer les longueurs dans TLS.
 */
export function serialiserChamps(champs: readonly string[]): Uint8Array {
  const morceaux: Uint8Array[] = [u32be(champs.length)];
  for (const champ of champs) {
    const octets = octetsUtf8(champ);
    morceaux.push(u32be(octets.length), octets);
  }
  return concat(...morceaux);
}

/**
 * Ordre canonique du roster : octets UTF-8 de la clé NFC, comparaison OCTET.
 *
 * Sans tri, la sérialisation à longueur préfixée est SENSIBLE À L'ORDRE (mesuré) :
 * le même ensemble de participants arrivé dans deux ordres différents donnerait
 * deux empreintes différentes, et l'engagement publié ne se recalculerait plus.
 */
export function trierRoster(entrees: readonly EntreeRoster[]): EntreeRoster[] {
  return entrees.toSorted((a, b) => comparerOctets(octetsUtf8(a.cle), octetsUtf8(b.cle)));
}

/**
 * Format v1 du roster, octet pour octet :
 *
 *   "RGROSTER1"                     9 octets ASCII
 *   u32be(n)                        nombre d'entrées
 *   n fois, dans l'ordre canonique :
 *     u32be(len(cleUtf8)) ‖ cleUtf8
 *     u32be(poids)
 *
 * Lève si : n dépasse `MAX_ENTREES` ; un poids n'est pas un entier de 1 à
 * `MAX_POIDS` ; une clé est vide ; deux clés coïncident APRÈS normalisation NFC.
 * Le dernier cas mérite d'être refusé bruyamment : deux lignes visuellement
 * identiques donneraient au même humain deux tickets, et l'empreinte ne le
 * dirait pas.
 */
export function serialiserRoster(entrees: readonly EntreeRoster[]): Uint8Array {
  if (entrees.length > MAX_ENTREES) {
    throw new Error(`Roster de ${entrees.length} entrées : plafond ${MAX_ENTREES}.`);
  }
  const triees = trierRoster(entrees);
  const morceaux: Uint8Array[] = [octetsUtf8(DOMAINE_ROSTER), u32be(triees.length)];
  const vues = new Set<string>();
  for (const entree of triees) {
    const cleNfc = entree.cle.normalize("NFC");
    if (cleNfc.length === 0) {
      throw new Error("Clé de participant vide dans le roster.");
    }
    if (vues.has(cleNfc)) {
      throw new Error(`Clé de participant en double dans le roster : ${cleNfc}`);
    }
    vues.add(cleNfc);
    if (!Number.isInteger(entree.poids) || entree.poids < 1 || entree.poids > MAX_POIDS) {
      throw new Error(
        `Poids invalide pour ${cleNfc} : ${String(entree.poids)} (attendu un entier de 1 à ${MAX_POIDS}).`,
      );
    }
    const octetsCle = octetsUtf8(cleNfc);
    morceaux.push(u32be(octetsCle.length), octetsCle, u32be(entree.poids));
  }
  return concat(...morceaux);
}

/** Empreinte du roster, 64 hexa. C'est elle qui entre dans la graine. */
export async function empreinteRoster(entrees: readonly EntreeRoster[]): Promise<string> {
  return sha256Hex(serialiserRoster(entrees));
}

/**
 * Empreinte d'ENGAGEMENT : ce que le roster seul ne couvre pas.
 *
 * ── POURQUOI DEUX EMPREINTES ET PAS UNE ────────────────────────────────────
 * La graine est exactement `SHA-256(signature ‖ empreinte_participants)` : le
 * nombre de gagnants n'y entre donc pas, et c'est volontaire — la graine doit
 * pouvoir être recalculée à partir de la seule liste. Mais sans cette seconde
 * empreinte, N et les lots ne seraient couverts par RIEN, et un organisateur
 * pourrait voir le classement complet puis choisir N. Choisir N après avoir vu
 * le classement, c'est choisir les gagnants, sans toucher une seule ligne du
 * tirage. Même faute que choisir la récompense après avoir vu qui gagne.
 *
 * Elle est donc calculée à l'ENGAGEMENT, publiée dans le message Discord
 * d'engagement (horodaté par Discord, non modifiable sans marqueur « modifié »),
 * gelée par le trigger d'immuabilité, et `effectuerTirage` REFUSE de tirer si
 * elle ne se recalcule pas à l'identique.
 */
export function serialiserEngagement(engagement: Engagement, empreinteParticipants: string): Uint8Array {
  return concat(
    octetsUtf8(DOMAINE_ENGAGEMENT),
    serialiserChamps([
      engagement.campagneSlug,
      engagement.poidsMode,
      String(engagement.nbGagnants),
      String(engagement.lots.length),
      ...engagement.lots,
      engagement.baliseReseau,
      engagement.baliseChaine,
      String(engagement.baliseRound),
      empreinteParticipants,
    ]),
  );
}

/** Empreinte d'engagement, 64 hexa. Recalcule l'empreinte de roster au passage. */
export async function empreinteEngagement(engagement: Engagement): Promise<string> {
  const empreinteParticipants = await empreinteRoster(engagement.entrees);
  return sha256Hex(serialiserEngagement(engagement, empreinteParticipants));
}

/**
 * Clé publique PSEUDONYMISÉE : 16 hexa dérivés de la campagne et de l'identifiant.
 *
 * ── POURQUOI LE CLASSEMENT PUBLIC NE PORTE PAS LA VRAIE CLÉ ────────────────
 * `x_campagne_participants.identifiants` porte le lien
 * `discord:683044704967065626 ↔ x:1481333548074344451 ↔ kittycaillou/kittyshadow_/sigmimi`.
 * Ce lien inter-plateformes, PERSONNE ne l'a publié : c'est nous qui l'avons
 * établi à l'empreinte d'image. Publier le classement avec les clés de
 * plateforme publierait donc un graphe d'identités que quatre participantes
 * n'ont jamais rendu public — pour un tirage auquel elles n'avaient pas
 * connaissance de participer.
 *
 * La vérifiabilité n'en souffre pas : la fonction est publique et déterministe,
 * donc chacun recompose la sienne depuis son propre identifiant et retrouve son
 * poids et son rang. Le sel est le slug de campagne, ce qui empêche de recouper
 * deux campagnes entre elles.
 */
export async function clePublique(campagneSlug: string, cle: string): Promise<string> {
  const condensat = await sha256Hex(serialiserChamps([DOMAINE_CLE_PUBLIQUE, campagneSlug, cle]));
  return condensat.slice(0, 16);
}

/* ── BALISE PUBLIQUE drand ─────────────────────────────────────────────────── */

/**
 * Chaîne « quicknet » de drand / League of Entropy. Constantes VÉRIFIÉES en
 * direct le 23/8/2026 contre `https://api.drand.sh`.
 *
 * ── POURQUOI QUICKNET ET PAS LA CHAÎNE PAR DÉFAUT ──────────────────────────
 * Son schéma est `bls-unchained-g1-rfc9380` : la signature du round R ne dépend
 * QUE de R et de la clé de groupe. Un tiers la vérifie donc seule, hors ligne,
 * des années après. La chaîne par défaut (`8990e7a9…`) est
 * `pedersen-bls-chained` : sa signature dépend de la précédente, il faudrait
 * remonter tout le fil pour la valider. Sa période de 3 s (au lieu de 30 s)
 * raccourcit en prime l'attente entre l'engagement et le tirage.
 *
 * Mesuré ce jour : `round = floor((t − 1692803367)/3) + 1` redonne exactement le
 * round servi par l'API ; `signature` fait 96 hexa (48 octets, G1) ; et
 * `randomness == SHA-256(signature)`.
 */
export const DRAND_QUICKNET = {
  api: "https://api.drand.sh",
  chaine: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
  clePublique:
    "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c" +
    "8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb" +
    "5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a",
  genesisSec: 1_692_803_367,
  periodeSec: 3,
  reseau: "drand",
  schema: "bls-unchained-g1-rfc9380",
} as const;

/**
 * Ce que l'on écrit dans l'engagement d'un tirage de RÉPÉTITION.
 *
 * Une seule définition, partagée par la création de l'engagement et par la
 * vérification : si les deux fabriquaient leur propre valeur de repli, la
 * moindre divergence (`""` contre `"locale"`) ferait échouer la vérification
 * d'un tirage pourtant honnête, et on chercherait longtemps.
 */
export const BALISE_LOCALE = { chaine: "", reseau: "locale", round: 0 } as const;

/** Round drand couvrant un instant donné. L'instant est un PARAMÈTRE : ce module n'a pas d'horloge. */
export function roundPour(instantMs: number, genesisSec: number, periodeSec: number): number {
  return Math.floor((instantMs / 1000 - genesisSec) / periodeSec) + 1;
}

/** Instant (ms) auquel un round tombe — sert au compte à rebours et à la garde « pas encore ». */
export function instantDuRound(round: number, genesisSec: number, periodeSec: number): number {
  return (genesisSec + (round - 1) * periodeSec) * 1000;
}

/**
 * `graine = SHA-256(signature ‖ empreinte_participants)`, les DEUX en octets.
 *
 * On hache la SIGNATURE et non la `randomness` servie à côté par l'API : c'est
 * la signature qui se vérifie en BLS contre `DRAND_QUICKNET.clePublique`, la
 * `randomness` n'en étant qu'un condensé (mesuré : `randomness === SHA-256(signature)`).
 * Un vérificateur qui part de la `randomness` ne peut plus prouver que le round
 * est authentique ; en partant de la signature, il le peut.
 *
 * L'empreinte du roster est concaténée pour que deux campagnes qui viseraient le
 * même round n'aient pas la même graine.
 */
export async function graineDepuisBalise(signatureHex: string, empreinteParticipants: string): Promise<string> {
  return sha256Hex(concat(depuisHex(signatureHex), depuisHex(empreinteParticipants)));
}

/** Graine de répétition, depuis 32 octets fournis par l'appelant (jamais tirés ici). */
export function graineLocaleDepuis(octets: Uint8Array): string {
  if (octets.length !== 32) {
    throw new Error(`Graine locale de ${octets.length} octets : 32 sont exigés.`);
  }
  return hex(octets);
}

/** Empreinte de la graine — publiée à part, elle atteste la graine sans la révéler. */
export async function empreinteGraine(graineHex: string): Promise<string> {
  return sha256Hex(depuisHex(graineHex));
}

/** Seule une graine issue d'une balise publique peut être publiée. La base le refuse aussi. */
export function estGrainePubliable(origine: GraineOrigine): boolean {
  return origine === "balise";
}

/* ── DÉRIVATION DE u ───────────────────────────────────────────────────────── */

/** Empreinte d'un participant : `HMAC(graine, cle)`. Voir le sens des arguments sur `hmacSha256`. */
export async function empreinteParticipant(graineHex: string, cle: string): Promise<Uint8Array> {
  return hmacSha256(depuisHex(graineHex), octetsUtf8(cle));
}

/**
 * Les 52 bits de tête de l'empreinte, sous forme d'entier exact.
 *
 * Passe par un `DataView` plutôt que par `e[0] << 24 | …` : `getUint32` rend un
 * `number` franc là où l'indexation rendrait `number | undefined` sous
 * `noUncheckedIndexedAccess`, et un `?? 0` silencieux sur un octet d'empreinte
 * serait exactement le genre de repli qu'on ne veut pas dans un tirage.
 */
export function kDepuisEmpreinte(empreinte: Uint8Array): number {
  if (empreinte.length < 8) {
    throw new Error(`Empreinte de ${empreinte.length} octets : au moins 8 sont nécessaires.`);
  }
  const vue = new DataView(empreinte.buffer, empreinte.byteOffset, empreinte.byteLength);
  const haut = vue.getUint32(0, false) >>> 6; // 26 bits de tête
  const bas = vue.getUint32(4, false) >>> 6; // 26 bits suivants
  return haut * 67_108_864 + bas; // 52 bits : 0 ≤ k < 2^52
}

/** Idem depuis l'empreinte hexadécimale gelée en base. */
export function kDepuisHex(empreinteHex: string): number {
  return kDepuisEmpreinte(depuisHex(empreinteHex.slice(0, 16)));
}

/**
 * `u` dans l'intervalle STRICTEMENT OUVERT (0, 1).
 *
 * ── LES TROIS VARIANTES RÉFUTÉES, PAR EXÉCUTION ────────────────────────────
 * · 64 bits / 2^64 : casse aux DEUX bouts. `u(00…00) = 0` → `-ln u = Infinity`,
 *   et `Number(2n**64n - 1n) / 2**64 === 1` EXACTEMENT → `-ln u = 0`, donc
 *   gagnant automatique.
 * · 53 bits / 2^53 : `u = 0` reste atteignable → `Infinity`.
 * · (53 bits + 0,5) / 2^53 : répare le bas et casse le haut — `2^53 − 0,5` n'est
 *   pas représentable et arrondit à `2^53`, donc `u = 1` exactement, donc clé de
 *   tri `−0`, donc gagnant automatique.
 *
 * ── LA SEULE QUI TIENT ─────────────────────────────────────────────────────
 * `u = (2k + 1) / 2^53` avec k sur 52 bits. `2k + 1` est impair et strictement
 * inférieur à 2^53, donc exactement représentable en binary64 ; la division par
 * une puissance de deux est alors EXACTE (0 arrondi sur 1 100 000 valeurs
 * testées, dont les 100 000 premières et les 100 000 dernières de l'intervalle).
 * Bornes exactes : `u_min = 2^-53`, `u_max = 1 − 2^-53`.
 *
 * ⚠ AUCUN BIAIS MODULO : on DÉCALE (`>>>`), on ne calcule jamais de reste. 2^52
 * divise 2^256, donc chaque valeur de k a exactement 2^204 antécédents.
 * Qualité mesurée sur 10^6 valeurs : Kolmogorov–Smirnov D = 9,481e-4 (seuil 5 %
 * à 1,360e-3) ; `-ln u` de moyenne 0,99854 et de variance 0,99619 (attendu 1 et 1).
 */
export function uDepuisEmpreinte(empreinte: Uint8Array): number {
  return (2 * kDepuisEmpreinte(empreinte) + 1) / 9_007_199_254_740_992;
}

/**
 * Clé de tri d'Efraimidis–Spirakis, forme LOGARITHMIQUE. Plus petite = mieux classé.
 *
 * Algorithme A-Res (Information Processing Letters 97(5), 2006). La chaîne de
 * preuve tient en trois lignes : `u ~ U(0,1)` donne `-ln u ~ Exp(1)` ; diviser par
 * `w` donne `Exp(w)` ; et le minimum d'exponentielles indépendantes tombe sur `i`
 * avec probabilité exactement `w_i / Σw`. Les rangs 2..N suivent alors la loi
 * Plackett–Luce (tirage successif sans remise proportionnel au poids), par
 * absence de mémoire de l'exponentielle.
 *
 * ⚠ LA FORME PUBLIÉE `u^(1/w)` EST PROSCRITE. Elle est algébriquement
 * équivalente (monotonie du logarithme) mais tend vers 1 quand `w` croît : toutes
 * les clés s'écrasent alors dans le même voisinage float64 et le départage
 * devient du bruit d'arrondi.
 */
export function cleDeTri(u: number, poids: number): number {
  return -Math.log(u) / poids;
}

/* ── COMPARATEUR ───────────────────────────────────────────────────────────── */

/**
 * Ordre total sur les entrées calculées. Trois niveaux, dans cet ordre.
 *
 * 1. BigInt EXACT, et pas le flottant. ECMA-262 spécifie `Math.log` comme
 *    « implementation-approximated » : deux moteurs peuvent différer d'1 ULP, donc
 *    `cleTri` n'est pas une sémantique de référence défendable devant un tiers.
 *    L'algèbre évite complètement le logarithme :
 *      `cle_a < cle_b  ⟺  u_a^{w_b} > u_b^{w_a}  ⟺  2^{53·w_a}·a^{w_b} > 2^{53·w_b}·b^{w_a}`
 *    avec `a = 2k_a + 1`. Mesuré : ZÉRO désaccord avec le comparateur flottant sur
 *    45 500 000 comparaisons, et l'écart minimal jamais observé entre deux clés
 *    vaut 2,68e8 ULP — le risque pratique était nul, mais l'exactitude est gratuite.
 *    Le plafond `MAX_POIDS` borne `a ** w` à ~3 400 bits.
 * 2. DÉPARTAGE PAR L'EMPREINTE, obligatoire malgré P(égalité) ≈ 2,02e-14 à 14
 *    participants (mesuré : 0 égalité sur 18 200 000 comparaisons). Sans lui,
 *    `Array.prototype.sort` étant STABLE depuis ES2019, c'est l'ordre d'arrivée du
 *    roster — donc l'organisateur — qui trancherait. Et un vérificateur écrit en
 *    Python, Rust ou Go n'a pas forcément le même tri : le résultat cesserait
 *    d'être reproductible PAR SPÉCIFICATION. Une chaîne hexa minuscule de longueur
 *    fixe se compare lexicographiquement comme les octets qu'elle représente
 *    (`0`–`9` < `a`–`f` en ASCII).
 * 3. DÉPARTAGE PAR LA CLÉ. Inatteignable (il faudrait deux clés distinctes de même
 *    HMAC) et présent uniquement pour que le comparateur soit total par
 *    spécification, sans clause « et sinon, on ne sait pas ».
 */
export function comparerEntrees(a: EntreeCalculee, b: EntreeCalculee): number {
  const ka = BigInt(2 * kDepuisHex(a.empreinte) + 1);
  const kb = BigInt(2 * kDepuisHex(b.empreinte) + 1);
  const wa = BigInt(a.poids);
  const wb = BigInt(b.poids);
  const gauche = (1n << (53n * wa)) * ka ** wb;
  const droite = (1n << (53n * wb)) * kb ** wa;
  if (gauche > droite) {
    return -1;
  }
  if (gauche < droite) {
    return 1;
  }
  if (a.empreinte !== b.empreinte) {
    return a.empreinte < b.empreinte ? -1 : 1;
  }
  return comparerOctets(octetsUtf8(a.cle), octetsUtf8(b.cle));
}

/* ── EXÉCUTION ─────────────────────────────────────────────────────────────── */

/**
 * Poids d'un participant selon le mode.
 *
 * ⚠ NE JAMAIS ÉCRIRE « DEUX ŒUVRES = DEUX FOIS PLUS DE CHANCES DE GAGNER ».
 * C'est faux dès qu'il y a plus d'un gagnant, et c'est mesuré : sur 200 000
 * tirages à 3 gagnants, une personne de poids 3 figure dans le trio 82 366 fois,
 * là où « 3·w/W » en annoncerait 90 000 — soit 8,5 % de moins. Le χ² contre
 * `3·w/W` vaut 1246,0 (df = 13, p = 2,2e-258) : rejet franc. Contre la théorie
 * successive exacte, il vaut 7,349 (p = 0,8833) : adéquation.
 *
 * Ce n'est pas un défaut d'A-Res : l'échantillonnage à probabilités d'inclusion
 * proportionnelles est INFAISABLE dès que `N·w_i/W > 1`, puisqu'une probabilité
 * ne peut pas dépasser 1. Aucun algorithme ne peut faire mieux.
 *
 * La formulation juste, celle qui doit figurer partout : « chaque œuvre est un
 * ticket, tirés un par un sans remise ».
 */
export function poidsDe(participant: ParticipantTirage, mode: PoidsMode): number {
  if (mode === "un_par_personne") {
    return 1;
  }
  // `Math.max(1, …)` : une personne sans œuvre rattachée reste une personne. Un
  // poids 0 la retirerait du tirage en silence, ce qui n'est pas une décision
  // qu'un calcul de poids a le droit de prendre — c'est un acte de modération,
  // et il passe par `eligible` avec un motif obligatoire.
  return Math.min(MAX_POIDS, Math.max(1, participant.nbOeuvres));
}

/** Le roster réduit à (clé, poids), prêt à être haché. */
export function rosterDe(participants: readonly ParticipantTirage[], mode: PoidsMode): EntreeRoster[] {
  return participants.map(participant => ({
    cle: participant.cle,
    poids: poidsDe(participant, mode),
  }));
}

/**
 * Quelle œuvre du gagnant est mise en avant. TIRÉE, pas choisie.
 *
 * C'est le même aléa, dérivé une seconde fois sous un domaine distinct, donc
 * vérifiable par un tiers avec exactement la même machinerie. L'alternative
 * — « la plus récente », « celle mise en avant » — serait le dernier endroit du
 * dispositif où quelqu'un déciderait encore quelque chose, et il se trouve qu'il
 * tombe pile après la révélation du gagnant.
 *
 * Sémantique de référence, sans reste et donc sans biais modulo :
 *   `index = Number((BigInt(k) * BigInt(n)) >> 52n)`
 * La voie rapide équivalente `Math.min(n - 1, Math.floor(u * n))` a été vérifiée
 * en accord sur 10^6 valeurs ; on garde la forme entière, qui n'a pas d'arrondi
 * à expliquer.
 */
export async function tirerOeuvre(graineHex: string, cle: string, oeuvres: readonly string[]): Promise<string | null> {
  if (oeuvres.length === 0) {
    return null;
  }
  const empreinte = await hmacSha256(depuisHex(graineHex), serialiserChamps([DOMAINE_OEUVRE, cle]));
  const k = BigInt(kDepuisEmpreinte(empreinte));
  const index = Number((k * BigInt(oeuvres.length)) >> 52n);
  return oeuvres[index] ?? null;
}

/**
 * Le tirage lui-même. Déterministe : même (graine, roster, mode) → même résultat,
 * quel que soit l'ordre d'arrivée des participants.
 *
 * L'appelant est responsable d'avoir déjà filtré les inéligibles et les alias
 * fusionnés : ce module ne sait pas ce qu'est une personne écartée, et c'est
 * volontaire — cette décision-là est un acte de modération tracé, pas un `where`.
 */
export async function executerTirage(
  participants: readonly ParticipantTirage[],
  parametres: ParametresTirage,
  lots: readonly string[] = [],
): Promise<ResultatTirage> {
  if (participants.length === 0) {
    throw new Error("Tirage impossible : le roster est vide.");
  }
  if (!Number.isInteger(parametres.nbGagnants) || parametres.nbGagnants < 1) {
    throw new Error(`Nombre de gagnants invalide : ${String(parametres.nbGagnants)}.`);
  }
  if (!/^[0-9a-f]{64}$/.test(parametres.graine)) {
    throw new Error("Graine invalide : 64 caractères hexadécimaux minuscules sont attendus.");
  }

  const roster = rosterDe(participants, parametres.poidsMode);
  // `serialiserRoster` (appelée par `empreinteRoster`) valide les poids, les clés
  // vides et les doublons NFC. On la fait passer AVANT tout calcul : un roster
  // malformé doit échouer sans qu'aucun rang n'ait été produit.
  const empreinteParticipants = await empreinteRoster(roster);
  const empreinteDeLaGraine = await empreinteGraine(parametres.graine);

  const parCle = new Map(participants.map(participant => [participant.cle, participant]));
  const poidsParCle = new Map(roster.map(entree => [entree.cle, entree.poids]));

  // On part de l'ordre CANONIQUE, pas de l'ordre d'arrivée : le comparateur étant
  // total, le tri final en est déjà indépendant, mais partir du canonique rend les
  // journaux et les diffs comparables d'une exécution à l'autre.
  //
  // Les HMAC sont calculés EN PARALLÈLE : ils sont mutuellement indépendants, et
  // `Promise.all` préserve l'ordre du tableau — le déterminisme n'y perd rien,
  // alors qu'une chaîne d'`await` sérialiserait autant d'allers-retours WebCrypto.
  const classement: EntreeCalculee[] = await Promise.all(
    trierRoster(roster).map(async (entree): Promise<EntreeCalculee> => {
      const participant = parCle.get(entree.cle);
      if (!participant) {
        throw new Error(`Incohérence interne : la clé ${entree.cle} n'a pas de participant.`);
      }
      const empreinte = await empreinteParticipant(parametres.graine, entree.cle);
      const u = uDepuisEmpreinte(empreinte);
      const poids = poidsParCle.get(entree.cle) ?? entree.poids;
      return {
        cle: participant.cle,
        cleTri: cleDeTri(u, poids),
        empreinte: hex(empreinte),
        oeuvres: [...participant.oeuvres],
        poids,
        pseudoAffichage: participant.pseudoAffichage,
        rang: 0,
        u,
      };
    }),
  );

  classement.sort(comparerEntrees);
  for (let i = 0; i < classement.length; i += 1) {
    const entree = classement[i];
    if (entree) {
      entree.rang = i + 1;
    }
  }

  // Tirage SANS REMISE : les `nbGagnants` premiers rangs, jamais deux fois la
  // même personne. Le plafonnement par la taille du classement évite qu'un N mal
  // saisi produise des rangs vides — la base refuse déjà `nbGagnants > nbParticipants`,
  // ceci est la ceinture par-dessus les bretelles.
  const nbGagnants = Math.min(parametres.nbGagnants, classement.length);
  const gagnants: Gagnant[] = await Promise.all(
    classement.slice(0, nbGagnants).map(async (entree, i): Promise<Gagnant> => {
      return {
        cle: entree.cle,
        lot: lots[i] ?? null,
        oeuvreId: await tirerOeuvre(parametres.graine, entree.cle, entree.oeuvres),
        pseudoAffichage: entree.pseudoAffichage,
        rang: entree.rang,
      };
    }),
  );

  return {
    classement,
    empreinteGraine: empreinteDeLaGraine,
    empreinteParticipants,
    gagnants,
    nbParticipants: classement.length,
  };
}

/* ── VÉRIFICATION ──────────────────────────────────────────────────────────── */

export type CodeAnomalie =
  | "roster_vide"
  | "poids_invalide"
  | "cle_dupliquee"
  | "empreinte_participants"
  | "empreinte_engagement"
  | "empreinte_graine"
  | "graine_balise"
  | "hmac"
  | "u"
  | "cle_tri"
  | "ordre"
  | "rang"
  | "gagnants"
  | "nb_gagnants"
  | "oeuvre_gagnante"
  | "mode_locale_publie";

export interface Anomalie {
  code: CodeAnomalie;
  cle?: string;
  rang?: number;
  attendu: string;
  trouve: string;
  /** En français, adressée à un humain : un code seul n'aide personne à comprendre. */
  explication: string;
}

export interface VerdictVerification {
  valide: boolean;
  /**
   * Nombre de contrôles PASSÉS. Un « valide » nu ne dit pas ce qui a été
   * vérifié : « 12 contrôles concordants » est une affirmation, « vrai » n'en est
   * pas une. L'écran d'admin l'affiche tel quel.
   */
  controles: number;
  anomalies: Anomalie[];
}

/** Un tirage tel qu'il est GELÉ en base — la seule entrée de `verifierTirage`. */
export interface TirageGele {
  campagneSlug: string;
  numero: number;
  graine: string;
  empreinteGraine: string;
  empreinteParticipants: string;
  empreinteEngagement: string;
  poidsMode: PoidsMode;
  nbGagnants: number;
  lots: string[];
  graineOrigine: GraineOrigine;
  publie: boolean;
  balise: { reseau: string; chaine: string; round: number; signature: string } | null;
  entrees: Array<{
    cle: string;
    pseudoAffichage: string;
    poids: number;
    oeuvres: string[];
    u: number;
    cleTri: number;
    empreinte: string;
    rang: number;
  }>;
  gagnants: Array<{ rang: number; cle: string; oeuvreId: string | null }>;
}

/**
 * Reconstruit l'`Engagement` d'un tirage gelé.
 *
 * Exportée exprès : la server action qui CRÉE l'engagement et la vérification qui
 * le RECALCULE doivent passer par le même code. Si chacune fabriquait sa propre
 * valeur de repli pour une balise absente, un tirage de répétition parfaitement
 * honnête se déclarerait invalide et l'on chercherait l'erreur dans la crypto.
 */
export function engagementDeTirage(gele: TirageGele): Engagement {
  const balise = gele.balise ?? BALISE_LOCALE;
  return {
    baliseChaine: balise.chaine,
    baliseReseau: balise.reseau,
    baliseRound: balise.round,
    campagneSlug: gele.campagneSlug,
    entrees: gele.entrees.map(entree => ({ cle: entree.cle, poids: entree.poids })),
    lots: [...gele.lots],
    nbGagnants: gele.nbGagnants,
    poidsMode: gele.poidsMode,
  };
}

/**
 * Écart en ULP entre deux flottants finis, pour le seul contrôle qui en a besoin.
 *
 * Voir `verifierTirage`, contrôle 6 : `Math.log` est « implementation-approximated »
 * par ECMA-262, donc `cleTri` peut légitimement différer d'un ULP entre deux
 * moteurs. `u`, lui, est de l'arithmétique entière suivie d'une division par une
 * puissance de deux : il est exact partout et se compare à l'identique.
 */
function ecartUlp(a: number, b: number): number {
  if (a === b) {
    return 0;
  }
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return Number.POSITIVE_INFINITY;
  }
  const tampon = new Float64Array(1);
  const bits = new BigInt64Array(tampon.buffer);
  tampon[0] = a;
  const ba = bits[0] ?? 0n;
  tampon[0] = b;
  const bb = bits[0] ?? 0n;
  const delta = ba > bb ? ba - bb : bb - ba;
  return delta > 9_007_199_254_740_992n ? Number.POSITIVE_INFINITY : Number(delta);
}

/**
 * Recalcule une empreinte, ou rend une valeur PARLANTE si le calcul est refusé.
 *
 * Les quatre contrôles d'empreinte partagent le même besoin : un roster que
 * `serialiserRoster` refuse (poids hors bornes, clé en double) ou un hexadécimal
 * malformé ne doit PAS faire remonter une exception, sinon l'écran de vérification
 * meurt au premier trou et n'affiche aucun des autres contrôles. On rend donc une
 * chaîne `<refusé: …>` qui ne peut égaler aucune empreinte valide, et qui dit à
 * l'humain ce qui a été refusé — au lieu d'un « attendu X, trouvé (vide) ».
 */
async function empreinteOuRefus(calcul: () => Promise<string>): Promise<string> {
  try {
    return await calcul();
  } catch (erreur) {
    return `<refusé: ${erreur instanceof Error ? erreur.message : String(erreur)}>`;
  }
}

/**
 * Rejoue intégralement un tirage à partir de (graine, entrées gelées) et dit ce
 * qui concorde. C'est la fonction que lit un tiers avant de nous croire.
 *
 * ── CE QUI EST COUVERT, ET CE QUI NE L'EST PAS ─────────────────────────────
 * `pseudoAffichage` n'entre dans AUCUNE empreinte, et c'est délibéré : corriger
 * l'orthographe d'un pseudo après le tirage ne doit pas détruire une preuve. Le
 * test `tirage.test.ts` l'exige explicitement (un pseudo corrigé doit rendre
 * `valide === true`), pour interdire à quiconque de l'ajouter « par sécurité ».
 * Ce qui est couvert, c'est ce qui décide : les clés, les poids, N, les lots, la
 * chaîne et le round visés, la graine, et l'ordre.
 */
export async function verifierTirage(gele: TirageGele): Promise<VerdictVerification> {
  const anomalies: Anomalie[] = [];
  let controles = 0;

  // ── 1. Forme du roster ─────────────────────────────────────────────────
  if (gele.entrees.length === 0) {
    anomalies.push({
      attendu: "au moins une entrée",
      code: "roster_vide",
      explication: "Le roster gelé est vide : il n'y a rien à vérifier, donc rien à croire.",
      trouve: "0",
    });
    return { anomalies, controles, valide: false };
  }
  controles += 1;

  let formeValide = true;
  const vues = new Set<string>();
  for (const entree of gele.entrees) {
    if (!Number.isInteger(entree.poids) || entree.poids < 1 || entree.poids > MAX_POIDS) {
      formeValide = false;
      anomalies.push({
        attendu: `un entier de 1 à ${MAX_POIDS}`,
        cle: entree.cle,
        code: "poids_invalide",
        explication: "Un poids hors bornes fausse la proportionnalité et fait exploser le comparateur exact.",
        trouve: String(entree.poids),
      });
    }
    const cleNfc = entree.cle.normalize("NFC");
    if (vues.has(cleNfc)) {
      formeValide = false;
      anomalies.push({
        attendu: "une seule ligne par identifiant",
        cle: entree.cle,
        code: "cle_dupliquee",
        explication:
          "Deux lignes portant le même identifiant après normalisation NFC donneraient deux tickets au même humain.",
        trouve: "deux lignes ou plus",
      });
    }
    vues.add(cleNfc);
  }
  if (formeValide) {
    controles += 1;
  }

  const roster: EntreeRoster[] = gele.entrees.map(entree => ({ cle: entree.cle, poids: entree.poids }));

  // ── 2. Empreinte du roster ─────────────────────────────────────────────
  const empreinteRecalculee = await empreinteOuRefus(() => empreinteRoster(roster));
  if (empreinteRecalculee === gele.empreinteParticipants) {
    controles += 1;
  } else {
    anomalies.push({
      attendu: gele.empreinteParticipants,
      code: "empreinte_participants",
      explication:
        "Le roster gelé ne redonne pas l'empreinte publiée à l'engagement : la liste des participants ou un poids a changé depuis.",
      trouve: empreinteRecalculee,
    });
  }

  // ── 3. Empreinte d'engagement (N, lots, mode, round visé) ──────────────
  const engagementRecalcule = await empreinteOuRefus(() => empreinteEngagement(engagementDeTirage(gele)));
  if (engagementRecalcule === gele.empreinteEngagement) {
    controles += 1;
  } else {
    anomalies.push({
      attendu: gele.empreinteEngagement,
      code: "empreinte_engagement",
      explication:
        "Le nombre de gagnants, un lot, le mode de poids ou le round visé diffère de ce qui avait été engagé AVANT le tirage.",
      trouve: engagementRecalcule,
    });
  }

  // ── 4. La graine vient bien de la balise annoncée ──────────────────────
  if (gele.balise) {
    const balise = gele.balise;
    const graineRecalculee = await empreinteOuRefus(() =>
      graineDepuisBalise(balise.signature, gele.empreinteParticipants),
    );
    if (graineRecalculee === gele.graine) {
      controles += 1;
    } else {
      anomalies.push({
        attendu: gele.graine,
        code: "graine_balise",
        explication:
          "La graine n'est pas SHA-256(signature du round ‖ empreinte des participants) : elle n'a pas été dérivée de la balise annoncée.",
        trouve: graineRecalculee,
      });
    }
  }

  // ── 5. Empreinte de la graine ──────────────────────────────────────────
  const empreinteGraineRecalculee = await empreinteOuRefus(() => empreinteGraine(gele.graine));
  if (empreinteGraineRecalculee === gele.empreinteGraine) {
    controles += 1;
  } else {
    anomalies.push({
      attendu: gele.empreinteGraine,
      code: "empreinte_graine",
      explication: "L'empreinte de graine publiée ne correspond pas à la graine : l'une des deux a été modifiée.",
      trouve: empreinteGraineRecalculee,
    });
  }

  // ── 6. HMAC, u et clé de tri, entrée par entrée ────────────────────────
  let hmacOk = true;
  let uOk = true;
  let cleTriOk = true;
  // Mêmes HMAC indépendants qu'à l'exécution, donc même parallélisme. Les
  // anomalies sont poussées dans l'ordre du tableau : `Promise.all` le préserve.
  const empreintesRecalculees = await Promise.all(
    gele.entrees.map(async entree => {
      try {
        return await empreinteParticipant(gele.graine, entree.cle);
      } catch {
        // Une graine illisible a déjà produit son anomalie au contrôle 5 ; on
        // continue avec 32 octets nuls pour que TOUS les autres contrôles soient
        // quand même rendus, plutôt que d'arrêter la vérification au premier trou.
        return new Uint8Array(32);
      }
    }),
  );
  const recalculees: EntreeCalculee[] = [];
  for (const [index, entree] of gele.entrees.entries()) {
    const empreinte = empreintesRecalculees[index] ?? new Uint8Array(32);
    const empreinteHex = hex(empreinte);
    if (empreinteHex !== entree.empreinte) {
      hmacOk = false;
      anomalies.push({
        attendu: entree.empreinte,
        cle: entree.cle,
        code: "hmac",
        explication:
          "HMAC(graine, identifiant) ne redonne pas l'empreinte gelée : l'identifiant ou la graine n'est pas celui qui a servi.",
        trouve: empreinteHex,
      });
    }
    const u = uDepuisEmpreinte(empreinte);
    if (u !== entree.u) {
      uOk = false;
      anomalies.push({
        attendu: String(entree.u),
        cle: entree.cle,
        code: "u",
        explication:
          "u = (2k+1)/2^53 est de l'arithmétique exacte : il doit être identique au bit près sur tout moteur. Une différence est une modification.",
        trouve: String(u),
      });
    }
    const cleTri = cleDeTri(u, entree.poids);
    // Tolérance de 4 ULP, et uniquement ici : ECMA-262 autorise 1 ULP d'écart
    // sur `Math.log` d'un moteur à l'autre. Elle ne peut rien masquer, pour deux
    // raisons mesurées : l'écart minimal jamais observé entre deux clés de tri
    // distinctes vaut 2,68e8 ULP, et l'ORDRE est de toute façon revérifié au
    // contrôle 7 par le comparateur BigInt, qui n'utilise aucun logarithme.
    if (ecartUlp(cleTri, entree.cleTri) > 4) {
      cleTriOk = false;
      anomalies.push({
        attendu: String(entree.cleTri),
        cle: entree.cle,
        code: "cle_tri",
        explication:
          "-ln(u)/poids ne redonne pas la clé de tri gelée, au-delà de l'écart d'arrondi tolérable entre moteurs.",
        trouve: String(cleTri),
      });
    }
    recalculees.push({
      cle: entree.cle,
      cleTri,
      empreinte: empreinteHex,
      oeuvres: [...entree.oeuvres],
      poids: entree.poids,
      pseudoAffichage: entree.pseudoAffichage,
      rang: entree.rang,
      u,
    });
  }
  if (hmacOk) {
    controles += 1;
  }
  if (uOk) {
    controles += 1;
  }
  if (cleTriOk) {
    controles += 1;
  }

  // ── 7. L'ordre publié est bien celui du comparateur ────────────────────
  const attendu = recalculees.toSorted(comparerEntrees);
  let ordreOk = true;
  for (let i = 0; i < attendu.length; i += 1) {
    const calculee = attendu[i];
    if (!calculee) {
      continue;
    }
    if (calculee.rang !== i + 1) {
      ordreOk = false;
      anomalies.push({
        attendu: String(i + 1),
        cle: calculee.cle,
        code: "ordre",
        explication:
          "Le classement rejoué ne place pas cette entrée au rang publié : l'ordre des gagnants a été modifié après coup.",
        rang: calculee.rang,
        trouve: String(calculee.rang),
      });
    }
  }
  if (ordreOk) {
    controles += 1;
  }

  // Les rangs doivent former exactement 1..n, sans trou ni doublon — un contrôle
  // distinct de l'ordre : deux entrées au rang 3 passeraient le test précédent si
  // l'une d'elles portait le bon.
  const rangs = new Set(gele.entrees.map(entree => entree.rang));
  if (rangs.size === gele.entrees.length && Math.min(...rangs) === 1 && Math.max(...rangs) === gele.entrees.length) {
    controles += 1;
  } else {
    anomalies.push({
      attendu: `les rangs 1 à ${gele.entrees.length}, une seule fois chacun`,
      code: "rang",
      explication: "Les rangs gelés ne forment pas une numérotation complète : il y a un trou ou un doublon.",
      trouve: `${rangs.size} rangs distincts`,
    });
  }

  // ── 8. Les gagnants sont les premiers rangs, dans l'ordre ──────────────
  const nbAttendu = Math.min(gele.nbGagnants, attendu.length);
  if (gele.gagnants.length === nbAttendu) {
    controles += 1;
  } else {
    anomalies.push({
      attendu: String(nbAttendu),
      code: "nb_gagnants",
      explication: "Le nombre de gagnants publiés ne correspond pas au nombre engagé.",
      trouve: String(gele.gagnants.length),
    });
  }
  let gagnantsOk = true;
  for (let i = 0; i < nbAttendu; i += 1) {
    const attenduIci = attendu[i];
    const publie = gele.gagnants[i];
    if (!attenduIci || !publie) {
      continue;
    }
    if (publie.cle !== attenduIci.cle || publie.rang !== i + 1) {
      gagnantsOk = false;
      anomalies.push({
        attendu: `${attenduIci.cle} au rang ${i + 1}`,
        cle: publie.cle,
        code: "gagnants",
        explication:
          "Le gagnant publié à ce rang n'est pas celui que le classement désigne : la liste a été remplacée.",
        rang: publie.rang,
        trouve: `${publie.cle} au rang ${publie.rang}`,
      });
    }
  }
  if (gagnantsOk) {
    controles += 1;
  }

  // ── 9. L'œuvre mise en avant a bien été TIRÉE ──────────────────────────
  let oeuvresOk = true;
  const oeuvresRecalculees = await Promise.all(
    gele.gagnants.map(async gagnant => {
      const entree = recalculees.find(candidate => candidate.cle === gagnant.cle);
      if (!entree) {
        return undefined;
      }
      try {
        return await tirerOeuvre(gele.graine, gagnant.cle, entree.oeuvres);
      } catch {
        return null;
      }
    }),
  );
  for (const [index, gagnant] of gele.gagnants.entries()) {
    const oeuvre = oeuvresRecalculees[index];
    // `undefined` = le gagnant n'a aucune entrée gelée ; c'est déjà signalé par le
    // contrôle 8, inutile de l'accuser une seconde fois sous un autre code.
    if (oeuvre === undefined) {
      continue;
    }
    if (oeuvre !== gagnant.oeuvreId) {
      oeuvresOk = false;
      anomalies.push({
        attendu: oeuvre ?? "aucune",
        cle: gagnant.cle,
        code: "oeuvre_gagnante",
        explication:
          "L'œuvre mise en avant n'est pas celle que l'aléa désigne : elle a été choisie, alors qu'elle doit être tirée.",
        rang: gagnant.rang,
        trouve: gagnant.oeuvreId ?? "aucune",
      });
    }
  }
  if (oeuvresOk) {
    controles += 1;
  }

  // ── 10. Un tirage de répétition n'est jamais public ────────────────────
  if (gele.graineOrigine === "locale" && gele.publie) {
    anomalies.push({
      attendu: "non publié",
      code: "mode_locale_publie",
      explication:
        "Un tirage à graine locale est un journal de répétition, pas une preuve d'équité : c'est nous qui avons tiré la graine, donc nous aurions pu recommencer jusqu'au résultat voulu (902 essais, 0,03 s, mesuré).",
      trouve: "publié",
    });
  } else {
    controles += 1;
  }

  return { anomalies, controles, valide: anomalies.length === 0 };
}
