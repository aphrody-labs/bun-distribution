import "server-only";

import { getPgPool } from "@/lib/db/pg";
import type { PoolClient } from "@rosegriffon/db/pg";

import {
  BALISE_LOCALE,
  clePublique,
  DRAND_QUICKNET,
  depuisHex,
  empreinteEngagement,
  empreinteRoster,
  type EntreeRoster,
  executerTirage,
  type Gagnant,
  type GraineOrigine,
  graineDepuisBalise,
  instantDuRound,
  MAX_POIDS,
  type ParticipantTirage,
  type PoidsMode,
  roundPour,
  sha256Hex,
  type SourceTirage,
  type TirageGele,
  verifierTirage,
  type VerdictVerification,
} from "./tirage";
import { SQL_CREATIONS } from "./sql-creations";
import { urlImageAsset } from "./types";

/*
 * Lectures et écritures serveur du TIRAGE AU SORT d'une campagne.
 *
 * ⚠ `getPgPool()` se connecte avec le rôle `rg`, PROPRIÉTAIRE des tables : la RLS
 * NE S'APPLIQUE PAS (exemption propriétaire, comme pour `queries.ts`). Chaque
 * clause de visibilité — `c.publiee`, `not masque`, `a_media`,
 * `m.deleted_at is null`, `s.suivi`, la fenêtre `debut_le`/`fin_le`, les
 * `comptes_organisateurs` — est donc RECOPIÉE À LA MAIN dans le SQL. S'appuyer
 * sur les policies ferait entrer dans le roster le message de règlement masqué
 * par le staff, un message effacé de Discord, ou les créations d'une campagne
 * dépubliée. Chacune de ces lignes vaudrait un ticket de tirage à quelqu'un.
 *
 * ── CE QUE CE MODULE NE FAIT PAS, ET C'EST DÉLIBÉRÉ ────────────────────────
 * 1. IL NE CALCULE AUCUNE EMPREINTE D'IMAGE. `sharp` n'est pas chargé dans le
 *    process `website-web` (il vit dans `apps/website/node_modules` et n'est tiré
 *    que par les scripts), un clic d'admin ne doit pas déclencher 27
 *    téléchargements sur `pbs.twimg.com`, et une empreinte perceptuelle coûte des
 *    secondes. `x_campagne_oeuvres` fait AUTORITÉ ; c'est
 *    `scripts/campagnes/empreintes-oeuvres.ts` qui la peuple, hors ligne. Toute
 *    création récoltée depuis le dernier passage du script remonte dans
 *    `creationsSansOeuvre`, et l'engagement est REFUSÉ tant qu'il en reste.
 * 2. IL NE FUSIONNE JAMAIS DEUX IDENTITÉS TOUT SEUL. Rapprocher
 *    `kittyshadow_` (X) de `kittycaillou` (Discord) demandait une empreinte
 *    d'image et une signature peinte dans l'illustration — aucune règle de
 *    pseudo ne l'aurait trouvé (ils ne partagent que « kitty », et le nom affiché
 *    côté X est « sigmimi »). Les suggestions mécaniques sont PROPOSÉES, jamais
 *    appliquées : `bilanRoster().suggestions`.
 * 3. IL NE DÉCIDE D'AUCUNE ÉLIGIBILITÉ. Écarter le staff, ou appliquer la règle 1
 *    à la lettre (« sur Twitter ou Instagram », ce qui retirerait toute chance à
 *    4 personnes), sont des arbitrages humains. Ils passent par un interrupteur
 *    tracé avec un motif obligatoire, jamais par un `where` glissé ici.
 *
 * ── LES DEUX PIÈGES DE TYPE QUI ONT COÛTÉ DU TEMPS ─────────────────────────
 * · `balise_round` est un `bigint`, et node-postgres rend les `int8` en CHAÎNE
 *   (pour ne pas perdre de précision au-delà de 2^53). Sans `Number(...)`, le
 *   round part en `"31547509"` dans l'empreinte d'engagement, qui attend
 *   `String(31547509)` — la vérification échoue sur un tirage pourtant honnête.
 * · Le piège « `Bun.SQL` + `::jsonb` + `JSON.stringify()` = double encodage »
 *   documenté dans le dépôt NE S'APPLIQUE PAS ici : on passe par `pg`
 *   (node-postgres), qui sérialise lui-même les objets JS liés à un paramètre.
 *   On lie donc l'OBJET BRUT, jamais une chaîne pré-stringifiée — même règle
 *   finale, raison différente.
 *
 *   ⚠ MAIS LE CAS SYMÉTRIQUE MORD, RENCONTRÉ EN VRAI LE 23/8/2026 : un TABLEAU JS
 *   lié à un paramètre `::jsonb` est sérialisé par node-postgres en littéral de
 *   TABLEAU POSTGRES (`{…}`), pas en JSON — Postgres répond alors « invalid input
 *   syntax for type json / Expected ":", but found "}" ». La règle exacte est donc :
 *   OBJET à la racine → valeur brute ; TABLEAU à la racine → `JSON.stringify()`.
 *   Ce module ne lie que des objets (`{ lots }`, `identifiants`), mais
 *   `x_campagne_oeuvres.creations` EST un tableau : le script
 *   `empreintes-oeuvres.ts`, qui l'écrira, tombera dessus.
 *
 * Toute lecture dont dépend une page PUBLIQUE est enveloppée d'un try/catch avec
 * repli neutre : personne ne doit tomber sur une 500 en venant voir des dessins.
 * Les écritures, elles, LÈVENT — une server action doit pouvoir dire pourquoi
 * elle a échoué, et surtout ne jamais laisser croire qu'un tirage a eu lieu.
 */

/**
 * Espace de nommage des verrous consultatifs de tirage : `0x52475449` (« RGTI »).
 *
 * `pg_advisory_xact_lock(int, int)` prend deux `int4` ; celui-ci tient dans la
 * borne (1 380 271 689 < 2 147 483 647). L'espace évite qu'un `hashtext(slug)`
 * de tirage entre en collision avec un verrou posé ailleurs sur le même hash.
 */
const ESPACE_VERROU_TIRAGE = 1_380_271_689;

/** Deux essais, une seconde d'écart, huit secondes par essai. Voir `recupererBalise`. */
const DRAND_ESSAIS = 2;
const DRAND_DELAI_MS = 8_000;

/* ── DATES ─────────────────────────────────────────────────────────────────
 * Les dates traversent la frontière serveur → client : TOUJOURS en chaîne ISO.
 * Un objet `Date` passé à un composant client est sérialisé par Next puis
 * re-hydraté en chaîne, donc `.getTime()` casse côté navigateur au premier
 * appel — et seulement en production, là où le rendu est vraiment scindé.
 *
 * ⚠ DOUBLON ASSUMÉ ET SIGNALÉ : `queries.ts` porte la même fonction, privée. La
 * remonter dans `./types` (module pur, déjà importé des deux côtés) est le bon
 * geste, mais il touche un troisième fichier — à faire dans la passe qui
 * réunira aussi `Chiffre` et `quand()`.
 */
