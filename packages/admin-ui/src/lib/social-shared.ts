// Source: apps/shenron/site/src/lib/social-shared.ts at 8172f535ce (preserved Git history).
/**
 * social-shared — vocabulaire commun au navigateur et au serveur pour les
 * commentaires et les réactions.
 *
 * Ce fichier est volontairement SANS `server-only` et sans import Drizzle : il
 * est importé par les îlots clients (`components/social/*`) autant que par les
 * routes d'API. Toute constante qui doit être identique des deux côtés (longueur
 * maximale, tri par défaut, taille de page) vit ici — sinon le navigateur
 * accepte un texte que le serveur refuse, et l'utilisateur perd ce qu'il a écrit.
 */

/** Surfaces commentables / « likables ». Doit rester alignée sur le schéma. */
const SOCIAL_KINDS = ["post", "wiki", "databook", "tierlist", "comment"] as const;
export type SocialKind = (typeof SOCIAL_KINDS)[number];

function isSocialKind(value: unknown): value is SocialKind {
  return typeof value === "string" && (SOCIAL_KINDS as readonly string[]).includes(value);
}

/** Longueur maximale d'un commentaire (caractères). */
export const COMMENT_MAX = 4000;
/** Au-dessous, un « commentaire » n'en est pas un. */
export const COMMENT_MIN = 2;
/** Commentaires racines par page. */
export const COMMENTS_PER_PAGE = 20;
/** Réponses affichées d'emblée sous un commentaire racine. */
export const REPLIES_PREVIEW = 3;

export const COMMENT_SORTS = ["recent", "ancien", "populaire"] as const;
export type CommentSort = (typeof COMMENT_SORTS)[number];

export function isCommentSort(value: unknown): value is CommentSort {
  return typeof value === "string" && (COMMENT_SORTS as readonly string[]).includes(value);
}

/**
 * Clé textuelle d'une cible : `post:clv…`, `wiki:db_characters#42`.
 *
 * Les routes d'API reçoivent UNE chaîne plutôt que deux paramètres : un seul
 * champ à valider, et le couple ne peut pas arriver dépareillé.
 */
export type SocialTarget = { kind: SocialKind; id: string };

export function formatTarget(target: SocialTarget): string {
  return `${target.kind}:${target.id}`;
}

/** Analyse `kind:id`. Renvoie `null` si la forme ou le `kind` est invalide. */
export function parseTarget(raw: string | null | undefined): SocialTarget | null {
  if (!raw) return null;
  const sep = raw.indexOf(":");
  if (sep <= 0) return null;
  const kind = raw.slice(0, sep);
  const id = raw.slice(sep + 1).trim();
  if (!isSocialKind(kind) || !id || id.length > 160) return null;
  return { kind, id };
}

/**
 * Cible wiki = `<table>#<rowId>`, jamais le slug.
 *
 * Un slug de fiche peut être renommé (corrections d'orthographe, Hepburn) ; la
 * clé primaire de la ligne, non. Accrocher la conversation au slug ferait
 * disparaître les commentaires au premier renommage.
 */
export function wikiTargetId(table: string, rowId: string | number): string {
  return `${table}#${rowId}`;
}

export function parseWikiTargetId(id: string): { table: string; rowId: string } | null {
  const sep = id.indexOf("#");
  if (sep <= 0) return null;
  const table = id.slice(0, sep);
  const rowId = id.slice(sep + 1);
  if (!table || !rowId) return null;
  return { table, rowId };
}

/** Libellé humain d'une surface (fil de modération, notifications). */
export const SOCIAL_KIND_LABELS: Record<SocialKind, string> = {
  post: "Article",
  wiki: "Fiche wiki",
  databook: "Databook",
  tierlist: "Tier list",
  comment: "Commentaire",
};

/** Message d'erreur normalisé — le même texte côté client et côté serveur. */
const SOCIAL_ERRORS = {
  auth_required: "Connecte-toi pour participer.",
  body_empty: "Le commentaire est vide.",
  body_too_long: `Trop long (maximum ${COMMENT_MAX} caractères).`,
  target_unknown: "Ce contenu n'existe pas ou n'est pas public.",
  not_found: "Commentaire introuvable.",
  forbidden: "Action réservée.",
  rate_limited: "Trop de messages d'affilée — laisse passer une minute.",
  parent_invalid: "Le commentaire auquel tu réponds n'existe plus.",
  depth_exceeded: "On ne répond qu'à un commentaire, pas à une réponse.",
} as const;

type SocialErrorCode = keyof typeof SOCIAL_ERRORS;

export function socialErrorMessage(code: string | null | undefined): string {
  if (code && code in SOCIAL_ERRORS) return SOCIAL_ERRORS[code as SocialErrorCode];
  return "Une erreur est survenue.";
}

/** Vue publique d'un commentaire — forme identique en SSR et via l'API. */
export interface CommentView {
  id: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  edited: boolean;
  pinned: boolean;
  /** `true` si masqué par la modération : le corps est alors remplacé. */
  hidden: boolean;
  authorId: string | null;
  authorName: string;
  authorAvatar: string | null;
  /** Nom de l'agent quand l'écriture vient de l'API agents. */
  agentName: string | null;
  likes: number;
  /** `true` si le membre courant a aimé ce commentaire (résolu côté client). */
  liked: boolean;
  /** `true` si le membre courant peut éditer/supprimer. */
  mine: boolean;
  replyCount: number;
  replies: CommentView[];
}

export interface CommentPage {
  target: string;
  sort: CommentSort;
  page: number;
  pages: number;
  total: number;
  comments: CommentView[];
}

/** Corps d'un commentaire masqué — on ne renvoie jamais le texte retiré. */
export const HIDDEN_COMMENT_BODY = "Message retiré par la modération.";
