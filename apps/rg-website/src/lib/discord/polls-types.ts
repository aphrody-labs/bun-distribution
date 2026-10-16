// Sondages Discord — types et calculs PURS, importables côté navigateur.
//
// Ce module ne touche ni Postgres, ni Node, ni `server-only` : un îlot
// « use client » peut l'importer sans casser le bundle. Tout ce qui lit la base
// vit dans `./polls.ts`.
//
// VIE PRIVÉE — ligne rouge du chantier : aucun type d'ici ne porte, ni ne doit
// jamais porter, l'identité d'un votant. La table des votes nominatifs (celle
// qui dit qui a voté quoi) n'est ni lue, ni agrégée, ni exposée — son nom même
// n'apparaît nulle part dans le code du site. Les seuls chiffres publiés sont
// des totaux non ré-identifiants.

import { CONTEXTE_MENTIONS_VIDE, analyserInline, texteBrut } from "./markdown-ast";

/**
 * D'où viennent les DÉCOMPTES d'un sondage (pas ses métadonnées) :
 * - `embed` : lus dans l'encart publié par le bot — chiffres officiels ;
 * - `reactions` : reconstitués depuis les réactions archivées du salon,
 *   pour les sondages dont l'encart n'a jamais publié de résultat (± 1 vote) ;
 * - `api` : réservé, aucun sondage n'en porte aujourd'hui.
 */
export type SourceSondage = "embed" | "reactions" | "api";

/** Sondage de bot EasyPoll, ou sondage natif Discord (colonne `poll`). */
export type FournisseurSondage = "easypoll" | "discord";

export interface OptionSondage {
  /** Rang d'origine dans l'encart, 0-indexé. C'est la CLÉ d'une option : deux
   *  choix peuvent porter exactement le même libellé dans un même sondage. */
  position: number;
  /** Emoji de vote : soit un caractère Unicode, soit `<:nom:id>` / `<a:nom:id>`. */
  emoji: string | null;
  label: string;
  /** `null` quand le sondage n'a jamais publié ses résultats. */
  votes: number | null;
  /** Pourcentage TEL QUE PUBLIÉ par le bot (arrondi maison, somme 99 → 101). */
  percentage: number | null;
}

export interface VisuelSondage {
  /** URL absolue https, construite côté serveur depuis le chemin de stockage.
   *  Jamais une URL `cdn.discordapp.com` : celles-ci sont signées et expirent. */
  url: string;
  width: number | null;
  height: number | null;
  /** Texte alternatif saisi par l'autrice sur Discord. `null` = rien d'honnête
   *  à dire, on rend alors un `alt=""` (image décorative). */
  alt: string | null;
  message_id: string | null;
}

export interface Sondage {
  poll_id: string;
  provider: FournisseurSondage;
  source: SourceSondage;
  /**
   * Langue d'INTERFACE de l'encart EasyPoll, jamais celle de la question.
   *
   * Elle est déduite des en-têtes du bot (« Choices » ⇒ en, « Choix » ⇒ fr,
   * défaut « en ») : deux sondages portant la MÊME question française sont
   * classés l'un « fr », l'autre « en ». Valeur de DIAGNOSTIC — ne jamais la
   * recâbler sur un attribut `lang`, ce serait annoncer 48 questions françaises
   * comme anglaises. Pour marquer vraiment la langue du texte, il faudrait la
   * détecter sur `question`.
   */
  language: "fr" | "en" | null;
  message_id: string | null;
  channel_id: string;
  guild_id: string;
  question: string;
  /** Texte de présentation posté avec l'encart, mentions de rôle nues retirées. */
  chapo: string | null;
  creator_username: string | null;
  command: string | null;
  /** 0 = choix illimités. */
  max_choices: number;
  locked: boolean;
  ended: boolean;
  ends_at: string | null;
  created_at: string;
  total_votes: number | null;
  total_voters: number | null;
  results_hidden: boolean;
  visuel: VisuelSondage | null;
  options: OptionSondage[];
}

/**
 * Le sondage a-t-il des chiffres à montrer ? Un sondage dont l'encart n'a rien
 * publié ET dont les réactions n'ont pas pu être exploitées n'en a aucun : il
 * faut alors afficher ses choix SANS barre, jamais une barre à zéro qui se
 * lirait « personne n'a voté ».
 */
export function aDesResultats(sondage: Sondage): boolean {
  if (sondage.total_votes === null) return false;
  return sondage.options.some(option => option.votes !== null);
}

/**
 * Pourcentage à afficher pour une option.
 *
 * On RECALCULE sur `total_votes` au lieu de servir `percentage` :
 * 1. le bot arrondit (somme observée de 99,0 à 101,0) ;
 * 2. le pourcentage est absent des décomptes reconstitués par réactions ;
 * 3. `total_voters` n'est JAMAIS le bon diviseur — sur un sondage multi-choix
 *    il vaut environ la moitié du total des votes (mesuré : 97 votants pour
 *    167 votes), et diviser par lui donnerait des barres au-delà de 100 %.
 */
export function pourcentage(option: OptionSondage, sondage: Sondage): number {
  const total = sondage.total_votes;
  if (option.votes === null || total === null || total <= 0) return 0;
  return (option.votes / total) * 100;
}