function versISO(valeur: Date | string | null | undefined): string | null {
  if (!valeur) {
    return null;
  }
  if (valeur instanceof Date) {
    return Number.isNaN(valeur.getTime()) ? null : valeur.toISOString();
  }
  const date = new Date(valeur);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** `bigint` node-postgres → `number`. Voir le piège de type en tête de fichier. */
function versNombre(valeur: number | string | null | undefined): number | null {
  if (valeur === null || valeur === undefined) {
    return null;
  }
  const nombre = typeof valeur === "number" ? valeur : Number(valeur);
  return Number.isFinite(nombre) ? nombre : null;
}

function messageErreur(erreur: unknown): string {
  return erreur instanceof Error ? erreur.message : String(erreur);
}

/* ── CRÉATIONS BRUTES ─────────────────────────────────────────────────────── */

/** Une création telle qu'elle sort des trois sources, avant tout dédoublonnage. */
export interface CreationBrute {
  source: SourceTirage;
  /** `tweets.id`, `discord_messages.message_id` ou `campagne_creations_instagram.shortcode`. */
  identifiant: string;
  /**
   * L'identité de plateforme, sous sa forme IMMUABLE : `x:<author_id>`,
   * `discord:<author_id>`, `instagram:<pseudo en minuscules>`.
   *
   * ⚠ CÔTÉ X, C'EST BIEN UN IDENTIFIANT NUMÉRIQUE, PAS LE HANDLE. `tweets.author_id`
   * est renseigné sur les 9 tweets de la campagne (vérifié en base), et le corpus
   * prouve qu'un handle change alors que l'identifiant survit : l'`author_id`
   * `1451855639592849409` y porte DEUX handles historiques. Clé sur le handle,
   * un participant qui se renomme après la révélation de la graine se refabrique
   * un ticket.
   *
   * ⚠ INSTAGRAM EST LE SEUL POINT FRAGILE, et il est irréductible :
   * `campagne_creations_instagram` n'a PAS de colonne d'identifiant numérique,
   * seulement `auteur_pseudo`. Cette clé-là ne survivrait pas à un changement de
   * pseudo. C'est écrit ici plutôt que découvert plus tard.
   *
   * `null` quand la source ne donne aucune identité exploitable — la création est
   * alors écartée avec un motif, pas rattachée à un participant fantôme.
   */
  cleIdentite: string | null;
  auteurNom: string | null;
  auteurPseudo: string | null;
  publieLe: string | null;
  /** Nombre de fichiers joints. ⚠ Ce n'est PAS un nombre d'œuvres : voir `bilanRoster`. */
  nbImages: number;
}

/** Idem, plus le verdict de visibilité — ce qui permet d'expliquer chaque retrait. */
export interface CreationExaminee extends CreationBrute {
  retenue: boolean;
  /** `null` si retenue ; sinon la raison, en français, telle qu'affichée à l'admin. */
  motifEcart: string | null;
}

interface LigneCreationBrute {
  source: string;
  identifiant: string;
  cle_identite: string | null;
  auteur_nom: string | null;
  auteur_pseudo: string | null;
  horodatage: Date | string | null;
  nb_images: number;
  motif_ecart: string | null;
}

function versCreation(ligne: LigneCreationBrute): CreationExaminee {
  const source: SourceTirage =
    ligne.source === "x" || ligne.source === "discord" || ligne.source === "instagram" ? ligne.source : "x";
  return {
    auteurNom: ligne.auteur_nom,
    auteurPseudo: ligne.auteur_pseudo,
    cleIdentite: ligne.cle_identite,
    identifiant: ligne.identifiant,
    motifEcart: ligne.motif_ecart,
    nbImages: versNombre(ligne.nb_images) ?? 1,
    publieLe: versISO(ligne.horodatage),
    retenue: ligne.motif_ecart === null,
    source,
  };
}

/**
 * Toutes les créations de la campagne, retenues ET écartées, chacune motivée.
 *
 * ⚠ MESURÉ SUR `iergday` LE 23/8/2026 : 21 créations brutes, 20 retenues, UNE
 * écartée — le rappel du règlement posté par le staff, masqué en base avec son
 * motif. Tous les autres filtres retirent ZÉRO ligne aujourd'hui. Ce n'est pas
 * une raison de les enlever : le filtre `comptes_organisateurs` par exemple ne
 * mord pas parce que le tweet d'annonce de `@rose_griffon` existe bien dans
 * `tweets` mais n'a jamais été rattaché à `x_campagne_posts`. C'est une ceinture
 * par-dessus des bretelles, et la prochaine collecte pourrait, elle, le rattacher.
 */
export async function listerCreationsExaminees(slug: string): Promise<CreationExaminee[]> {
  try {
    const { rows } = await getPgPool().query<LigneCreationBrute>(SQL_CREATIONS, [slug]);
    return rows.map(versCreation);
  } catch (erreur) {
    console.error("Erreur de lecture des créations de campagne (tirage) :", erreur);
    return [];
  }
}

/** Les seules créations qui peuvent porter un ticket. Vue filtrée de la précédente. */
export async function listerCreationsBrutes(slug: string): Promise<CreationBrute[]> {
  const examinees = await listerCreationsExaminees(slug);
  return examinees.filter(creation => creation.retenue);
}

/* ── ŒUVRES ───────────────────────────────────────────────────────────────── */

/** Une création rattachée à une œuvre, telle qu'elle est gelée dans `creations`. */
export interface CreationDOeuvre {
  source: SourceTirage;
  identifiant: string;
  auteur: string | null;
  publieLe: string | null;
}

/** Une œuvre — l'unité qui porte un ticket. Une PUBLICATION n'en est pas une. */
export interface OeuvreAdmin {
  oeuvreId: string;
  cle: string;
  /**
   * La publication qui ATTESTE l'éligibilité, au titre de la règle 1 du règlement
   * en base (« Postez une image […] sur Twitter ou Instagram »). Discord n'est
   * que le salon de dépôt.
   */
  creationGardee: { source: SourceTirage; identifiant: string };
  creations: CreationDOeuvre[];
  nbCreations: number;
  sha256: string | null;
  dhash: string | null;
  phash: string | null;
  largeur: number | null;
  hauteur: number | null;
  /**
   * Le MEILLEUR fichier, indépendamment de la source — question distincte de la
   * précédente, d'où deux colonnes. Mesuré sur les 4 groupes de doublons
   * d'`iergday` : le PNG Discord l'emporte trois fois (jusqu'à 2 734 × 2 269
   * contre un JPEG X, et 1 720 × 2 428 contre 850 × 1 200), le JPEG X une fois
   * (4 096 × 3 459 contre 2 558 × 2 160). Servir un fichier deux fois plus petit
   * parce que « X compte » abîmerait le dessin pour une raison administrative ;
   * créditer Discord parce que le fichier y est meilleur contredirait le règlement.
   */
  imageMaster: { source: SourceTirage; identifiant: string; index: number; url: string } | null;
  motifRegroupement: string | null;
}

interface LigneOeuvre {
  oeuvre_id: string;
  cle: string;
  creation_gardee_source: string;
  creation_gardee_id: string;
  creations: unknown;
  nb_creations: number;
  sha256: string | null;
  dhash: string | null;
  phash: string | null;
  largeur: number | null;
  hauteur: number | null;
  image_master_source: string | null;
  image_master_id: string | null;
  image_master_index: number | null;
  image_master_chemin: string | null;
  image_master_url: string | null;
  motif_regroupement: string | null;
}

const SQL_OEUVRES = `
	select o.oeuvre_id, o.cle, o.creation_gardee_source, o.creation_gardee_id, o.creations,
	       o.nb_creations, o.sha256, o.dhash, o.phash, o.largeur, o.hauteur,
	       o.image_master_source, o.image_master_id, o.image_master_index,
	       o.image_master_chemin, o.image_master_url, o.motif_regroupement
	  from public.x_campagne_oeuvres o
	 where o.campagne_slug = $1
	 order by o.nb_creations desc, o.oeuvre_id`;

function versSource(brut: unknown): SourceTirage | null {
  return brut === "x" || brut === "discord" || brut === "instagram" ? brut : null;
}

/** Les `(source, identifiant)` gelés dans `x_campagne_oeuvres.creations`, défensivement. */
function creationsDOeuvre(brut: unknown): Array<{ source: SourceTirage; identifiant: string }> {
  if (!Array.isArray(brut)) {
    return [];
  }
  const sorties: Array<{ source: SourceTirage; identifiant: string }> = [];
  for (const entree of brut) {
    if (!entree || typeof entree !== "object") {
      continue;
    }
    const objet = entree as { source?: unknown; identifiant?: unknown };
    const source = versSource(objet.source);
    if (!source || typeof objet.identifiant !== "string" || objet.identifiant.length === 0) {
      continue;
    }
    sorties.push({ identifiant: objet.identifiant, source });
  }
  return sorties;
}

function versOeuvre(ligne: LigneOeuvre, brutes: Map<string, CreationBrute>): OeuvreAdmin {
  const gardeeSource = versSource(ligne.creation_gardee_source) ?? "x";
  const masterSource = versSource(ligne.image_master_source);
  // `image_master_url` d'abord (fichier X ré-hébergé ailleurs), sinon le chemin
  // dans le bucket `assets`. Les deux peuvent être nuls : l'animation retombe
  // alors sur `post.images[0]`, et le CHECK `…_master_affichable` garantit qu'une
  // source déclarée s'accompagne toujours de l'un des deux.
  const urlMaster = ligne.image_master_url ?? urlImageAsset(ligne.image_master_chemin);
  return {
    cle: ligne.cle,
    creationGardee: { identifiant: ligne.creation_gardee_id, source: gardeeSource },
    creations: creationsDOeuvre(ligne.creations).map(creation => {
      const brute = brutes.get(`${creation.source}:${creation.identifiant}`);
      return {
        auteur: brute?.auteurNom ?? brute?.auteurPseudo ?? null,
        identifiant: creation.identifiant,
        publieLe: brute?.publieLe ?? null,
        source: creation.source,
      };
    }),
    dhash: ligne.dhash,
    hauteur: versNombre(ligne.hauteur),
    imageMaster:
      masterSource && ligne.image_master_id && urlMaster
        ? {
            identifiant: ligne.image_master_id,
            index: versNombre(ligne.image_master_index) ?? 0,
            source: masterSource,
            url: urlMaster,
          }
        : null,
    largeur: versNombre(ligne.largeur),
    motifRegroupement: ligne.motif_regroupement,
    nbCreations: versNombre(ligne.nb_creations) ?? 1,
    oeuvreId: ligne.oeuvre_id,
    phash: ligne.phash,
    sha256: ligne.sha256,
  };
}

/** Les œuvres de la campagne, enrichies de l'auteur et de la date de chaque création. */
export async function listerOeuvres(slug: string): Promise<OeuvreAdmin[]> {
  try {
    const [{ rows }, brutes] = await Promise.all([
      getPgPool().query<LigneOeuvre>(SQL_OEUVRES, [slug]),
      listerCreationsBrutes(slug),
    ]);
    const parCle = new Map(brutes.map(creation => [`${creation.source}:${creation.identifiant}`, creation]));
    return rows.map(ligne => versOeuvre(ligne, parCle));
  } catch (erreur) {
    console.error("Erreur de lecture des œuvres de campagne :", erreur);
    return [];
  }
}

/* ── PARTICIPANTS ─────────────────────────────────────────────────────────── */

export interface ParticipantAdmin {
  /** Identifiant IMMUABLE. Jamais un pseudo — cf. `CreationBrute.cleIdentite`. */
  cle: string;
  pseudoAffichage: string;
  sources: SourceTirage[];
  /**
   * ⚠ DONNÉE FERMÉE. Porte le lien inter-plateformes
   * (`discord_id` ↔ `x_id` ↔ `instagram_pseudo`) que PERSONNE n'a publié : c'est
   * nous qui l'avons établi à l'empreinte d'image. `x_campagne_participants` n'a
   * aucun `grant` et sa RLS est activée sans policy, exprès. Ne jamais faire
   * remonter ce champ dans une forme publique — la forme publique du classement
   * porte `clePublique()`, pas ceci.
   */
  identifiants: Record<string, unknown>;
  nbOeuvres: number;
  nbCreationsBrutes: number;
  premiereLe: string | null;
  derniereLe: string | null;
  eligible: boolean;
  motifIneligible: string | null;
  /** Non nul = cette ligne est un ALIAS ; son poids est nul et ses œuvres ont migré. */
  fusionneDans: string | null;
  notes: string | null;
  /** Ligne arbitrée à la main : ni la migration ni `reconstruireRoster` n'y touchent. */
  verrouille: boolean;
  oeuvres: OeuvreAdmin[];
}

interface LigneParticipant {
  cle: string;
  pseudo_affichage: string;
  sources: string[] | null;
  identifiants: unknown;
  nb_oeuvres: number;
  nb_creations_brutes: number;
  premiere_le: Date | string | null;
  derniere_le: Date | string | null;
  eligible: boolean;
  motif_ineligible: string | null;
  fusionne_dans: string | null;
  notes: string | null;
  verrouille: boolean;
}

/*
 * ⚠ PAS DE `c.publiee` ICI, ET C'EST VOLONTAIRE. Cette lecture ne sert QUE
 * l'écran d'administration, déjà gardé par `exigerAdmin()` : un admin doit
 * pouvoir préparer le roster d'une campagne encore dépubliée. La garde de
 * publication vit là où elle compte — dans `SQL_CREATIONS` (donc le roster d'une
 * campagne dépubliée est vide) et dans `chargerTiragePublie` (donc rien ne
 * s'affiche publiquement).
 */
const SQL_PARTICIPANTS = `
	select p.cle, p.pseudo_affichage, p.sources, p.identifiants, p.nb_oeuvres,
	       p.nb_creations_brutes, p.premiere_le, p.derniere_le, p.eligible,
	       p.motif_ineligible, p.fusionne_dans, p.notes, p.verrouille
	  from public.x_campagne_participants p
	 where p.campagne_slug = $1
	 order by p.nb_oeuvres desc, lower(p.pseudo_affichage), p.cle`;

function versParticipant(ligne: LigneParticipant, oeuvres: OeuvreAdmin[]): ParticipantAdmin {
  const sources: SourceTirage[] = [];
  for (const brut of ligne.sources ?? []) {
    const source = versSource(brut);
    if (source) {
      sources.push(source);
    }
  }
  return {
    cle: ligne.cle,
    derniereLe: versISO(ligne.derniere_le),
    eligible: ligne.eligible,
    fusionneDans: ligne.fusionne_dans,
    identifiants:
      ligne.identifiants && typeof ligne.identifiants === "object" && !Array.isArray(ligne.identifiants)
        ? (ligne.identifiants as Record<string, unknown>)
        : {},
    motifIneligible: ligne.motif_ineligible,
    nbCreationsBrutes: versNombre(ligne.nb_creations_brutes) ?? 0,
    nbOeuvres: versNombre(ligne.nb_oeuvres) ?? 0,
    notes: ligne.notes,
    oeuvres,
    premiereLe: versISO(ligne.premiere_le),
    pseudoAffichage: ligne.pseudo_affichage,
    sources,
    verrouille: ligne.verrouille,
  };
}

/** Le roster complet, alias et inéligibles compris — c'est un écran d'arbitrage, pas une liste de gagnants. */
export async function listerParticipants(slug: string): Promise<ParticipantAdmin[]> {
  try {
    const [{ rows }, oeuvres] = await Promise.all([
      getPgPool().query<LigneParticipant>(SQL_PARTICIPANTS, [slug]),
      listerOeuvres(slug),
    ]);
    const parCle = new Map<string, OeuvreAdmin[]>();
    for (const oeuvre of oeuvres) {
      const liste = parCle.get(oeuvre.cle);
      if (liste) {
        liste.push(oeuvre);
      } else {
        parCle.set(oeuvre.cle, [oeuvre]);
      }
    }
    return rows.map(ligne => versParticipant(ligne, parCle.get(ligne.cle) ?? []));
  } catch (erreur) {
    console.error("Erreur de lecture des participants de campagne :", erreur);
    return [];
  }
}

/**
 * Les participants qui entrent réellement dans un tirage : éligibles ET canoniques.
 *
 * Les deux conditions sont indépendantes et toutes deux nécessaires. Un ALIAS
 * (`fusionne_dans` non nul) n'a aucune œuvre — elles ont migré sur la ligne
 * canonique — donc l'inclure donnerait un second ticket au même humain, ce que le
 * dédoublonnage venait précisément d'éviter.
 */
export function participantsDuTirage(participants: readonly ParticipantAdmin[]): ParticipantTirage[] {
  return participants
    .filter(participant => participant.eligible && participant.fusionneDans === null)
    .map(participant => ({
      cle: participant.cle,
      nbOeuvres: participant.nbOeuvres,
      // Ordre canonique : `tirerOeuvre` indexe dans ce tableau, donc deux ordres
      // différents désigneraient deux œuvres différentes pour la même graine.
      oeuvres: participant.oeuvres.map(oeuvre => oeuvre.oeuvreId).toSorted(),
      pseudoAffichage: participant.pseudoAffichage,
    }));
}

/* ── RECONSTRUCTION DU ROSTER ─────────────────────────────────────────────── */

/**
 * Normalisation d'un pseudo, pour les seules SUGGESTIONS de fusion.
 *
 * ⚠ NFKD OBLIGATOIRE, ET LA CAMPAGNE EN DONNE LA PREUVE. Le nom affiché de
 * Haroldinho est « 𝐻𝑎𝑟𝑜𝑙𝑑𝑖𝑛ℎ𝑜 𒉭 », en italiques mathématiques Unicode plus un
 * signe cunéiforme. Sans NFKD, le simple filtrage `[^a-z0-9]` VIDE entièrement la
 * chaîne — aucun de ces caractères n'est un ASCII alphanumérique. Deux pseudos
 * « vides » se ressembleraient alors parfaitement, et l'écran suggérerait de
 * fusionner deux inconnus. Le NFKD replie ces caractères sur « haroldinho », et
 * les normalisations vides sont écartées du rapprochement plus bas.
 */
function normaliserPseudo(brut: string): string {
  return brut
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Une fusion PROPOSÉE. Rien n'est appliqué : l'appliquer est un acte de modération tracé. */
export interface SuggestionFusion {
  cle: string;
  pseudo: string;
  versCle: string;
  versPseudo: string;
  /** L'indice, en clair. Un rapprochement sans preuve écrite n'est pas une preuve. */
  indice: string;
  confiance: "elevee" | "moyenne" | "faible";
  /** Ce que la fusion changerait vraiment aux comptages — souvent : rien. */
  effetSurLesComptages: string;
}

export interface RapportReconstruction {
  campagneSlug: string;
  creationsBrutes: number;
  creationsEcartees: Array<{ identifiant: string; motif: string }>;
  participantsAvant: number;
  participantsApres: number;
  oeuvres: number;
  /** Lignes `verrouille` rencontrées et laissées intactes, nommément. */
  lignesVerrouillees: string[];
  /** ⚠ Créations récoltées depuis le dernier passage du script d'empreintes. */
  creationsSansOeuvre: string[];
  anomalies: string[];
  simulation: boolean;
}

interface EtatParticipantCalcule {
  cle: string;
  pseudoAffichage: string;
  sources: Set<SourceTirage>;
  nbOeuvres: number;
  nbCreationsBrutes: number;
  premiereLe: string | null;
  derniereLe: string | null;
}

/**
 * Recalcule les COMPTEURS du roster depuis `x_campagne_oeuvres`, qui fait autorité.
 *
 * ── CE QUI EST RECALCULÉ, ET CE QUI NE L'EST JAMAIS ────────────────────────
 * Recalculé : `sources`, `nb_oeuvres`, `nb_creations_brutes`, `premiere_le`,
 * `derniere_le`. Jamais touché : `eligible`, `motif_ineligible`, `fusionne_dans`,
 * `notes`, `pseudo_affichage` d'une ligne existante — ce sont des décisions
 * humaines, et un script qui les écraserait effacerait un arbitrage sans laisser
 * de trace. Les lignes `verrouille` ne sont pas modifiées du tout, et sont listées
 * telles quelles dans le rapport.
 *
 * ── LE DANGER RÉEL DE CETTE FONCTION, ET SA PARADE ─────────────────────────
 * Créer bêtement une ligne pour chaque identité vue dans les créations
 * RESSUSCITERAIT les identités déjà absorbées par une fusion : `San_La_Vraie` (X)
 * a été fusionnée dans `discord:908269053347504170`, et une reconstruction naïve
 * lui rendrait une ligne — donc un second ticket au même humain, exactement ce
 * que le dédoublonnage venait d'empêcher. La parade est de considérer comme DÉJÀ
 * RATTACHÉE toute identité qui apparaît soit comme `cle` d'un participant, soit
 * dans son `identifiants` (`x_id`, `discord_id`, `instagram_pseudo`) : c'est là
 * que la migration d'amorçage a écrit les identités absorbées. Une identité
 * inconnue des deux, elle, est une VRAIE nouvelle personne, et on lui crée une
 * ligne canonique sans jamais deviner de fusion.
 *
 * ⚠ CONSÉQUENCE À CONNAÎTRE AVANT DE S'EN ÉTONNER, MESURÉE LE 23/8/2026 : lancée
 * sur une table de participants VIDE, cette fonction rend **18 personnes** pour
 * `iergday`, pas 14 — une par identité de plateforme distincte (9 X, 8 Discord,
 * 1 Instagram). Ce n'est PAS un défaut : les 4 fusions qui font passer de 18 à 14
 * ont demandé une empreinte d'image et une signature peinte dans l'illustration,
 * et deux d'entre elles étaient invisibles à toute règle de pseudo. Ce sont la
 * migration d'amorçage et l'écran d'admin qui les portent. Un script qui les
 * devinerait donnerait deux tickets à quatre humains.
 */
export async function reconstruireRoster(
  slug: string,
  options?: { simulation?: boolean },
): Promise<RapportReconstruction> {
  const simulation = options?.simulation ?? true;
  const anomalies: string[] = [];

  const [examinees, oeuvres, participants] = await Promise.all([
    listerCreationsExaminees(slug),
    listerOeuvres(slug),
    listerParticipants(slug),
  ]);
  const retenues = examinees.filter(creation => creation.retenue);

  // Index des créations retenues, pour rattacher chaque œuvre à ses dates réelles.
  const brutesParCle = new Map(retenues.map(creation => [`${creation.source}:${creation.identifiant}`, creation]));

  // Toute identité déjà connue du roster, sous sa forme `<plateforme>:<id>` —
  // clé canonique ET identités absorbées. Voir l'encadré ci-dessus.
  const identitesRattachees = new Map<string, string>();
  for (const participant of participants) {
    identitesRattachees.set(participant.cle, participant.cle);
    const ids = participant.identifiants;
    const discordId = typeof ids.discord_id === "string" ? ids.discord_id : null;
    const xId = typeof ids.x_id === "string" ? ids.x_id : null;
    const instagram = typeof ids.instagram_pseudo === "string" ? ids.instagram_pseudo : null;
    if (discordId) {
      identitesRattachees.set(`discord:${discordId}`, participant.cle);
    }
    if (xId) {
      identitesRattachees.set(`x:${xId}`, participant.cle);
    }
    if (instagram) {
      identitesRattachees.set(`instagram:${instagram.toLowerCase()}`, participant.cle);
    }
  }

  // Compteurs, calculés depuis les ŒUVRES : c'est l'œuvre qui porte le ticket,
  // jamais la publication. Munfurawa, Cieran et kittycaillou ont publié DEUX fois
  // le même dessin (Discord puis X) : une chance, pas deux.
  const calcules = new Map<string, EtatParticipantCalcule>();
  const etatDe = (cle: string, pseudo: string): EtatParticipantCalcule => {
    const existant = calcules.get(cle);
    if (existant) {
      return existant;
    }
    const neuf: EtatParticipantCalcule = {
      cle,
      derniereLe: null,
      nbCreationsBrutes: 0,
      nbOeuvres: 0,
      premiereLe: null,
      pseudoAffichage: pseudo,
      sources: new Set<SourceTirage>(),
    };
    calcules.set(cle, neuf);
    return neuf;
  };

  const creationsCouvertes = new Set<string>();
  for (const oeuvre of oeuvres) {
    const participant = participants.find(candidat => candidat.cle === oeuvre.cle);
    const etat = etatDe(oeuvre.cle, participant?.pseudoAffichage ?? oeuvre.cle);
    etat.nbOeuvres += 1;
    for (const creation of oeuvre.creations) {
      const cleCreation = `${creation.source}:${creation.identifiant}`;
      creationsCouvertes.add(cleCreation);
      etat.nbCreationsBrutes += 1;
      etat.sources.add(creation.source);
      const brute = brutesParCle.get(cleCreation);
      const date = brute?.publieLe ?? creation.publieLe;
      if (date) {
        if (!etat.premiereLe || date < etat.premiereLe) {
          etat.premiereLe = date;
        }
        if (!etat.derniereLe || date > etat.derniereLe) {
          etat.derniereLe = date;
        }
      }
    }
  }

  // Créations retenues qu'aucune œuvre ne couvre : la collecte est plus récente
  // que les empreintes. C'est bloquant pour l'engagement, pas pour la lecture.
  const creationsSansOeuvre: string[] = [];
  for (const creation of retenues) {
    const cleCreation = `${creation.source}:${creation.identifiant}`;
    if (!creationsCouvertes.has(cleCreation)) {
      creationsSansOeuvre.push(cleCreation);
    }
  }
  if (creationsSansOeuvre.length > 0) {
    anomalies.push(
      `${creationsSansOeuvre.length} création(s) ne sont rattachées à aucune œuvre — lancer ` +
        "`bun scripts/campagnes/empreintes-oeuvres.ts --campagne " +
        `${slug}\` avant de tirer, sinon ces dessins n'auront aucun ticket.`,
    );
  }

  // Identités vues dans les créations retenues et inconnues du roster : de VRAIES
  // nouvelles personnes. On leur crée une ligne canonique, à zéro compteur, et on
  // ne devine AUCUNE fusion — c'est le script d'empreintes puis un humain qui
  // trancheront.
  const nouvelles = new Map<string, CreationBrute>();
  for (const creation of retenues) {
    if (!creation.cleIdentite || identitesRattachees.has(creation.cleIdentite)) {
      continue;
    }
    if (!nouvelles.has(creation.cleIdentite)) {
      nouvelles.set(creation.cleIdentite, creation);
    }
  }

  const lignesVerrouillees = participants.filter(p => p.verrouille).map(p => `${p.cle} (${p.pseudoAffichage})`);
  const rapport: RapportReconstruction = {
    anomalies,
    campagneSlug: slug,
    creationsBrutes: retenues.length,
    creationsEcartees: examinees
      .filter(creation => !creation.retenue)
      .map(creation => ({
        identifiant: `${creation.source}:${creation.identifiant}`,
        motif: creation.motifEcart ?? "motif inconnu",
      })),
    creationsSansOeuvre,
    lignesVerrouillees,
    oeuvres: oeuvres.length,
    participantsApres: participants.length + nouvelles.size,
    participantsAvant: participants.length,
    simulation,
  };

  if (nouvelles.size > 0) {
    anomalies.push(
      `${nouvelles.size} identité(s) inconnue(s) du roster : ${[...nouvelles.keys()].join(", ")}. ` +
        "Une ligne canonique leur est créée, SANS fusion — vérifier à la main si l'une d'elles " +
        "est en réalité une personne déjà présente sous une autre plateforme.",
    );
  }

  if (simulation) {
    return rapport;
  }

  const client = await getPgPool().connect();
  try {
    await client.query("begin");
    // Le même verrou que l'engagement et le tirage : reconstruire pendant qu'un
    // tirage se joue changerait le roster sous les pieds du calcul.
    await client.query("select pg_advisory_xact_lock($1::int, hashtext($2)::int)", [ESPACE_VERROU_TIRAGE, slug]);

    // Un engagement non tiré gèle le roster : `empreinte_participants` a été
    // publiée, la modifier la rendrait invérifiable. Refuser ici plutôt que de
    // laisser la vérification échouer plus tard sans qu'on sache pourquoi.
    const { rows: enAttente } = await client.query<{ numero: number }>(
      `select numero from public.x_campagne_tirages
			  where campagne_slug = $1 and graine is null and annule_le is null
			  limit 1`,
      [slug],
    );
    const engagementOuvert = enAttente[0];
    if (engagementOuvert) {
      throw new Error(
        `Un engagement est ouvert (tirage n°${engagementOuvert.numero}) : son roster est gelé et son empreinte ` +
          "déjà publiée. Annulez-le avant de reconstruire, sinon la vérification du tirage échouera.",
      );
    }

    for (const [cle, creation] of nouvelles) {
      // Une transaction est SÉQUENTIELLE par définition : un seul `PoolClient` ne peut
      // pas exécuter deux requêtes de front, et un `Promise.all` entrelacerait les
      // écritures d'une même transaction. L'`await` en boucle est ici la forme correcte.
      // oxlint-disable-next-line eslint/no-await-in-loop
      await client.query(
        `insert into public.x_campagne_participants
				        (campagne_slug, cle, pseudo_affichage, sources, identifiants,
				         nb_oeuvres, nb_creations_brutes, premiere_le, derniere_le)
				 values ($1, $2, $3, '{}'::text[], $4::jsonb, 0, 0, null, null)
				 on conflict (campagne_slug, cle) do nothing`,
        [
          slug,
          cle,
          creation.auteurNom || creation.auteurPseudo || cle,
          // Objet JS BRUT : node-postgres sérialise lui-même (cf. l'en-tête).
          { cle_lisible: creation.auteurPseudo ?? cle, origine: "reconstruction automatique" },
        ],
      );
    }

    for (const etat of calcules.values()) {
      // `where not verrouille` : une ligne arbitrée à la main est intouchable, y
      // compris par cette reconstruction. `where cle = …` sans `nb_oeuvres` dans
      // le `set` pour un alias : un alias ne porte aucun poids (CHECK
      // `x_campagne_participants_alias_sans_poids`), et ses œuvres ont migré, donc
      // il n'apparaît de toute façon pas dans `calcules`.
      // Une transaction est SÉQUENTIELLE par définition : un seul `PoolClient` ne peut
      // pas exécuter deux requêtes de front, et un `Promise.all` entrelacerait les
      // écritures d'une même transaction. L'`await` en boucle est ici la forme correcte.
      // oxlint-disable-next-line eslint/no-await-in-loop
      await client.query(
        `update public.x_campagne_participants
				    set sources = $3::text[], nb_oeuvres = $4, nb_creations_brutes = $5,
				        premiere_le = $6::timestamptz, derniere_le = $7::timestamptz
				  where campagne_slug = $1 and cle = $2 and not verrouille`,
        [
          slug,
          etat.cle,
          [...etat.sources].toSorted(),
          etat.nbOeuvres,
          Math.max(etat.nbOeuvres, etat.nbCreationsBrutes),
          etat.premiereLe,
          etat.derniereLe,
        ],
      );
    }

    // Les participants canoniques SANS aucune œuvre retombent à zéro : sans ce
    // passage, quelqu'un dont la dernière œuvre a été masquée garderait son
    // ancien compteur, donc son ticket, alors que la galerie ne montre plus rien
    // de lui.
    await client.query(
      `update public.x_campagne_participants p
			    set nb_oeuvres = 0, nb_creations_brutes = 0
			  where p.campagne_slug = $1 and not p.verrouille
			    and (p.nb_oeuvres <> 0 or p.nb_creations_brutes <> 0)
			    and not exists (select 1 from public.x_campagne_oeuvres o
			                     where o.campagne_slug = p.campagne_slug and o.cle = p.cle)`,
      [slug],
    );

    await client.query("commit");
  } catch (erreur) {
    await client.query("rollback");
    throw erreur;
  } finally {
    client.release();
  }

  return rapport;
}

/* ── BILAN ────────────────────────────────────────────────────────────────── */

export interface BilanRoster {
  personnes: number;
  personnesEligibles: number;
  oeuvres: number;
  creationsBrutes: number;
  /** Publications retirées par le dédoublonnage : `Σ (nb_creations − 1)`. */
  doublonsRegroupes: number;
  poidsTotalUnParPersonne: number;
  poidsTotalParOeuvre: number;
  poidsMax: number;
  poidsMaxPseudo: string | null;
  chanceRang1UnParPersonne: number;
  chanceRang1ParOeuvreMax: number;
  chanceRang1ParOeuvreMin: number;
  /** Œuvres attestées par un dépôt Discord seul — l'arbitrage de la règle 1. */
  regle1SansPendant: Array<{ cle: string; pseudo: string; creation: string }>;
  suggestions: SuggestionFusion[];
  creationsSansOeuvre: number;
}

/** Bilan neutre : ce que l'écran affiche quand la base ne répond pas. */
const BILAN_VIDE: BilanRoster = {
  chanceRang1ParOeuvreMax: 0,
  chanceRang1ParOeuvreMin: 0,
  chanceRang1UnParPersonne: 0,
  creationsBrutes: 0,
  creationsSansOeuvre: 0,
  doublonsRegroupes: 0,
  oeuvres: 0,
  personnes: 0,
  personnesEligibles: 0,
  poidsMax: 0,
  poidsMaxPseudo: null,
  poidsTotalParOeuvre: 0,
  poidsTotalUnParPersonne: 0,
  regle1SansPendant: [],
  suggestions: [],
};

/**
 * Suggestions de fusion, MÉCANIQUES et conservatrices.
 *
 * Deux niveaux seulement, tous deux vérifiables par quiconque relit la liste :
 * égalité EXACTE des pseudos normalisés (niveau fort), et inclusion stricte de
 * l'un dans l'autre sur au moins 6 caractères (niveau faible). Rien de flou, pas
 * de distance d'édition : la ressemblance approximative est précisément ce qui
 * fusionnerait deux personnes différentes.
 *
 * ⚠ ET CE FILET NE SUFFIT PAS, C'EST MESURÉ. Deux des quatre fusions réelles
 * d'`iergday` sont INVISIBLES à toute règle de pseudo : `kittyshadow_` /
 * `kittycaillou` (nom affiché X : « sigmimi ») et `Fujo_Kiran` / `fujorin` ne
 * partagent que 4 à 5 caractères de préfixe. Elles n'ont été établies que par
 * l'empreinte d'image et par une signature peinte dans l'illustration. Ce qui
 * sort d'ici est donc un point de départ, jamais une conclusion.
 */
function suggererFusions(participants: readonly ParticipantAdmin[]): SuggestionFusion[] {
  const canoniques = participants.filter(p => p.fusionneDans === null);
  const suggestions: SuggestionFusion[] = [];
  for (let i = 0; i < canoniques.length; i += 1) {
    for (let j = i + 1; j < canoniques.length; j += 1) {
      const a = canoniques[i];
      const b = canoniques[j];
      if (!a || !b) {
        continue;
      }
      const na = normaliserPseudo(a.pseudoAffichage);
      const nb = normaliserPseudo(b.pseudoAffichage);
      // Une normalisation vide n'est pas une ressemblance : sans cette garde, deux
      // pseudos entièrement non-ASCII (cf. Haroldinho) se « ressembleraient »
      // parfaitement et l'écran proposerait de fusionner deux inconnus.
      if (na.length < 3 || nb.length < 3) {
        continue;
      }
      const identiques = na === nb;
      const inclus = !identiques && (na.includes(nb) || nb.includes(na)) && Math.min(na.length, nb.length) >= 6;
      if (!identiques && !inclus) {
        continue;
      }
      // La cible est la ligne qui porte le PLUS d'œuvres : fusionner vers la ligne
      // la plus pauvre obligerait à déplacer davantage de données pour rien.
      const [alias, cible] = a.nbOeuvres <= b.nbOeuvres ? [a, b] : [b, a];
      suggestions.push({
        cle: alias.cle,
        confiance: identiques ? "elevee" : "faible",
        effetSurLesComptages:
          alias.nbOeuvres === 0
            ? "aucun : la ligne absorbée ne porte aucune œuvre, donc aucun ticket ne change de main."
            : `${alias.nbOeuvres} œuvre(s) passeraient sur ${cible.pseudoAffichage}, qui gagnerait autant de tickets ` +
              "et ferait perdre une personne au décompte.",
        indice: identiques
          ? `Pseudos strictement identiques après normalisation NFKD : « ${alias.pseudoAffichage} » et « ${cible.pseudoAffichage} » donnent tous deux « ${na} ».`
          : `Un pseudo normalisé contient l'autre : « ${na} » et « ${nb} ». Indice FAIBLE — deux personnes peuvent choisir des pseudos proches. Exiger une seconde preuve (empreinte d'image, signature dans l'illustration, lien auto-déclaré) avant d'appliquer.`,
        pseudo: alias.pseudoAffichage,
        versCle: cible.cle,
        versPseudo: cible.pseudoAffichage,
      });
    }
  }
  return suggestions;
}

/**
 * TOUT est calculé ici, l'UI ne dérive rien.
 *
 * ⚠ LA PHRASE À NE JAMAIS ÉCRIRE À PARTIR DE CES CHIFFRES : « deux œuvres = deux
 * fois plus de chances de gagner ». `chanceRang1ParOeuvreMax` est la chance au
 * RANG 1, et elle seule est proportionnelle au poids. Dès qu'il y a plusieurs
 * gagnants, la probabilité de figurer parmi eux est STRICTEMENT INFÉRIEURE à
 * `N·w/W` : mesuré sur 200 000 tirages à 3 gagnants, une personne de poids 3
 * sort 82 366 fois là où « 3·w/W » en annonce 90 000. La formulation juste est
 * « chaque œuvre est un ticket, tirés un par un sans remise ».
 */
export async function bilanRoster(slug: string): Promise<BilanRoster> {
  try {
    const [participants, oeuvres, examinees] = await Promise.all([
      listerParticipants(slug),
      listerOeuvres(slug),
      listerCreationsExaminees(slug),
    ]);
    const retenues = examinees.filter(creation => creation.retenue);
    const eligibles = participants.filter(p => p.eligible && p.fusionneDans === null);

    const poids = eligibles.map(p => Math.min(MAX_POIDS, Math.max(1, p.nbOeuvres)));
    const poidsTotalParOeuvre = poids.reduce((somme, valeur) => somme + valeur, 0);
    const poidsMax = poids.length > 0 ? Math.max(...poids) : 0;
    const poidsMin = poids.length > 0 ? Math.min(...poids) : 0;
    const porteur = eligibles.find(p => Math.min(MAX_POIDS, Math.max(1, p.nbOeuvres)) === poidsMax);

    const couvertes = new Set<string>();
    let doublons = 0;
    const regle1SansPendant: BilanRoster["regle1SansPendant"] = [];
    for (const oeuvre of oeuvres) {
      doublons += Math.max(0, oeuvre.nbCreations - 1);
      for (const creation of oeuvre.creations) {
        couvertes.add(`${creation.source}:${creation.identifiant}`);
      }
      // La règle 1 du règlement en base dit « sur Twitter ou Instagram ». Une œuvre
      // dont la création gardée est un dépôt Discord n'a donc AUCUN pendant sur une
      // surface citée par la règle. Signalé, chiffré, jamais appliqué : appliqué à
      // la lettre, cet arbitrage retire toute chance à 4 personnes et fait passer
      // Sanada de 2 œuvres à 1 — alors que personne n'a participé en sachant qu'un
      // tirage existerait.
      if (oeuvre.creationGardee.source === "discord") {
        const participant = participants.find(candidat => candidat.cle === oeuvre.cle);
        regle1SansPendant.push({
          cle: oeuvre.cle,
          creation: oeuvre.oeuvreId,
          pseudo: participant?.pseudoAffichage ?? oeuvre.cle,
        });
      }
    }
    const creationsSansOeuvre = retenues.filter(
      creation => !couvertes.has(`${creation.source}:${creation.identifiant}`),
    ).length;

    return {
      chanceRang1ParOeuvreMax: poidsTotalParOeuvre > 0 ? poidsMax / poidsTotalParOeuvre : 0,
      chanceRang1ParOeuvreMin: poidsTotalParOeuvre > 0 ? poidsMin / poidsTotalParOeuvre : 0,
      chanceRang1UnParPersonne: eligibles.length > 0 ? 1 / eligibles.length : 0,
      creationsBrutes: retenues.length,
      creationsSansOeuvre,
      doublonsRegroupes: doublons,
      oeuvres: oeuvres.length,
      personnes: participants.filter(p => p.fusionneDans === null).length,
      personnesEligibles: eligibles.length,
      poidsMax,
      poidsMaxPseudo: porteur?.pseudoAffichage ?? null,
      poidsTotalParOeuvre,
      poidsTotalUnParPersonne: eligibles.length,
      regle1SansPendant,
      suggestions: suggererFusions(participants),
    };
  } catch (erreur) {
    console.error("Erreur de calcul du bilan de roster :", erreur);
    return BILAN_VIDE;
  }
}

/* ── BALISE drand ─────────────────────────────────────────────────────────── */

export interface BaliseDrand {
  round: number;
  signature: string;
  randomness: string;
}

/**
 * Récupère la signature d'un round drand, et REFUSE tout ce qui n'est pas net.
 *
 * Trois contrôles, tous nécessaires : 96 hexadécimaux (48 octets, la taille d'une
 * signature G1) ; le round rendu est bien celui demandé ; et
 * `randomness === SHA-256(signature)`, qui est la relation que drand publie. Sans
 * ce dernier, une réponse tronquée ou un intermédiaire bavard passerait, et la
 * graine serait dérivée d'octets qui ne prouvent rien.
 *
 * ── TROIS COMPORTEMENTS DE L'API, MESURÉS EN DIRECT LE 23/8/2026 ───────────
 * Aucun des trois n'était devinable, et chacun aurait produit un message faux :
 *
 * · UN ROUND FUTUR REND **425 Too Early**, PAS 404. Traité comme un 404 générique,
 *   il partait dans la branche « injoignable », consommait un réessai inutile et
 *   annonçait une panne réseau alors que tout allait bien — le round n'avait
 *   simplement pas encore eu lieu. On ne réessaie donc pas : attendre une seconde
 *   ne fait pas tomber un round qui tombera dans trois minutes.
 * · UN ROUND À QUELQUES SECONDES REND PARFOIS **500**, à la frontière de période
 *   (mesuré sur un round à +3 s). Celui-là EST transitoire : il reste réessayable.
 * · **`/public/0` REND 200** avec le dernier round publié. C'est le piège le plus
 *   sournois : `balise_round` vaut justement 0 pour un engagement en mode `locale`,
 *   et un appel égaré aurait rapporté une VRAIE balise, celle d'un autre round que
 *   celui engagé. D'où le refus explicite de tout round inférieur à 1, avant même
 *   le réseau — le contrôle `rendu !== round` l'attraperait aussi, mais après coup
 *   et avec un message bien moins clair.
 */
export async function recupererBalise(chaine: string, round: number): Promise<BaliseDrand> {
  if (!Number.isInteger(round) || round < 1) {
    throw new Error(
      `Round drand invalide (${String(round)}) : le premier round est le 1. ` +
        "⚠ `/public/0` rend 200 avec le DERNIER round publié — dériver une graine de là reviendrait à " +
        "tirer sur une balise que personne n'avait engagée.",
    );
  }
  if (!/^[0-9a-f]{64}$/.test(chaine)) {
    throw new Error("Chaîne drand invalide : 64 caractères hexadécimaux minuscules sont attendus.");
  }
  let derniere: unknown = null;
  // Une boucle de RÉESSAI est séquentielle par nature — le deuxième essai n'a de
  // sens que si le premier a échoué. Les `await` qu'elle contient sont donc voulus.
  /* oxlint-disable eslint/no-await-in-loop */
  for (let essai = 0; essai < DRAND_ESSAIS; essai += 1) {
    try {
      const reponse = await fetch(`${DRAND_QUICKNET.api}/${chaine}/public/${round}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(DRAND_ESSAIS_DELAI()),
      });
      // 425 = la réponse RÉELLE de drand pour un round futur ; 404 est gardé pour
      // les relais plus anciens ou un miroir tiers, qui répondent encore ainsi.
      if (reponse.status === 425 || reponse.status === 404) {
        const tombeLe = new Date(instantDuRound(round, DRAND_QUICKNET.genesisSec, DRAND_QUICKNET.periodeSec));
        throw new Error(
          `Le round drand #${round} n'est pas encore publié : il tombe à ` +
            `${tombeLe.toLocaleString("fr-FR", { timeZone: "Europe/Paris" })} (heure de Paris). ` +
            "Rien n'a été tiré, le tirage se rejoue tel quel le moment venu.",
        );
      }
      if (!reponse.ok) {
        throw new Error(`drand a répondu ${reponse.status} ${reponse.statusText}.`);
      }
      const charge = (await reponse.json()) as { round?: unknown; signature?: unknown; randomness?: unknown };
      const signature = typeof charge.signature === "string" ? charge.signature.toLowerCase() : "";
      const randomness = typeof charge.randomness === "string" ? charge.randomness.toLowerCase() : "";
      const rendu = versNombre(typeof charge.round === "number" ? charge.round : String(charge.round ?? ""));
      if (!/^[0-9a-f]{96}$/.test(signature)) {
        throw new Error("Signature drand invalide : 96 caractères hexadécimaux sont attendus (48 octets, G1).");
      }
      if (rendu !== round) {
        throw new Error(`drand a rendu le round ${String(rendu)} au lieu du round ${round} demandé.`);
      }
      const attendu = await sha256Hex(depuisHex(signature));
      if (randomness && attendu !== randomness) {
        throw new Error("Incohérence drand : randomness ≠ SHA-256(signature). La réponse n'est pas celle du réseau.");
      }
      return { randomness: randomness || attendu, round, signature };
    } catch (erreur) {
      derniere = erreur;
      // Un round pas encore tombé ne se répare pas en réessayant : inutile
      // d'attendre une seconde de plus pour obtenir le même 404.
      if (erreur instanceof Error && erreur.message.startsWith("Le round drand")) {
        throw erreur;
      }
      if (essai < DRAND_ESSAIS - 1) {
        // `Bun.sleep` et non un `setTimeout` enveloppé : les deux apps tournent
        // sous Bun (`ExecStart=…/bun …/server.js`), le monorepo impose les APIs
        // Bun natives, et `lib/patreon/client.ts` s'en sert déjà pour la même
        // raison — attendre entre deux essais réseau.
        await Bun.sleep(1_000);
      }
    }
  }
  /* oxlint-enable eslint/no-await-in-loop */
  throw new Error(
    `Balise drand injoignable (${messageErreur(derniere)}). Le tirage n'a PAS eu lieu et rien n'a été écrit : ` +
      "il se rejoue tel quel dès que le réseau revient. Le round visé ne bouge pas et sa signature n'expire jamais.",
  );
}

/** Isolé pour rester lisible dans l'appel `fetch` ci-dessus. */
function DRAND_ESSAIS_DELAI(): number {
  return DRAND_DELAI_MS;
}

/* ── TIRAGES : LECTURES ───────────────────────────────────────────────────── */

interface LigneTirage {
  id: string;
  campagne_slug: string;
  numero: number;
  graine: string | null;
  empreinte_graine: string | null;
  empreinte_participants: string;
  empreinte_engagement: string;
  nb_participants: number;
  nb_gagnants: number;
  poids_mode: string;
  parametres: unknown;
  graine_origine: string;
  balise_reseau: string | null;
  balise_chaine: string | null;
  balise_round: string | number | null;
  balise_signature: string | null;
  balise_recuperee_le: Date | string | null;
  engagement_le: Date | string | null;
  engagement_message_id: string | null;
  effectue_le: Date | string | null;
  publie: boolean;
  publie_le: Date | string | null;
  annonce_discord_salon_id: string | null;
  annonce_discord_message_id: string | null;
  annonce_le: Date | string | null;
  annule_le: Date | string | null;
  motif_annulation: string | null;
}

const COLONNES_TIRAGE = `t.id, t.campagne_slug, t.numero, t.graine, t.empreinte_graine,
	       t.empreinte_participants, t.empreinte_engagement, t.nb_participants, t.nb_gagnants,
	       t.poids_mode, t.parametres, t.graine_origine, t.balise_reseau, t.balise_chaine,
	       t.balise_round, t.balise_signature, t.balise_recuperee_le, t.engagement_le,
	       t.engagement_message_id, t.effectue_le, t.publie, t.publie_le,
	       t.annonce_discord_salon_id, t.annonce_discord_message_id, t.annonce_le,
	       t.annule_le, t.motif_annulation`;

function versPoidsMode(brut: string): PoidsMode {
  return brut === "par_oeuvre" ? "par_oeuvre" : "un_par_personne";
}

function versGraineOrigine(brut: string): GraineOrigine {
  return brut === "locale" ? "locale" : "balise";
}

/** Les lots vivent dans `parametres.lots`. Lecture défensive : un jsonb peut tout contenir. */
function lotsDe(parametres: unknown): string[] {
  if (!parametres || typeof parametres !== "object" || Array.isArray(parametres)) {
    return [];
  }
  const brut = (parametres as { lots?: unknown }).lots;
  if (!Array.isArray(brut)) {
    return [];
  }
  return brut.filter((lot): lot is string => typeof lot === "string");
}

/** Un tirage dans l'historique — assez pour l'afficher, pas assez pour le rejouer. */
export interface TirageResume {
  id: string;
  numero: number;
  poidsMode: PoidsMode;
  graineOrigine: GraineOrigine;
  nbParticipants: number;
  nbGagnants: number;
  engagementLe: string | null;
  effectueLe: string | null;
  publie: boolean;
  publieLe: string | null;
  annonceLe: string | null;
  annuleLe: string | null;
  motifAnnulation: string | null;
  baliseRound: number | null;
  /** État lisible, calculé ici pour que l'UI n'ait pas à le redériver. */
  etat: "engage" | "tire" | "publie" | "annule";
}

function versResume(ligne: LigneTirage): TirageResume {
  const etat: TirageResume["etat"] = ligne.annule_le
    ? "annule"
    : ligne.publie
      ? "publie"
      : ligne.graine
        ? "tire"
        : "engage";
  return {
    annonceLe: versISO(ligne.annonce_le),
    annuleLe: versISO(ligne.annule_le),
    baliseRound: versNombre(ligne.balise_round),
    effectueLe: versISO(ligne.effectue_le),
    engagementLe: versISO(ligne.engagement_le),
    etat,
    graineOrigine: versGraineOrigine(ligne.graine_origine),
    id: ligne.id,
    motifAnnulation: ligne.motif_annulation,
    nbGagnants: versNombre(ligne.nb_gagnants) ?? 0,
    nbParticipants: versNombre(ligne.nb_participants) ?? 0,
    numero: versNombre(ligne.numero) ?? 0,
    poidsMode: versPoidsMode(ligne.poids_mode),
    publie: ligne.publie,
    publieLe: versISO(ligne.publie_le),
  };
}

/** L'historique COMPLET, annulés compris. Aucun bouton de suppression n'existe nulle part. */
export async function listerTirages(slug: string): Promise<TirageResume[]> {
  try {
    const { rows } = await getPgPool().query<LigneTirage>(
      `select ${COLONNES_TIRAGE}
			   from public.x_campagne_tirages t
			  where t.campagne_slug = $1
			  order by t.numero desc`,
      [slug],
    );
    return rows.map(versResume);
  } catch (erreur) {
    console.error("Erreur de lecture de l'historique des tirages :", erreur);
    return [];
  }
}

interface LigneEntree {
  cle: string;
  pseudo_affichage: string;
  poids: number;
  oeuvres: string[] | null;
  u: number | string | null;
  cle_tri: number | string | null;
  empreinte: string | null;
  rang: number | null;
}

interface LigneGagnant {
  rang: number;
  cle: string;
  pseudo_affichage: string;
  creation_source: string;
  creation_identifiant: string;
  oeuvre_id: string | null;
  lot: string | null;
}

/**
 * Lit un tirage sous sa forme GELÉE, sur un client donné.
 *
 * Le paramètre `client` n'est pas une commodité : `executerEtEnregistrer` doit
 * pouvoir se relire À L'INTÉRIEUR de sa propre transaction pour se vérifier avant
 * de valider. Passer par le pool y lirait l'état d'AVANT — donc un tirage sans
 * graine — et la vérification échouerait sur un tirage pourtant correct.
 */
async function lireTirageGele(client: PoolClient, tirageId: string): Promise<TirageGele | null> {
  const { rows } = await client.query<LigneTirage>(
    `select ${COLONNES_TIRAGE} from public.x_campagne_tirages t where t.id = $1`,
    [tirageId],
  );
  const tirage = rows[0];
  if (!tirage || !tirage.graine || !tirage.empreinte_graine) {
    return null;
  }
  const { rows: entrees } = await client.query<LigneEntree>(
    `select e.cle, e.pseudo_affichage, e.poids, e.oeuvres, e.u, e.cle_tri, e.empreinte, e.rang
		   from public.x_campagne_tirage_entrees e
		  where e.tirage_id = $1
		  order by e.rang nulls last, e.cle`,
    [tirageId],
  );
  const { rows: gagnants } = await client.query<LigneGagnant>(
    `select g.rang, g.cle, g.pseudo_affichage, g.creation_source, g.creation_identifiant, g.oeuvre_id, g.lot
		   from public.x_campagne_tirage_gagnants g
		  where g.tirage_id = $1
		  order by g.rang`,
    [tirageId],
  );
  const round = versNombre(tirage.balise_round);
  return {
    balise:
      tirage.graine_origine === "balise" && tirage.balise_signature && tirage.balise_chaine && round !== null
        ? {
            chaine: tirage.balise_chaine,
            reseau: tirage.balise_reseau ?? DRAND_QUICKNET.reseau,
            round,
            signature: tirage.balise_signature,
          }
        : null,
    campagneSlug: tirage.campagne_slug,
    empreinteEngagement: tirage.empreinte_engagement,
    empreinteGraine: tirage.empreinte_graine,
    empreinteParticipants: tirage.empreinte_participants,
    entrees: entrees.map(entree => ({
      cle: entree.cle,
      cleTri: versNombre(entree.cle_tri) ?? 0,
      empreinte: entree.empreinte ?? "",
      oeuvres: entree.oeuvres ?? [],
      poids: versNombre(entree.poids) ?? 1,
      pseudoAffichage: entree.pseudo_affichage,
      rang: versNombre(entree.rang) ?? 0,
      u: versNombre(entree.u) ?? 0,
    })),
    gagnants: gagnants.map(gagnant => ({
      cle: gagnant.cle,
      oeuvreId: gagnant.oeuvre_id,
      rang: versNombre(gagnant.rang) ?? 0,
    })),
    graine: tirage.graine,
    graineOrigine: versGraineOrigine(tirage.graine_origine),
    lots: lotsDe(tirage.parametres),
    nbGagnants: versNombre(tirage.nb_gagnants) ?? 0,
    numero: versNombre(tirage.numero) ?? 0,
    poidsMode: versPoidsMode(tirage.poids_mode),
    publie: tirage.publie,
  };
}

/** Le tirage gelé, prêt pour `verifierTirage()`. `null` s'il n'a pas encore eu lieu. */
export async function chargerTirageGele(tirageId: string): Promise<TirageGele | null> {
  const client = await getPgPool().connect();
  try {
    return await lireTirageGele(client, tirageId);
  } catch (erreur) {
    console.error("Erreur de lecture du tirage gelé :", erreur);
    return null;
  } finally {
    client.release();
  }
}

/** Tout ce que l'écran d'admin affiche d'un tirage : le résumé, les preuves, le classement. */
export interface TirageComplet extends TirageResume {
  campagneSlug: string;
  graine: string | null;
  empreinteGraine: string | null;
  empreinteParticipants: string;
  empreinteEngagement: string;
  lots: string[];
  engagementMessageId: string | null;
  annonceSalonId: string | null;
  annonceMessageId: string | null;
  balise: {
    reseau: string;
    chaine: string;
    round: number;
    signature: string | null;
    recupereeLe: string | null;
  } | null;
  /** L'instant (ms) auquel le round visé tombe. `null` hors mode balise. */
  roundTombeAMs: number | null;
  entrees: Array<{
    cle: string;
    pseudoAffichage: string;
    poids: number;
    oeuvres: string[];
    u: number | null;
    cleTri: number | null;
    empreinte: string | null;
    rang: number | null;
  }>;
  gagnants: Array<{
    rang: number;
    cle: string;
    pseudoAffichage: string;
    creation: { source: SourceTirage; identifiant: string };
    oeuvreId: string | null;
    lot: string | null;
  }>;
}

async function lireTirageComplet(client: PoolClient, tirageId: string): Promise<TirageComplet | null> {
  const { rows } = await client.query<LigneTirage>(
    `select ${COLONNES_TIRAGE} from public.x_campagne_tirages t where t.id = $1`,
    [tirageId],
  );
  const tirage = rows[0];
  if (!tirage) {
    return null;
  }
  const { rows: entrees } = await client.query<LigneEntree>(
    `select e.cle, e.pseudo_affichage, e.poids, e.oeuvres, e.u, e.cle_tri, e.empreinte, e.rang
		   from public.x_campagne_tirage_entrees e
		  where e.tirage_id = $1
		  order by e.rang nulls last, e.cle`,
    [tirageId],
  );
  const { rows: gagnants } = await client.query<LigneGagnant>(
    `select g.rang, g.cle, g.pseudo_affichage, g.creation_source, g.creation_identifiant, g.oeuvre_id, g.lot
		   from public.x_campagne_tirage_gagnants g
		  where g.tirage_id = $1
		  order by g.rang`,
    [tirageId],
  );
  const round = versNombre(tirage.balise_round);
  return {
    ...versResume(tirage),
    annonceMessageId: tirage.annonce_discord_message_id,
    annonceSalonId: tirage.annonce_discord_salon_id,
    balise:
      tirage.graine_origine === "balise" && round !== null
        ? {
            chaine: tirage.balise_chaine ?? DRAND_QUICKNET.chaine,
            recupereeLe: versISO(tirage.balise_recuperee_le),
            reseau: tirage.balise_reseau ?? DRAND_QUICKNET.reseau,
            round,
            signature: tirage.balise_signature,
          }
        : null,
    campagneSlug: tirage.campagne_slug,
    empreinteEngagement: tirage.empreinte_engagement,
    empreinteGraine: tirage.empreinte_graine,
    empreinteParticipants: tirage.empreinte_participants,
    engagementMessageId: tirage.engagement_message_id,
    entrees: entrees.map(entree => ({
      cle: entree.cle,
      cleTri: versNombre(entree.cle_tri),
      empreinte: entree.empreinte,
      oeuvres: entree.oeuvres ?? [],
      poids: versNombre(entree.poids) ?? 1,
      pseudoAffichage: entree.pseudo_affichage,
      rang: versNombre(entree.rang),
      u: versNombre(entree.u),
    })),
    gagnants: gagnants.map(gagnant => ({
      cle: gagnant.cle,
      creation: {
        identifiant: gagnant.creation_identifiant,
        source: versSource(gagnant.creation_source) ?? "x",
      },
      lot: gagnant.lot,
      oeuvreId: gagnant.oeuvre_id,
      pseudoAffichage: gagnant.pseudo_affichage,
      rang: versNombre(gagnant.rang) ?? 0,
    })),
    graine: tirage.graine,
    lots: lotsDe(tirage.parametres),
    roundTombeAMs:
      tirage.graine_origine === "balise" && round !== null
        ? instantDuRound(round, DRAND_QUICKNET.genesisSec, DRAND_QUICKNET.periodeSec)
        : null,
  };
}

export async function chargerTirageComplet(tirageId: string): Promise<TirageComplet | null> {
  const client = await getPgPool().connect();
  try {
    return await lireTirageComplet(client, tirageId);
  } catch (erreur) {
    console.error("Erreur de lecture du tirage :", erreur);
    return null;
  } finally {
    client.release();
  }
}

/** Le tirage le plus récent, annulé compris — ce que l'écran d'admin ouvre par défaut. */
export async function chargerDernierTirage(slug: string): Promise<TirageComplet | null> {
  const client = await getPgPool().connect();
  try {
    const { rows } = await client.query<{ id: string }>(
      `select id from public.x_campagne_tirages
			  where campagne_slug = $1
			  order by numero desc
			  limit 1`,
      [slug],
    );
    const dernier = rows[0];
    return dernier ? await lireTirageComplet(client, dernier.id) : null;
  } catch (erreur) {
    console.error("Erreur de lecture du dernier tirage :", erreur);
    return null;
  } finally {
    client.release();
  }
}

/** Un engagement ouvert : roster gelé, empreintes publiées, graine pas encore connue. */
export interface EngagementEnAttente {
  tirageId: string;
  numero: number;
  poidsMode: PoidsMode;
  graineOrigine: GraineOrigine;
  nbParticipants: number;
  nbGagnants: number;
  lots: string[];
  empreinteParticipants: string;
  empreinteEngagement: string;
  baliseChaine: string | null;
  baliseRound: number | null;
  /** Instant (ms) auquel le round tombe — le compte à rebours de l'écran vient de là. */
  roundTombeAMs: number | null;
  /** `true` quand le round est tombé : le bouton « Tirer » ne s'active qu'alors. */
  pret: boolean;
  engagementLe: string | null;
  engagementMessageId: string | null;
}

/**
 * L'engagement ouvert de la campagne, s'il y en a un.
 *
 * Il ne peut y en avoir qu'un à la fois — `creerEngagement` le refuse — et c'est
 * ce qui rend le `limit 1` honnête plutôt que arbitraire.
 *
 * ⚠ `pret` est calculé ICI, à partir de l'horloge du SERVEUR. Le laisser à l'UI
 * ferait dépendre le déclenchement du tirage de l'heure de la machine du visiteur,
 * qui peut être fausse de plusieurs minutes ; et de toute façon
 * `executerEtEnregistrer` revérifie côté base avant d'écrire quoi que ce soit.
 */
export async function chargerEngagementEnAttente(slug: string): Promise<EngagementEnAttente | null> {
  try {
    const { rows } = await getPgPool().query<LigneTirage>(
      `select ${COLONNES_TIRAGE}
			   from public.x_campagne_tirages t
			  where t.campagne_slug = $1 and t.graine is null and t.annule_le is null
			  order by t.numero desc
			  limit 1`,
      [slug],
    );
    const tirage = rows[0];
    if (!tirage) {
      return null;
    }
    const round = versNombre(tirage.balise_round);
    const origine = versGraineOrigine(tirage.graine_origine);
    const tombeA =
      origine === "balise" && round !== null
        ? instantDuRound(round, DRAND_QUICKNET.genesisSec, DRAND_QUICKNET.periodeSec)
        : null;
    return {
      baliseChaine: tirage.balise_chaine,
      baliseRound: round,
      empreinteEngagement: tirage.empreinte_engagement,
      empreinteParticipants: tirage.empreinte_participants,
      engagementLe: versISO(tirage.engagement_le),
      engagementMessageId: tirage.engagement_message_id,
      graineOrigine: origine,
      lots: lotsDe(tirage.parametres),
      nbGagnants: versNombre(tirage.nb_gagnants) ?? 0,
      nbParticipants: versNombre(tirage.nb_participants) ?? 0,
      numero: versNombre(tirage.numero) ?? 0,
      poidsMode: versPoidsMode(tirage.poids_mode),
      pret: tombeA === null || Date.now() >= tombeA,
      roundTombeAMs: tombeA,
      tirageId: tirage.id,
    };
  } catch (erreur) {
    console.error("Erreur de lecture de l'engagement en attente :", erreur);
    return null;
  }
}

/* ── FORME PUBLIQUE ───────────────────────────────────────────────────────── */

/** Une entrée du classement PUBLIC : pseudonymisée, vérifiable, sans graphe d'identités. */
export interface EntreePublique {
  clePublique: string;
  pseudoAffichage: string;
  poids: number;
  rang: number;
}

export interface GagnantPublic {
  rang: number;
  clePublique: string;
  pseudoAffichage: string;
  lot: string | null;
  /**
   * La publication qui atteste l'éligibilité, et la clé qui permet de retrouver
   * la carte correspondante DANS la galerie déjà chargée par la page.
   *
   * ── POURQUOI PAS UN `PostCampagne` COMPLET ─────────────────────────────
   * `versPost()` et l'union `GALERIE` sont privées à `queries.ts`, et les
   * recopier ici dupliquerait la requête la plus délicate du fichier — celle qui
   * porte toutes les clauses de visibilité. `cleCreation` suit exactement le
   * format de `clePost()` (`x-<id>`, `discord-<id>`, `instagram-<shortcode>`) :
   * la page apparie ses propres créations, l'animation reçoit de vrais
   * `PostCampagne`, et aucune règle de visibilité n'existe en double.
   */
  creation: { source: SourceTirage; identifiant: string; cleCreation: string } | null;
  oeuvreId: string | null;
  /** URL du MEILLEUR fichier de l'œuvre tirée, que l'animation préfère à `post.images[0]`. */
  imageMaster: string | null;
}

export interface TiragePublic {
  id: string;
  numero: number;
  campagneSlug: string;
  poidsMode: PoidsMode;
  nbParticipants: number;
  nbGagnants: number;
  publieLe: string | null;
  engagementLe: string | null;
  graine: string;
  empreinteGraine: string;
  empreinteParticipants: string;
  empreinteEngagement: string;
  balise: { reseau: string; chaine: string; round: number; signature: string; recupereeLe: string | null } | null;
  entrees: EntreePublique[];
  gagnants: GagnantPublic[];
}

/**
 * Le tirage publié d'une campagne — la seule lecture de ce module qu'un anonyme
 * déclenche.
 *
 * ── LES QUATRE CLAUSES, ET POURQUOI CHACUNE ────────────────────────────────
 * `t.publie` : rien ne s'affiche avant que le staff ne l'ait décidé.
 * `t.annule_le is null` : un tirage annulé reste en base avec son motif, mais
 *   n'est plus une vérité affichable.
 * `t.graine_origine = 'balise'` : un tirage de répétition ne peut PAS être
 *   publié. Le CHECK `x_campagne_tirages_locale_jamais_publique` le refuse déjà
 *   en base ; la clause est ici pour que même une base mal migrée ne le montre pas.
 * `c.publiee` : la campagne elle-même doit être publique.
 *
 * Repli `null` sur toute erreur : la page `/iergday` doit continuer d'afficher
 * l'affiche, le règlement et le mur des créations même si cette lecture échoue.
 */
export async function chargerTiragePublie(slug: string): Promise<TiragePublic | null> {
  try {
    const pool = getPgPool();
    const { rows } = await pool.query<LigneTirage>(
      `select ${COLONNES_TIRAGE}
			   from public.x_campagne_tirages t
			   join public.x_campagnes c on c.slug = t.campagne_slug and c.publiee
			  where t.campagne_slug = $1
			    and t.publie and t.annule_le is null and t.graine_origine = 'balise'
			    and t.graine is not null
			  order by t.numero desc
			  limit 1`,
      [slug],
    );
    const tirage = rows[0];
    if (!tirage?.graine || !tirage.empreinte_graine) {
      return null;
    }

    const [{ rows: entrees }, { rows: gagnants }] = await Promise.all([
      pool.query<LigneEntree>(
        `select e.cle, e.pseudo_affichage, e.poids, e.oeuvres, e.u, e.cle_tri, e.empreinte, e.rang
				   from public.x_campagne_tirage_entrees e
				  where e.tirage_id = $1 and e.rang is not null
				  order by e.rang`,
        [tirage.id],
      ),
      pool.query<LigneGagnant & { image_master_chemin: string | null; image_master_url: string | null }>(
        // `left join` sur l'œuvre : un gagnant sans œuvre rattachée (poids
        // minimal, aucune œuvre gelée) doit rester affiché, sans vignette.
        `select g.rang, g.cle, g.pseudo_affichage, g.creation_source, g.creation_identifiant,
				        g.oeuvre_id, g.lot, o.image_master_chemin, o.image_master_url
				   from public.x_campagne_tirage_gagnants g
				   left join public.x_campagne_oeuvres o
				          on o.campagne_slug = $2 and o.oeuvre_id = g.oeuvre_id
				  where g.tirage_id = $1
				  order by g.rang`,
        [tirage.id, slug],
      ),
    ]);

    // `clePublique` est asynchrone (SHA-256) : on la calcule une fois par ligne,
    // en parallèle. Sur 14 entrées c'est imperceptible, et c'est ce qui permet au
    // classement public de ne jamais porter la clé de plateforme.
    const entreesPubliques = await Promise.all(
      entrees.map(async (entree): Promise<EntreePublique> => {
        return {
          clePublique: await clePublique(slug, entree.cle),
          poids: versNombre(entree.poids) ?? 1,
          pseudoAffichage: entree.pseudo_affichage,
          rang: versNombre(entree.rang) ?? 0,
        };
      }),
    );

    const gagnantsPublics = await Promise.all(
      gagnants.map(async (gagnant): Promise<GagnantPublic> => {
        const source = versSource(gagnant.creation_source);
        return {
          clePublique: await clePublique(slug, gagnant.cle),
          creation: source
            ? {
                cleCreation: `${source}-${gagnant.creation_identifiant}`,
                identifiant: gagnant.creation_identifiant,
                source,
              }
            : null,
          imageMaster: gagnant.image_master_url ?? urlImageAsset(gagnant.image_master_chemin) ?? null,
          lot: gagnant.lot,
          oeuvreId: gagnant.oeuvre_id,
          pseudoAffichage: gagnant.pseudo_affichage,
          rang: versNombre(gagnant.rang) ?? 0,
        };
      }),
    );

    const round = versNombre(tirage.balise_round);
    return {
      balise:
        tirage.balise_signature && tirage.balise_chaine && round !== null
          ? {
              chaine: tirage.balise_chaine,
              recupereeLe: versISO(tirage.balise_recuperee_le),
              reseau: tirage.balise_reseau ?? DRAND_QUICKNET.reseau,
              round,
              signature: tirage.balise_signature,
            }
          : null,
      campagneSlug: tirage.campagne_slug,
      empreinteEngagement: tirage.empreinte_engagement,
      empreinteGraine: tirage.empreinte_graine,
      empreinteParticipants: tirage.empreinte_participants,
      engagementLe: versISO(tirage.engagement_le),
      entrees: entreesPubliques,
      gagnants: gagnantsPublics,
      graine: tirage.graine,
      id: tirage.id,
      nbGagnants: versNombre(tirage.nb_gagnants) ?? 0,
      nbParticipants: versNombre(tirage.nb_participants) ?? 0,
      numero: versNombre(tirage.numero) ?? 0,
      poidsMode: versPoidsMode(tirage.poids_mode),
      publieLe: versISO(tirage.publie_le),
    };
  } catch (erreur) {
    console.error("Erreur de lecture du tirage publié :", erreur);
    return null;
  }
}

/* ── ENGAGEMENT ───────────────────────────────────────────────────────────── */

/**
 * L'`Engagement` à hacher, construit UNE SEULE FOIS pour les deux chemins d'écriture.
 *
 * ── POURQUOI CE PETIT HELPER EXISTE ────────────────────────────────────────
 * `creerEngagement` calcule `empreinte_engagement`, `executerEtEnregistrer` la
 * RECALCULE pour vérifier que rien n'a bougé, et `verifierTirage` la recalcule une
 * troisième fois via `engagementDeTirage` (dans `tirage.ts`, à partir du tirage
 * gelé). Trois codes pour un seul condensat, c'est trois occasions de diverger —
 * et une divergence ferait échouer la vérification d'un tirage parfaitement
 * honnête. Les deux chemins d'ÉCRITURE partagent donc cette fonction ; le chemin
 * de LECTURE garde le sien, et le pont entre les deux n'est pas une convention
 * mais la garde 5 d'`executerEtEnregistrer` : un tirage qui ne se vérifie pas
 * lui-même est annulé avant `commit`, donc une dérive ne peut pas être livrée.
 */
function composerEngagement(entree: {
  slug: string;
  poidsMode: PoidsMode;
  nbGagnants: number;
  lots: readonly string[];
  graineOrigine: GraineOrigine;
  baliseReseau: string | null;
  baliseChaine: string | null;
  baliseRound: number | null;
  roster: readonly EntreeRoster[];
}): Parameters<typeof empreinteEngagement>[0] {
  const balise =
    entree.graineOrigine === "balise"
      ? {
          chaine: entree.baliseChaine ?? DRAND_QUICKNET.chaine,
          reseau: entree.baliseReseau ?? DRAND_QUICKNET.reseau,
          round: entree.baliseRound ?? 0,
        }
      : BALISE_LOCALE;
  return {
    baliseChaine: balise.chaine,
    baliseReseau: balise.reseau,
    baliseRound: balise.round,
    campagneSlug: entree.slug,
    entrees: [...entree.roster],
    lots: [...entree.lots],
    nbGagnants: entree.nbGagnants,
    poidsMode: entree.poidsMode,
  };
}

export interface DemandeEngagement {
  slug: string;
  poidsMode: PoidsMode;
  nbGagnants: number;
  lots: string[];
  graineOrigine: GraineOrigine;
  /** Délai avant le round visé. Défaut 180 s : de quoi copier-coller le message. */
  delaiRoundSecondes?: number;
}

export interface EngagementCree {
  tirageId: string;
  numero: number;
  empreinteParticipants: string;
  empreinteEngagement: string;
  baliseRound: number | null;
  roundPrevuLe: string | null;
  /** Le message prêt à copier-coller dans Discord. C'est LUI qui rend le tirage opposable. */
  texteEngagement: string;
}

/** Délai par défaut entre l'engagement et le round visé, en secondes. */
export const DELAI_ROUND_DEFAUT = 180;

/**
 * Ouvre un ENGAGEMENT : gèle le roster, publie les empreintes, vise un round FUTUR.
 *
 * ── POURQUOI L'ORDRE EST TOUTE LA GARANTIE ─────────────────────────────────
 * Roster clos → empreintes calculées et publiées → PUIS SEULEMENT la graine
 * existe. Inverser deux de ces trois étapes rend le dispositif truquable :
 * publier la graine avant la clôture permet à un participant de moudre un
 * identifiant avantageux (8 essais, mesuré) ; laisser N ouvert après le tirage
 * permet à l'organisateur de choisir les gagnants sans toucher au tirage.
 *
 * Rien n'est écrit si un contrôle échoue : tout se joue dans une transaction sous
 * verrou consultatif de TRANSACTION (relâché par `commit` comme par `rollback`,
 * y compris sur exception — `pg_advisory_lock`, lui, fuirait si la connexion
 * repartait au pool en cours d'erreur, et bloquerait tous les tirages suivants).
 */
export async function creerEngagement(demande: DemandeEngagement, effectuePar: string): Promise<EngagementCree> {
  const [participants, bilan] = await Promise.all([listerParticipants(demande.slug), bilanRoster(demande.slug)]);

  if (bilan.creationsSansOeuvre > 0) {
    throw new Error(
      `${bilan.creationsSansOeuvre} création(s) ne sont rattachées à aucune œuvre : la collecte est plus récente ` +
        "que les empreintes. Lancez `bun scripts/campagnes/empreintes-oeuvres.ts` avant d'engager, sinon ces " +
        "dessins n'auraient aucun ticket.",
    );
  }
  const eligibles = participantsDuTirage(participants);
  if (eligibles.length === 0) {
    throw new Error("Aucun participant éligible : il n'y a rien à tirer.");
  }
  if (demande.nbGagnants < 1 || demande.nbGagnants > eligibles.length) {
    throw new Error(
      `Nombre de gagnants impossible : ${demande.nbGagnants} pour ${eligibles.length} participant(s) éligibles.`,
    );
  }
  if (demande.lots.length !== 0 && demande.lots.length !== demande.nbGagnants) {
    throw new Error(
      `Il faut ${demande.nbGagnants} lot(s), ou aucun (classement nu). Reçu : ${demande.lots.length}. ` +
        "Un classement sans lot est autorisé, mais il doit être explicitement vide — pas implicitement absent.",
    );
  }

  const roster: EntreeRoster[] = eligibles.map(participant => ({
    cle: participant.cle,
    poids: demande.poidsMode === "un_par_personne" ? 1 : Math.min(MAX_POIDS, Math.max(1, participant.nbOeuvres)),
  }));
  const empreinteParticipants = await empreinteRoster(roster);

  // Round STRICTEMENT dans le futur. Le `while` couvre le cas limite où le délai
  // tombe pile sur une frontière de période : viser un round déjà tombé rendrait
  // la signature connue de tous AVANT la publication de l'engagement, ce qui vide
  // le dispositif de son sens.
  const delai = Math.max(60, demande.delaiRoundSecondes ?? DELAI_ROUND_DEFAUT);
  let baliseRound = 0;
  // Annotations explicites : `BALISE_LOCALE` est `as const`, donc `chaine` y a le
  // type littéral `""` et l'inférence refuserait la chaîne quicknet ensuite.
  let baliseChaine: string = BALISE_LOCALE.chaine;
  let baliseReseau: string = BALISE_LOCALE.reseau;
  let roundPrevuLe: string | null = null;
  if (demande.graineOrigine === "balise") {
    baliseChaine = DRAND_QUICKNET.chaine;
    baliseReseau = DRAND_QUICKNET.reseau;
    baliseRound = roundPour(Date.now() + delai * 1000, DRAND_QUICKNET.genesisSec, DRAND_QUICKNET.periodeSec);
    while (instantDuRound(baliseRound, DRAND_QUICKNET.genesisSec, DRAND_QUICKNET.periodeSec) <= Date.now()) {
      baliseRound += 1;
    }
    roundPrevuLe = new Date(
      instantDuRound(baliseRound, DRAND_QUICKNET.genesisSec, DRAND_QUICKNET.periodeSec),
    ).toISOString();
  }

  const empreinte = await empreinteEngagement(
    composerEngagement({
      baliseChaine,
      baliseReseau,
      baliseRound,
      graineOrigine: demande.graineOrigine,
      lots: demande.lots,
      nbGagnants: demande.nbGagnants,
      poidsMode: demande.poidsMode,
      roster,
      slug: demande.slug,
    }),
  );

  const client = await getPgPool().connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock($1::int, hashtext($2)::int)", [
      ESPACE_VERROU_TIRAGE,
      demande.slug,
    ]);

    const { rows: ouverts } = await client.query<{ numero: number; balise_round: string | number | null }>(
      `select numero, balise_round from public.x_campagne_tirages
			  where campagne_slug = $1 and graine is null and annule_le is null
			  limit 1`,
      [demande.slug],
    );
    const ouvert = ouverts[0];
    if (ouvert) {
      throw new Error(
        `Un engagement est déjà ouvert (tirage n°${ouvert.numero}, round #${String(ouvert.balise_round)}). ` +
          "Tirez-le ou annulez-le : deux engagements concurrents, ce sont deux rosters gelés qui se contredisent.",
      );
    }

    const { rows: crees } = await client.query<{ id: string; numero: number }>(
      `insert into public.x_campagne_tirages
			        (campagne_slug, numero, empreinte_participants, empreinte_engagement,
			         nb_participants, nb_gagnants, poids_mode, parametres, graine_origine,
			         balise_reseau, balise_chaine, balise_round, engagement_le, effectue_par)
			 select $1,
			        coalesce(max(numero), 0) + 1,
			        $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, now(), $12::uuid
			   from public.x_campagne_tirages
			  where campagne_slug = $1
			 returning id, numero`,
      [
        demande.slug,
        empreinteParticipants,
        empreinte,
        roster.length,
        demande.nbGagnants,
        demande.poidsMode,
        // Objet JS BRUT (node-postgres sérialise), jamais pré-stringifié.
        { lots: demande.lots },
        demande.graineOrigine,
        demande.graineOrigine === "balise" ? baliseReseau : null,
        demande.graineOrigine === "balise" ? baliseChaine : null,
        demande.graineOrigine === "balise" ? baliseRound : 0,
        effectuePar || null,
      ],
    );
    const cree = crees[0];
    if (!cree) {
      throw new Error("L'engagement n'a pas pu être créé.");
    }

    // Le roster est GELÉ ligne par ligne : `u`, `cle_tri`, `empreinte` et `rang`
    // restent NULL jusqu'au tirage (CHECK `…_calcul_atomique` : les quatre
    // ensemble, ou aucun). C'est cette table qui rend l'engagement opposable —
    // la ligne existe avant que le round visé n'existe.
    for (const participant of eligibles) {
      const poids =
        demande.poidsMode === "un_par_personne" ? 1 : Math.min(MAX_POIDS, Math.max(1, participant.nbOeuvres));
      // Une transaction est SÉQUENTIELLE par définition : un seul `PoolClient` ne peut
      // pas exécuter deux requêtes de front, et un `Promise.all` entrelacerait les
      // écritures d'une même transaction. L'`await` en boucle est ici la forme correcte.
      // oxlint-disable-next-line eslint/no-await-in-loop
      await client.query(
        `insert into public.x_campagne_tirage_entrees (tirage_id, cle, pseudo_affichage, poids, oeuvres)
				 values ($1, $2, $3, $4, $5::text[])`,
        [cree.id, participant.cle, participant.pseudoAffichage, poids, participant.oeuvres],
      );
    }

    await client.query("commit");

    return {
      baliseRound: demande.graineOrigine === "balise" ? baliseRound : null,
      empreinteEngagement: empreinte,
      empreinteParticipants,
      numero: cree.numero,
      roundPrevuLe,
      texteEngagement: await composerTexteEngagement({
        baliseChaine,
        baliseRound,
        empreinteEngagement: empreinte,
        empreinteParticipants,
        graineOrigine: demande.graineOrigine,
        lots: demande.lots,
        nbGagnants: demande.nbGagnants,
        numero: cree.numero,
        participants: eligibles,
        poidsMode: demande.poidsMode,
        roundPrevuLe,
        slug: demande.slug,
      }),
      tirageId: cree.id,
    };
  } catch (erreur) {
    await client.query("rollback");
    throw erreur;
  } finally {
    client.release();
  }
}

