// Analyseur du markdown Discord — module PUR (aucun React, aucun accès réseau).
//
// Le contenu des messages vient d'utilisateurs : il n'est jamais transformé en
// HTML. Cet analyseur produit un arbre de nœuds typés que `markdown.tsx` rend
// en éléments React, ce qui rend `dangerouslySetInnerHTML` structurellement
// inutile. Les URL sont validées ici, à l'analyse : un lien dont le schéma
// n'est pas http(s) n'entre même pas dans l'arbre, il reste du texte brut.

import { estUrlSure, urlEmojiPersonnalise } from "./url";

// ── Contexte de résolution ──────────────────────────────────────────────────

/**
 * Noms résolus CÔTÉ SERVEUR pour les mentions rencontrées dans les messages.
 * Le navigateur ne fait aucune requête de résolution : tout arrive avec la page.
 */
export interface ContexteMentions {
  /** `id utilisateur` → pseudo affichable. */
  utilisateurs: Record<string, string>;
  /** `id rôle` → nom + couleur CSS éventuelle. */
  roles: Record<string, { nom: string; couleur: string | null }>;
  /** `id salon` → nom du salon. */
  salons: Record<string, string>;
}

export const CONTEXTE_MENTIONS_VIDE: ContexteMentions = {
  roles: {},
  salons: {},
  utilisateurs: {},
};

// ── Arbre ───────────────────────────────────────────────────────────────────

export type StyleHorodatage = "t" | "T" | "d" | "D" | "f" | "F" | "R";

export type NoeudInline =
  | { type: "texte"; valeur: string }
  | { type: "gras"; enfants: NoeudInline[] }
  | { type: "italique"; enfants: NoeudInline[] }
  | { type: "souligne"; enfants: NoeudInline[] }
  | { type: "barre"; enfants: NoeudInline[] }
  | { type: "spoiler"; enfants: NoeudInline[] }
  | { type: "code"; valeur: string }
  | { type: "lien"; url: string; enfants: NoeudInline[] }
  | { type: "mention-utilisateur"; id: string; nom: string }
  | { type: "mention-role"; id: string; nom: string; couleur: string | null }
  | { type: "mention-salon"; id: string; nom: string }
  | { type: "mention-globale"; valeur: "everyone" | "here" }
  | { type: "emoji"; nom: string; id: string; anime: boolean; url: string }
  | { type: "horodatage"; horodatage: number; style: StyleHorodatage }
  | { type: "saut" };

export type Bloc =
  | { type: "paragraphe"; enfants: NoeudInline[] }
  | { type: "titre"; niveau: 1 | 2 | 3; enfants: NoeudInline[] }
  | { type: "sous-texte"; enfants: NoeudInline[] }
  | { type: "citation"; enfants: NoeudInline[] }
  | { type: "liste"; ordonnee: boolean; elements: NoeudInline[][] }
  | { type: "bloc-code"; langage: string | null; code: string };

// ── Règles inline ───────────────────────────────────────────────────────────

/** Profondeur maximale d'imbrication du formatage (garde-fou anti-explosion). */
const PROFONDEUR_MAX = 6;

type Fabrique = (m: RegExpExecArray, ctx: ContexteMentions, profondeur: number) => NoeudInline | null;

interface Regle {
  motif: RegExp;
  fabrique: Fabrique;
}

/** Retire la ponctuation finale collée à une URL détectée automatiquement. */
function nettoyerUrlAuto(url: string): string {
  let propre = url;
  while (propre.length > 0 && /[.,;:!?)\]}'"]$/.test(propre)) {
    // Une parenthèse fermante n'est retirée que si elle n'est pas appariée.
    if (propre.endsWith(")")) {
      const ouvertes = (propre.match(/\(/g) ?? []).length;
      const fermees = (propre.match(/\)/g) ?? []).length;
      if (ouvertes >= fermees) break;
    }
    propre = propre.slice(0, -1);
  }
  return propre;
}

/** Fabrique un conteneur dont le contenu est ré-analysé récursivement. */
function conteneur(type: "gras" | "italique" | "souligne" | "barre" | "spoiler", groupe = 1): Fabrique {
  return (m, ctx, profondeur) => {
    const brut = m[groupe] ?? "";
    if (brut.trim().length === 0) return null;
    return { enfants: analyserInline(brut, ctx, profondeur + 1), type };
  };
}