/** Options triées par votes décroissants ; ex æquo départagés par `position`. */
export function classement(sondage: Sondage): OptionSondage[] {
  return sondage.options.toSorted((a, b) => {
    const ecart = (b.votes ?? -1) - (a.votes ?? -1);
    return ecart === 0 ? a.position - b.position : ecart;
  });
}

/**
 * Option en tête, uniquement s'il y a un vrai vainqueur : pas de résultats, un
 * seul choix, ou une égalité en tête ⇒ `null` (on ne couronne pas un ex æquo).
 */
export function gagnant(sondage: Sondage): OptionSondage | null {
  if (!aDesResultats(sondage) || sondage.options.length < 2) return null;
  const [premier, second] = classement(sondage);
  if (!premier || !second || premier.votes === null || premier.votes <= 0) return null;
  return premier.votes === second.votes ? null : premier;
}

/**
 * État d'un sondage — TROIS valeurs, parce que la base n'en connaît que deux et
 * que la troisième est la vérité pour la moitié du corpus.
 *
 * `ended` vaut `false` PAR DÉFAUT dès que l'encart ne porte pas de ligne « Poll
 * already ended » : c'est le cas des 25 sondages reconstitués à partir des
 * réactions (2023-08 → 2024-04), qui n'ont jamais publié ni clôture ni date de
 * fin. Les afficher « En cours » en 2026 revient à affirmer ce que l'encart n'a
 * jamais dit. `ends_at IS NULL` est le marqueur exact : les 26 sondages issus
 * d'un encart complet en portent tous une, les 25 autres aucune.
 */
export type EtatSondage = "termine" | "en-cours" | "inconnu";

export function etatSondage(sondage: Sondage): EtatSondage {
  if (sondage.ended) return "termine";
  return sondage.ends_at === null ? "inconnu" : "en-cours";
}

/** « Terminé » / « En cours » / « État non publié ». */
export function libelleEtat(sondage: Sondage): string {
  switch (etatSondage(sondage)) {
    case "termine": {
      return "Terminé";
    }
    case "en-cours": {
      return "En cours";
    }
    default: {
      return "État non publié";
    }
  }
}

/**
 * Variante de `Badge` pour l'état : le vert (`success`) est réservé à ce qui
 * tourne VRAIMENT. Un état non publié prend une pastille neutre.
 */
export function varianteBadgeEtat(sondage: Sondage): "secondary" | "success" | "outline" {
  switch (etatSondage(sondage)) {
    case "termine": {
      return "secondary";
    }
    case "en-cours": {
      return "success";
    }
    default: {
      return "outline";
    }
  }
}

/** Libellé du nombre de choix autorisés par personne (0 = illimité). */
export function libelleChoixAutorises(sondage: Sondage): string {
  if (sondage.max_choices <= 0) return "Choix illimités";
  return sondage.max_choices === 1 ? "1 choix par personne" : `${sondage.max_choices} choix par personne`;
}

/**
 * Mention de fiabilité à afficher sous les résultats, ou `null` quand les
 * chiffres sont exactement ceux publiés par le bot.
 */
export function mentionSource(sondage: Sondage): string | null {
  if (sondage.source === "reactions") {
    return "Décompte reconstitué à partir des réactions archivées du salon : à un vote près.";
  }
  if (sondage.results_hidden) {
    return "Résultats masqués : le bot ne les a pas publiés tant que le sondage tourne.";
  }
  return null;
}

/**
 * Libellé de participation : « 120 votes de 67 participants », ou seulement le
 * total quand le nombre de participants est inconnu (cas des décomptes
 * reconstitués — on ne l'invente pas).
 */
export function libelleParticipation(sondage: Sondage): string | null {
  const votes = sondage.total_votes;
  if (votes === null) return null;
  const motVotes = votes === 1 ? "vote" : "votes";
  const votants = sondage.total_voters;
  if (votants === null) return `${votes} ${motVotes}`;
  const motVotants = votants === 1 ? "participant" : "participants";
  return `${votes} ${motVotes} de ${votants} ${motVotants}`;
}

/**
 * Texte à passer au moteur de rendu markdown Discord pour une option : l'emoji
 * de vote suivi du libellé. Le moteur transforme déjà `<:nom:id>` en image et
 * laisse l'Unicode tel quel — rien à réimplémenter ici.
 */
export function libelleAvecEmoji(option: OptionSondage): string {
  return option.emoji ? `${option.emoji} ${option.label}` : option.label;
}

/**
 * Texte brut d'une question, pour un `<title>`, un `aria-label` ou un libellé de
 * lien : le balisage Discord (`**gras**`, `<:emote:id>`, `<@&role>`) n'a rien à
 * y faire. On réutilise l'analyseur existant plutôt qu'une expression régulière
 * approximative.
 */
export function resumeQuestion(question: string, longueurMax = 80): string {
  const brut = texteBrut(analyserInline(question, CONTEXTE_MENTIONS_VIDE)).replace(/\s+/g, " ").trim();
  if (brut.length <= longueurMax) return brut;
  return `${brut.slice(0, longueurMax - 1).trimEnd()}…`;
}

/** Lien vers le message d'origine, uniquement si les trois identifiants existent. */
export function lienMessageDiscord(sondage: Sondage): string | null {
  if (!sondage.message_id || !sondage.channel_id || !sondage.guild_id) return null;
  return `https://discord.com/channels/${sondage.guild_id}/${sondage.channel_id}/${sondage.message_id}`;
}