/**
 * Le message d'engagement, prêt à coller dans Discord.
 *
 * ── POURQUOI IL DOIT CONTENIR LE ROSTER EN ENTIER ──────────────────────────
 * Publier la seule empreinte ne prouve rien : personne ne peut recalculer un
 * SHA-256 sans les données qui l'ont produit. Le message porte donc la liste
 * complète (clé publique, pseudo, poids), N, les lots, les DEUX empreintes, la
 * chaîne et le round visé. Horodaté par Discord et non modifiable sans marqueur
 * « modifié », il devient la pièce qu'un tiers oppose au résultat.
 *
 * En mode `locale`, le message est remplacé par un avertissement : un tirage de
 * répétition n'a rien à faire dans un salon public, et la base refuse de toute
 * façon de le publier.
 */
async function composerTexteEngagement(entree: {
  slug: string;
  numero: number;
  poidsMode: PoidsMode;
  nbGagnants: number;
  lots: string[];
  graineOrigine: GraineOrigine;
  baliseChaine: string;
  baliseRound: number;
  roundPrevuLe: string | null;
  empreinteParticipants: string;
  empreinteEngagement: string;
  participants: readonly ParticipantTirage[];
}): Promise<string> {
  if (entree.graineOrigine === "locale") {
    return "Répétition — ne pas publier.";
  }
  const lignes: string[] = [];
  lignes.push(`Engagement du tirage n°${entree.numero} — campagne « ${entree.slug} »`);
  lignes.push("");
  lignes.push(
    `Mode de poids : ${entree.poidsMode === "par_oeuvre" ? "une chance par ŒUVRE" : "une chance par PERSONNE"}`,
  );
  lignes.push(`Nombre de gagnants : ${entree.nbGagnants}`);
  lignes.push(
    entree.lots.length > 0
      ? `Lots, dans l'ordre des rangs : ${entree.lots.join(" · ")}`
      : "Lots : aucun (classement nu, explicitement vide).",
  );
  lignes.push("");
  lignes.push(`Participants (${entree.participants.length}) — clé publique · pseudo · poids :`);
  // Les clés publiques sont calculées EN PARALLÈLE : ce sont des SHA-256
  // indépendants, les enchaîner dans la boucle d'affichage sérialiserait autant
  // d'allers-retours WebCrypto pour un texte qui, lui, se compose instantanément.
  const clesPubliques = await Promise.all(
    entree.participants.map(participant => clePublique(entree.slug, participant.cle)),
  );
  for (const [index, participant] of entree.participants.entries()) {
    const poids = entree.poidsMode === "un_par_personne" ? 1 : Math.max(1, participant.nbOeuvres);
    lignes.push(`  ${clesPubliques[index] ?? "?"} · ${participant.pseudoAffichage} · ${poids}`);
  }
  lignes.push("");
  lignes.push(`empreinte_participants : ${entree.empreinteParticipants}`);
  lignes.push(`empreinte_engagement   : ${entree.empreinteEngagement}`);
  lignes.push("");
  lignes.push(`Aléa : drand quicknet, chaîne ${entree.baliseChaine}`);
  lignes.push(`Round visé : #${entree.baliseRound}`);
  if (entree.roundPrevuLe) {
    lignes.push(
      `Il tombe à ${new Date(entree.roundPrevuLe).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })} (heure de Paris).`,
    );
  }
  lignes.push(`Vérification : ${DRAND_QUICKNET.api}/${entree.baliseChaine}/public/${entree.baliseRound}`);
  lignes.push("");
  lignes.push("Ni nous ni personne ne peut prédire la signature de ce round : elle n'existe pas encore.");
  lignes.push("Chaque œuvre est un ticket, tirés un par un sans remise.");
  return lignes.join("\n");
}