const REGLES: Regle[] = [
  // Échappement `\*` — le caractère suivant est rendu littéralement.
  {
    fabrique: m => ({ type: "texte", valeur: m[1] ?? "" }),
    motif: /\\([\\*_~`|>#[\]()@:-])/y,
  },
  // Bloc de code inline à double accent grave (autorise un accent à l'intérieur).
  {
    fabrique: m => ({ type: "code", valeur: m[1] ?? "" }),
    motif: /``([^\n]+?)``/y,
  },
  {
    fabrique: m => ({ type: "code", valeur: m[1] ?? "" }),
    motif: /`([^`\n]+)`/y,
  },
  // Gras + italique combinés.
  {
    fabrique: (m, ctx, profondeur) => {
      const brut = m[1] ?? "";
      if (brut.trim().length === 0) return null;
      return {
        enfants: [{ enfants: analyserInline(brut, ctx, profondeur + 1), type: "italique" }],
        type: "gras",
      };
    },
    motif: /\*\*\*([\s\S]+?)\*\*\*/y,
  },
  { fabrique: conteneur("gras"), motif: /\*\*([\s\S]+?)\*\*/y },
  { fabrique: conteneur("souligne"), motif: /__([\s\S]+?)__/y },
  { fabrique: conteneur("barre"), motif: /~~([\s\S]+?)~~/y },
  { fabrique: conteneur("spoiler"), motif: /\|\|([\s\S]+?)\|\|/y },
  { fabrique: conteneur("italique"), motif: /\*([^*\n]+?)\*/y },
  { fabrique: conteneur("italique"), motif: /_([^_\n]+?)_/y },
  // Emoji personnalisé `<:nom:id>` / `<a:nom:id>`.
  {
    fabrique: m => {
      const id = m[3] ?? "";
      const anime = m[1] === "a";
      return { anime, id, nom: m[2] ?? "", type: "emoji", url: urlEmojiPersonnalise(id, anime) };
    },
    motif: /<(a?):([\w~-]{2,32}):(\d{15,25})>/y,
  },
  // Mention d'utilisateur `<@id>` / `<@!id>`.
  {
    fabrique: (m, ctx) => {
      const id = m[1] ?? "";
      return { id, nom: ctx.utilisateurs[id] ?? "membre", type: "mention-utilisateur" };
    },
    motif: /<@!?(\d{15,25})>/y,
  },
  // Mention de rôle `<@&id>`.
  {
    fabrique: (m, ctx) => {
      const id = m[1] ?? "";
      const role = ctx.roles[id];
      return {
        couleur: role?.couleur ?? null,
        id,
        nom: role?.nom ?? "rôle",
        type: "mention-role",
      };
    },
    motif: /<@&(\d{15,25})>/y,
  },
  // Mention de salon `<#id>`.
  {
    fabrique: (m, ctx) => {
      const id = m[1] ?? "";
      return { id, nom: ctx.salons[id] ?? "salon", type: "mention-salon" };
    },
    motif: /<#(\d{15,25})>/y,
  },
  // Horodatage dynamique `<t:unix:R>`.
  {
    fabrique: m => {
      const horodatage = Number.parseInt(m[1] ?? "", 10);
      if (!Number.isFinite(horodatage)) return null;
      return { horodatage, style: (m[2] as StyleHorodatage) ?? "f", type: "horodatage" };
    },
    motif: /<t:(-?\d{1,15})(?::([tTdDfFR]))?>/y,
  },
  // Lien à libellé `[texte](url)` — refusé si le schéma n'est pas http(s).
  {
    fabrique: (m, ctx, profondeur) => {
      const url = (m[2] ?? "").replace(/^<|>$/g, "");
      if (!estUrlSure(url)) return null;
      return { enfants: analyserInline(m[1] ?? "", ctx, profondeur + 1), type: "lien", url };
    },
    motif: /\[([^\][\n]{1,200})]\((<?[^\s)]{1,2000}>?)\)/y,
  },
  // Lien encadré `<https://…>` (aperçu supprimé côté Discord).
  {
    fabrique: m => {
      const url = m[1] ?? "";
      if (!estUrlSure(url)) return null;
      return { enfants: [{ type: "texte", valeur: url }], type: "lien", url };
    },
    motif: /<(https?:\/\/[^\s>]{1,2000})>/y,
  },
  // Lien nu.
  {
    fabrique: m => {
      const url = nettoyerUrlAuto(m[0]);
      if (!estUrlSure(url)) return null;
      return { enfants: [{ type: "texte", valeur: url }], type: "lien", url };
    },
    motif: /https?:\/\/[^\s<>"'`|]{1,2000}/y,
  },
  // Mentions globales.
  {
    fabrique: m => ({ type: "mention-globale", valeur: m[1] as "everyone" | "here" }),
    motif: /@(everyone|here)\b/y,
  },
];

/**
 * Analyse une portion de texte en nœuds inline.
 * Balayage caractère par caractère : à chaque position les règles sont tentées
 * dans l'ordre de priorité ; sans correspondance, le caractère est du texte.
 */
export function analyserInline(
  texte: string,
  ctx: ContexteMentions = CONTEXTE_MENTIONS_VIDE,
  profondeur = 0,
): NoeudInline[] {
  if (texte.length === 0) return [];
  if (profondeur > PROFONDEUR_MAX) return [{ type: "texte", valeur: texte }];

  const noeuds: NoeudInline[] = [];
  let tampon = "";
  let i = 0;

  const viderTampon = () => {
    if (tampon.length > 0) {
      noeuds.push({ type: "texte", valeur: tampon });
      tampon = "";
    }
  };

  while (i < texte.length) {
    let consomme = 0;
    for (const regle of REGLES) {
      regle.motif.lastIndex = i;
      const m = regle.motif.exec(texte);
      if (!m) continue;
      const noeud = regle.fabrique(m, ctx, profondeur);
      // `null` = règle applicable mais contenu refusé (URL non sûre par ex.) :
      // on laisse les règles suivantes tenter leur chance.
      if (!noeud) continue;
      viderTampon();
      noeuds.push(noeud);
      consomme = m[0].length;
      break;
    }
    if (consomme > 0) {
      i += consomme;
    } else {
      tampon += texte[i];
      i += 1;
    }
  }

  viderTampon();
  return noeuds;
}

// ── Découpage en blocs ──────────────────────────────────────────────────────

const MOTIF_BLOC_CODE = /```(?:([a-zA-Z0-9+#._-]{1,20})\n)?([\s\S]*?)```/g;
const MOTIF_TITRE = /^(#{1,3})\s+(.+)$/;
const MOTIF_SOUS_TEXTE = /^-#\s+(.+)$/;
const MOTIF_CITATION = /^>\s?(.*)$/;
const MOTIF_CITATION_BLOC = /^>>>\s?(.*)$/;
const MOTIF_PUCE = /^ {0,4}[-*+]\s+(.+)$/;
const MOTIF_NUMERO = /^ {0,4}(\d{1,3})[.)]\s+(.+)$/;

/** Assemble plusieurs lignes d'un même paragraphe en insérant des sauts. */
function joindreLignes(lignes: string[], ctx: ContexteMentions): NoeudInline[] {
  const enfants: NoeudInline[] = [];
  lignes.forEach((ligne, index) => {
    if (index > 0) enfants.push({ type: "saut" });
    enfants.push(...analyserInline(ligne, ctx));
  });
  return enfants;
}

/** Découpe un segment sans bloc de code en blocs de niveau ligne. */
function analyserLignes(segment: string, ctx: ContexteMentions): Bloc[] {
  const blocs: Bloc[] = [];
  const lignes = segment.split("\n");
  let tamponParagraphe: string[] = [];
  let tamponCitation: string[] = [];
  let tamponListe: { ordonnee: boolean; elements: string[] } | null = null;

  const viderParagraphe = () => {
    if (tamponParagraphe.length === 0) return;
    const enfants = joindreLignes(tamponParagraphe, ctx);
    tamponParagraphe = [];
    if (enfants.length > 0) blocs.push({ enfants, type: "paragraphe" });
  };
  const viderCitation = () => {
    if (tamponCitation.length === 0) return;
    const enfants = joindreLignes(tamponCitation, ctx);
    tamponCitation = [];
    blocs.push({ enfants, type: "citation" });
  };
  const viderListe = () => {
    if (!tamponListe) return;
    const { elements, ordonnee } = tamponListe;
    tamponListe = null;
    blocs.push({
      elements: elements.map(element => analyserInline(element, ctx)),
      ordonnee,
      type: "liste",
    });
  };
  const viderTout = () => {
    viderParagraphe();
    viderCitation();
    viderListe();
  };

  for (let index = 0; index < lignes.length; index += 1) {
    const ligne = lignes[index] ?? "";

    // Citation multi-lignes `>>>` : tout le reste du segment est cité.
    const citationBloc = MOTIF_CITATION_BLOC.exec(ligne);
    if (citationBloc) {
      viderTout();
      const reste = [citationBloc[1] ?? "", ...lignes.slice(index + 1)];
      blocs.push({ enfants: joindreLignes(reste, ctx), type: "citation" });
      return blocs;
    }

    const citation = MOTIF_CITATION.exec(ligne);
    if (citation) {
      viderParagraphe();
      viderListe();
      tamponCitation.push(citation[1] ?? "");
      continue;
    }
    viderCitation();

    if (ligne.trim().length === 0) {
      viderTout();
      continue;
    }

    const titre = MOTIF_TITRE.exec(ligne);
    if (titre) {
      viderTout();
      blocs.push({
        enfants: analyserInline(titre[2] ?? "", ctx),
        niveau: (titre[1] ?? "#").length as 1 | 2 | 3,
        type: "titre",
      });
      continue;
    }

    const sousTexte = MOTIF_SOUS_TEXTE.exec(ligne);
    if (sousTexte) {
      viderTout();
      blocs.push({ enfants: analyserInline(sousTexte[1] ?? "", ctx), type: "sous-texte" });
      continue;
    }

    const numero = MOTIF_NUMERO.exec(ligne);
    if (numero) {
      viderParagraphe();
      if (tamponListe && !tamponListe.ordonnee) viderListe();
      tamponListe ??= { elements: [], ordonnee: true };
      tamponListe.elements.push(numero[2] ?? "");
      continue;
    }

    const puce = MOTIF_PUCE.exec(ligne);
    if (puce) {
      viderParagraphe();
      if (tamponListe?.ordonnee) viderListe();
      tamponListe ??= { elements: [], ordonnee: false };
      tamponListe.elements.push(puce[1] ?? "");
      continue;
    }

    viderListe();
    tamponParagraphe.push(ligne);
  }

  viderTout();
  return blocs;
}

/**
 * Analyse un message Discord complet en blocs prêts à rendre.
 * Les blocs de code encadrés sont extraits en premier : leur contenu ne subit
 * aucune interprétation.
 */
export function parseDiscordMarkdown(contenu: string, ctx: ContexteMentions = CONTEXTE_MENTIONS_VIDE): Bloc[] {
  if (typeof contenu !== "string" || contenu.trim().length === 0) return [];

  const texte = contenu.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const blocs: Bloc[] = [];
  let curseur = 0;

  MOTIF_BLOC_CODE.lastIndex = 0;
  let correspondance = MOTIF_BLOC_CODE.exec(texte);
  while (correspondance) {
    const avant = texte.slice(curseur, correspondance.index);
    if (avant.length > 0) blocs.push(...analyserLignes(avant, ctx));
    blocs.push({
      code: (correspondance[2] ?? "").replace(/^\n/, "").replace(/\n$/, ""),
      langage: correspondance[1] ?? null,
      type: "bloc-code",
    });
    curseur = correspondance.index + correspondance[0].length;
    correspondance = MOTIF_BLOC_CODE.exec(texte);
  }

  const reste = texte.slice(curseur);
  if (reste.length > 0) blocs.push(...analyserLignes(reste, ctx));

  return blocs;
}

// ── Extraction des identifiants à résoudre ──────────────────────────────────

const MOTIF_ID_UTILISATEUR = /<@!?(\d{15,25})>/g;
const MOTIF_ID_ROLE = /<@&(\d{15,25})>/g;
const MOTIF_ID_SALON = /<#(\d{15,25})>/g;

export interface IdentifiantsMentionnes {
  utilisateurs: string[];
  roles: string[];
  salons: string[];
}

/** Relève les identifiants mentionnés dans un ensemble de textes. */
export function extraireIdentifiantsMentionnes(textes: string[]): IdentifiantsMentionnes {
  const utilisateurs = new Set<string>();
  const roles = new Set<string>();
  const salons = new Set<string>();

  for (const texte of textes) {
    if (typeof texte !== "string" || texte.length === 0) continue;
    for (const m of texte.matchAll(MOTIF_ID_UTILISATEUR)) if (m[1]) utilisateurs.add(m[1]);
    for (const m of texte.matchAll(MOTIF_ID_ROLE)) if (m[1]) roles.add(m[1]);
    for (const m of texte.matchAll(MOTIF_ID_SALON)) if (m[1]) salons.add(m[1]);
  }

  return {
    roles: [...roles],
    salons: [...salons],
    utilisateurs: [...utilisateurs],
  };
}

/** Concatène le texte brut d'un arbre — utile pour les tests et les résumés. */
export function texteBrut(noeuds: NoeudInline[]): string {
  return noeuds
    .map(noeud => {
      switch (noeud.type) {
        case "texte":
        case "code": {
          return noeud.valeur;
        }
        case "saut": {
          return "\n";
        }
        case "emoji": {
          return `:${noeud.nom}:`;
        }
        case "mention-utilisateur":
        case "mention-role": {
          return `@${noeud.nom}`;
        }
        case "mention-salon": {
          return `#${noeud.nom}`;
        }
        case "mention-globale": {
          return `@${noeud.valeur}`;
        }
        case "horodatage": {
          return String(noeud.horodatage);
        }
        default: {
          return texteBrut(noeud.enfants);
        }
      }
    })
    .join("");
}
