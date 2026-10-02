/**
 * Registre du corpus d'auteur `.aphrody` : documents admis et garde-fou.
 *
 * Source unique pour le site (`/wiki/canon`, `canon-ingest.ts`) et le pipeline
 * RAG (`ingest-aphrody-rag.ts`). Une source ajoutée ici entre aux deux
 * endroits ; un miroir de wiki de fans reste refusé aux deux endroits.
 *
 * Données pures : aucun accès disque, réseau ou base. Les parseurs restent
 * côté site (`apps/shenron/site/scripts/_aphrody-corpus.ts`).
 */

/** Langue d'une référence canon (miroir de `CanonReference["lang"]`). */
export type CorpusLang = "fr" | "en" | "ja";

/** Formes extraites d'un document ; chaque nom a un parseur côté site. */
export type Parseur = "citations" | "faits" | "tankobon" | "sections";

export const PARSEUR_NOMS = [
  "citations",
  "faits",
  "tankobon",
  "sections",
] as const satisfies readonly Parseur[];

export interface Document {
  /** Motif de nom de fichier dans `<corpus>/memory` (préfixe suffisant). */
  motif: string;
  /** Le libellé de source affiché au lecteur. */
  source: string;
  annee?: number;
  lang: CorpusLang;
  /** Un document peut porter deux formes : des citations ET de la synthèse. */
  parseurs: Parseur[];
}

/**
 * Les documents admis, et eux seuls.
 *
 * Chaque ligne est une source d'auteur ou un guide édité par Shueisha, traduit
 * par Kanzenshuu. Ni wiki de fans, ni forum, ni agrégateur : le corpus
 * `.aphrody` en contient, ils ne sont pas listés ici et le garde-fou plus bas
 * refuse de les lire même si quelqu'un les ajoutait.
 */
export const DOCUMENTS: Document[] = [
  {
    motif: "toriyama_toriyama-interviews",
    source: "Daizenshuu — Super Interviews d'Akira Toriyama",
    lang: "fr",
    parseurs: ["citations", "faits"],
  },
  {
    motif: "toriyama_toriyama-databook-seg",
    source: "Super Exciting Guide : Character Volume",
    annee: 2009,
    lang: "fr",
    parseurs: ["citations", "faits"],
  },
  {
    motif: "toriyama_akira-toriyama-tankobon-introductions",
    source: "Introductions des tankōbon par Akira Toriyama (trad. Kanzenshuu)",
    lang: "en",
    parseurs: ["tankobon"],
  },
  {
    motif: "toriyama_dragon-ball-forever-toriyama",
    source: "Dragon Ball Forever — interview d'Akira Toriyama (trad. Kanzenshuu)",
    annee: 2004,
    lang: "en",
    parseurs: ["sections"],
  },
  {
    motif: "shenron_seg-character-volume",
    source: "Super Exciting Guide : Character Volume (trad. Kanzenshuu)",
    annee: 2009,
    lang: "en",
    parseurs: ["sections"],
  },
  {
    motif: "shenron_seg-story-volume",
    source: "Super Exciting Guide : Story Volume (trad. Kanzenshuu)",
    annee: 2009,
    lang: "en",
    parseurs: ["sections"],
  },
  {
    motif: "shenron_daizenshuu-1-shenlong-times",
    source: "Daizenshuu 1 — Shenlong Times (trad. Kanzenshuu)",
    annee: 1995,
    lang: "en",
    parseurs: ["sections"],
  },
];

/** Un document dont le nom porte ça ne sera pas lu, quoi qu'il arrive. */
export const REFUSÉ = /(fandom|wikia|wiki-db|wiki-dbz|wiki-dbsuper|wikipedia|reddit|quora)/i;