/* ── TIRAGE ───────────────────────────────────────────────────────────────── */

export interface ResultatEnregistre {
  numero: number;
  gagnants: Gagnant[];
  /** `true` quand le tirage avait DÉJÀ eu lieu : rien n'a été retiré. */
  deja: boolean;
  verdict: VerdictVerification;
}

/**
 * Exécute le tirage engagé et l'écrit — ou ne l'écrit pas du tout.
 *
 * ── LES CINQ GARDES, DANS L'ORDRE OÙ ELLES TOMBENT ─────────────────────────
 * 1. VERROU CONSULTATIF DE TRANSACTION + `for update` sur la ligne. Le verrou
 *    consultatif seul ne suffirait pas à l'engagement (qui CRÉE la ligne), le
 *    `for update` seul ne suffirait pas ici : les deux.
 * 2. DOUBLE-CLIC = ZÉRO NOUVEAU TIRAGE. Si `graine` est déjà renseignée, on rend
 *    le résultat existant avec `deja: true`. Un tirage ne se rejoue jamais par
 *    accident.
 * 3. L'EMPREINTE D'ENGAGEMENT DOIT SE RECALCULER. C'est le verrou sur N, sur les
 *    lots et sur le mode : si l'un a bougé depuis l'engagement, on refuse.
 * 4. COMPARE-AND-SET (`where … and graine is null`). Si deux transactions
 *    arrivaient malgré tout à ce point, la seconde verrait `rowCount === 0` et
 *    rendrait le résultat de la première au lieu d'en écrire un second.
 * 5. AUTO-VÉRIFICATION AVANT `commit`. Le tirage est relu depuis la transaction
 *    et repassé par `verifierTirage()` : s'il ne se vérifie pas lui-même, il
 *    n'est jamais écrit.
 *
 * ⚠ AUCUN REPLI SUR LE MODE LOCAL N'EST POSSIBLE, et ce n'est pas qu'une
 * discipline : `graine_origine` est écrite à l'engagement et gelée par le trigger
 * d'immuabilité, donc un `update` vers `'locale'` est REFUSÉ par la base.
 *
 * ⚠ L'APPEL RÉSEAU SE FAIT DANS LA TRANSACTION. C'est normalement à proscrire ;
 * ici il est plafonné (2 essais de 8 s, une seconde d'attente), il n'y a qu'un
 * écrivain — le staff — et l'alternative serait de relâcher le verrou entre la
 * récupération de la balise et l'écriture, c'est-à-dire d'ouvrir précisément la
 * fenêtre que ce verrou existe pour fermer.
 */
export async function executerEtEnregistrer(tirageId: string, effectuePar: string): Promise<ResultatEnregistre> {
  const client = await getPgPool().connect();
  try {
    await client.query("begin");

    const { rows: verrous } = await client.query<LigneTirage>(
      `select ${COLONNES_TIRAGE} from public.x_campagne_tirages t where t.id = $1 for update`,
      [tirageId],
    );
    const tirage = verrous[0];
    if (!tirage) {
      throw new Error("Tirage introuvable.");
    }
    await client.query("select pg_advisory_xact_lock($1::int, hashtext($2)::int)", [
      ESPACE_VERROU_TIRAGE,
      tirage.campagne_slug,
    ]);
    if (tirage.annule_le) {
      throw new Error(
        `Le tirage n°${tirage.numero} a été annulé le ${versISO(tirage.annule_le) ?? "?"} : ` +
          `${tirage.motif_annulation ?? "sans motif enregistré"}. Il ne peut plus être joué.`,
      );
    }

    // ── Garde 2 : il a déjà eu lieu ────────────────────────────────────
    if (tirage.graine) {
      const gele = await lireTirageGele(client, tirageId);
      const complet = await lireTirageComplet(client, tirageId);
      await client.query("commit");
      return {
        deja: true,
        gagnants: (complet?.gagnants ?? []).map(gagnant => ({
          cle: gagnant.cle,
          lot: gagnant.lot,
          oeuvreId: gagnant.oeuvreId,
          pseudoAffichage: gagnant.pseudoAffichage,
          rang: gagnant.rang,
        })),
        numero: versNombre(tirage.numero) ?? 0,
        verdict: gele ? await verifierTirage(gele) : { anomalies: [], controles: 0, valide: false },
      };
    }

    const { rows: entrees } = await client.query<LigneEntree>(
      `select e.cle, e.pseudo_affichage, e.poids, e.oeuvres, e.u, e.cle_tri, e.empreinte, e.rang
			   from public.x_campagne_tirage_entrees e
			  where e.tirage_id = $1
			  order by e.cle`,
      [tirageId],
    );
    if (entrees.length === 0) {
      throw new Error("Le roster gelé de ce tirage est vide : rien à tirer.");
    }
    const participants: ParticipantTirage[] = entrees.map(entree => ({
      cle: entree.cle,
      nbOeuvres: (entree.oeuvres ?? []).length,
      oeuvres: (entree.oeuvres ?? []).toSorted(),
      pseudoAffichage: entree.pseudo_affichage,
    }));
    const roster: EntreeRoster[] = entrees.map(entree => ({
      cle: entree.cle,
      poids: versNombre(entree.poids) ?? 1,
    }));
    const poidsMode = versPoidsMode(tirage.poids_mode);
    const origine = versGraineOrigine(tirage.graine_origine);
    const lots = lotsDe(tirage.parametres);
    const round = versNombre(tirage.balise_round) ?? 0;

    // ── Garde 3 : l'empreinte d'engagement doit se recalculer ──────────
    const recalculee = await empreinteEngagement(
      composerEngagement({
        baliseChaine: tirage.balise_chaine,
        baliseReseau: tirage.balise_reseau,
        baliseRound: round,
        graineOrigine: origine,
        lots,
        nbGagnants: versNombre(tirage.nb_gagnants) ?? 0,
        poidsMode,
        roster,
        slug: tirage.campagne_slug,
      }),
    );
    if (recalculee !== tirage.empreinte_engagement) {
      throw new Error(
        "L'empreinte d'engagement ne se recalcule pas : le nombre de gagnants, un lot, le mode de poids ou " +
          "le roster a changé depuis l'engagement publié. Le tirage est refusé — c'est exactement ce que " +
          "cette empreinte existe pour empêcher.",
      );
    }

    // ── La graine ─────────────────────────────────────────────────────
    let graine: string;
    let signature: string | null = null;
    if (origine === "balise") {
      const tombeA = instantDuRound(round, DRAND_QUICKNET.genesisSec, DRAND_QUICKNET.periodeSec);
      if (Date.now() < tombeA) {
        throw new Error(
          `Le round drand #${round} n'est pas encore tombé : il tombe à ` +
            `${new Date(tombeA).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })} (heure de Paris). ` +
            "Rien n'a été écrit.",
        );
      }
      const balise = await recupererBalise(tirage.balise_chaine ?? DRAND_QUICKNET.chaine, round);
      signature = balise.signature;
      graine = await graineDepuisBalise(balise.signature, tirage.empreinte_participants);
    } else {
      // LE SEUL usage de `getRandomValues` de tout le dispositif, et il est
      // cantonné aux répétitions : un tirage local ne peut être ni publié ni
      // annoncé (CHECK en base), donc cette graine ne prouve jamais rien.
      const octets = new Uint8Array(32);
      crypto.getRandomValues(octets);
      graine = Array.from(octets, octet => octet.toString(16).padStart(2, "0")).join("");
    }

    const resultat = await executerTirage(
      participants,
      { graine, nbGagnants: versNombre(tirage.nb_gagnants) ?? 1, poidsMode },
      lots,
    );

    // ── Garde 4 : compare-and-set ─────────────────────────────────────
    const misAJour = await client.query(
      `update public.x_campagne_tirages
			    set graine = $2, empreinte_graine = $3, balise_signature = $4,
			        balise_recuperee_le = case when $4::text is null then null else now() end,
			        effectue_par = coalesce($5::uuid, effectue_par), effectue_le = now()
			  where id = $1 and graine is null`,
      [tirageId, graine, resultat.empreinteGraine, signature, effectuePar || null],
    );
    if (misAJour.rowCount === 0) {
      await client.query("rollback");
      const gele = await chargerTirageGele(tirageId);
      const complet = await chargerTirageComplet(tirageId);
      return {
        deja: true,
        gagnants: (complet?.gagnants ?? []).map(gagnant => ({
          cle: gagnant.cle,
          lot: gagnant.lot,
          oeuvreId: gagnant.oeuvreId,
          pseudoAffichage: gagnant.pseudoAffichage,
          rang: gagnant.rang,
        })),
        numero: versNombre(tirage.numero) ?? 0,
        verdict: gele ? await verifierTirage(gele) : { anomalies: [], controles: 0, valide: false },
      };
    }

    for (const entree of resultat.classement) {
      // Une transaction est SÉQUENTIELLE par définition : un seul `PoolClient` ne peut
      // pas exécuter deux requêtes de front, et un `Promise.all` entrelacerait les
      // écritures d'une même transaction. L'`await` en boucle est ici la forme correcte.
      // oxlint-disable-next-line eslint/no-await-in-loop
      await client.query(
        `update public.x_campagne_tirage_entrees
				    set u = $3, cle_tri = $4, empreinte = $5, rang = $6
				  where tirage_id = $1 and cle = $2`,
        [tirageId, entree.cle, entree.u, entree.cleTri, entree.empreinte, entree.rang],
      );
    }

    // La création GARDÉE de l'œuvre tirée : c'est elle qui atteste l'éligibilité
    // (règle 1), et c'est vers elle que pointera le lien de l'annonce. On la lit
    // dans `x_campagne_oeuvres` plutôt que de la recalculer, pour que l'annonce
    // et la galerie ne puissent pas désigner deux publications différentes.
    for (const gagnant of resultat.gagnants) {
      // Même raison : séquentiel, dans la transaction (cf. la boucle des entrées).
      // oxlint-disable-next-line eslint/no-await-in-loop
      const { rows: oeuvres } = await client.query<{
        creation_gardee_source: string;
        creation_gardee_id: string;
      }>(
        `select o.creation_gardee_source, o.creation_gardee_id
				   from public.x_campagne_oeuvres o
				  where o.campagne_slug = $1 and o.oeuvre_id = $2`,
        [tirage.campagne_slug, gagnant.oeuvreId],
      );
      const oeuvre = oeuvres[0];
      if (!oeuvre) {
        throw new Error(
          `Le gagnant ${gagnant.pseudoAffichage} n'a aucune œuvre rattachée : impossible de désigner la ` +
            "création qui atteste son éligibilité. Le tirage n'est pas écrit.",
        );
      }
      // oxlint-disable-next-line eslint/no-await-in-loop
      await client.query(
        `insert into public.x_campagne_tirage_gagnants
				        (tirage_id, rang, cle, pseudo_affichage, creation_source, creation_identifiant, oeuvre_id, lot)
				 values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          tirageId,
          gagnant.rang,
          gagnant.cle,
          gagnant.pseudoAffichage,
          oeuvre.creation_gardee_source,
          oeuvre.creation_gardee_id,
          gagnant.oeuvreId,
          gagnant.lot,
        ],
      );
    }

    // ── Garde 5 : il doit se vérifier lui-même ────────────────────────
    const gele = await lireTirageGele(client, tirageId);
    if (!gele) {
      throw new Error("Le tirage vient d'être écrit mais ne se relit pas : rien n'est validé.");
    }
    const verdict = await verifierTirage(gele);
    if (!verdict.valide) {
      await client.query("rollback");
      throw new Error(
        `Le tirage ne se vérifie pas lui-même (${verdict.anomalies.map(a => a.code).join(", ")}) : ` +
          "il a été entièrement annulé et RIEN n'a été écrit. Un tirage invérifiable n'existe pas.",
      );
    }

    await client.query("commit");
    return { deja: false, gagnants: resultat.gagnants, numero: versNombre(tirage.numero) ?? 0, verdict };
  } catch (erreur) {
    await client.query("rollback").catch(() => undefined);
    throw erreur;
  } finally {
    client.release();
  }
}

/* ── PUBLICATION, ANNONCE, ANNULATION ─────────────────────────────────────── */

/**
 * Publie ou dépublie les gagnants.
 *
 * Les préconditions sont doublées : la base les impose (CHECK
 * `x_campagne_tirages_locale_jamais_publique`, `…_publie_coherent`), et l'action
 * les vérifie d'abord pour rendre un message lisible plutôt qu'une violation de
 * contrainte Postgres brute. C'est la base qui fait foi ; ceci n'est que la
 * politesse.
 */
export async function marquerPublie(tirageId: string, publie: boolean): Promise<void> {
  const client = await getPgPool().connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<LigneTirage>(
      `select ${COLONNES_TIRAGE} from public.x_campagne_tirages t where t.id = $1 for update`,
      [tirageId],
    );
    const tirage = rows[0];
    if (!tirage) {
      throw new Error("Tirage introuvable.");
    }
    if (publie) {
      if (!tirage.graine) {
        throw new Error("Ce tirage n'a pas encore eu lieu : il n'y a aucun gagnant à publier.");
      }
      if (tirage.annule_le) {
        throw new Error("Ce tirage est annulé : il ne peut pas être publié.");
      }
      if (versGraineOrigine(tirage.graine_origine) !== "balise") {
        throw new Error(
          "Un tirage à graine locale est un journal de répétition, pas une preuve d'équité : c'est nous qui " +
            "avons tiré la graine, donc nous aurions pu recommencer jusqu'au résultat voulu. La base " +
            "elle-même refuse de le publier.",
        );
      }
    }
    await client.query(
      `update public.x_campagne_tirages
			    set publie = $2, publie_le = case when $2 then now() else null end
			  where id = $1`,
      [tirageId, publie],
    );
    await client.query("commit");
  } catch (erreur) {
    await client.query("rollback").catch(() => undefined);
    throw erreur;
  } finally {
    client.release();
  }
}

/**
 * Vérifie qu'une annonce Discord peut partir, SANS rien envoyer.
 *
 * Première des trois couches d'idempotence (les deux autres étant le
 * compare-and-set d'`enregistrerAnnonce` et l'index unique partiel sur
 * `annonce_discord_message_id`). Elle existe pour que le cas normal — l'admin
 * reclique — ne touche jamais le réseau : une double annonce publique est
 * irrattrapable, contrairement à un appel évité.
 */
export async function reserverAnnonce(tirageId: string): Promise<{ libre: boolean; messageId: string | null }> {
  const { rows } = await getPgPool().query<{
    annonce_discord_message_id: string | null;
    publie: boolean;
    graine_origine: string;
    annule_le: Date | string | null;
  }>(
    `select annonce_discord_message_id, publie, graine_origine, annule_le
		   from public.x_campagne_tirages where id = $1`,
    [tirageId],
  );
  const tirage = rows[0];
  if (!tirage) {
    throw new Error("Tirage introuvable.");
  }
  if (tirage.annonce_discord_message_id) {
    return { libre: false, messageId: tirage.annonce_discord_message_id };
  }
  if (!tirage.publie || tirage.annule_le || versGraineOrigine(tirage.graine_origine) !== "balise") {
    throw new Error(
      "Annonce refusée : seul un tirage PUBLIÉ, non annulé et tiré depuis une balise publique peut être annoncé.",
    );
  }
  return { libre: true, messageId: null };
}

/**
 * Enregistre l'annonce en compare-and-set. Rend `false` si quelqu'un a gagné la course.
 *
 * Un `false` n'est pas anodin : il veut dire qu'un message a peut-être été posté
 * deux fois. L'appelant doit le journaliser en `console.error`, pas l'avaler.
 */
export async function enregistrerAnnonce(tirageId: string, salonId: string, messageId: string): Promise<boolean> {
  const resultat = await getPgPool().query(
    `update public.x_campagne_tirages
		    set annonce_discord_message_id = $3, annonce_discord_salon_id = $2, annonce_le = now()
		  where id = $1 and annonce_discord_message_id is null`,
    [tirageId, salonId, messageId],
  );
  return (resultat.rowCount ?? 0) > 0;
}

/**
 * Annule un tirage. JAMAIS un `delete`.
 *
 * Le trigger `x_tirage_suppression_interdite` refuserait la suppression de toute
 * façon, y compris au propriétaire — un `revoke delete` ne vaudrait rien puisque
 * l'app se connecte en `rg`, exempté des droits comme de la RLS. Un tirage
 * abandonné reste donc en base avec son motif, et l'historique de l'écran d'admin
 * l'affiche : effacer un tirage, c'est effacer la preuve qu'il a eu lieu.
 */
export async function annuler(tirageId: string, motif: string): Promise<void> {
  const propre = motif.trim();
  if (propre.length < 10) {
    throw new Error("Un motif d'annulation d'au moins 10 caractères est exigé (la base l'impose aussi).");
  }
  await getPgPool().query(
    `update public.x_campagne_tirages
		    set annule_le = now(), motif_annulation = $2, publie = false, publie_le = null
		  where id = $1 and annule_le is null`,
    [tirageId, propre],
  );
}

/** Rejoue un tirage déjà écrit et rend son verdict. Lecture pure : n'écrit jamais. */
export async function verifierTirageEnregistre(tirageId: string): Promise<VerdictVerification | null> {
  const gele = await chargerTirageGele(tirageId);
  if (!gele) {
    return null;
  }
  return verifierTirage(gele);
}

/**
 * Le roster d'un tirage, sous sa forme publique pseudonymisée.
 *
 * Sert au script d'export (`scripts/campagnes/exporter-tirage.ts`) et au bloc
 * « Comment vérifier ce tirage » de la page publique. `x_campagne_tirage_entrees`
 * étant fermée (aucun grant, RLS sans policy), c'est ce module — en rôle `rg`,
 * derrière la garde d'admin ou derrière la clause `publie` — qui en dérive la
 * forme montrable. La clé de plateforme ne sort jamais.
 */
export async function classementPublic(slug: string, tirageId: string): Promise<EntreePublique[]> {
  try {
    const { rows } = await getPgPool().query<LigneEntree>(
      `select e.cle, e.pseudo_affichage, e.poids, e.oeuvres, e.u, e.cle_tri, e.empreinte, e.rang
			   from public.x_campagne_tirage_entrees e
			  where e.tirage_id = $1 and e.rang is not null
			  order by e.rang`,
      [tirageId],
    );
    return await Promise.all(
      rows.map(async entree => ({
        clePublique: await clePublique(slug, entree.cle),
        poids: versNombre(entree.poids) ?? 1,
        pseudoAffichage: entree.pseudo_affichage,
        rang: versNombre(entree.rang) ?? 0,
      })),
    );
  } catch (erreur) {
    console.error("Erreur de lecture du classement public :", erreur);
    return [];
  }
}
