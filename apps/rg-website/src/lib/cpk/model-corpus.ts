import "server-only";

/**
 * Énumération du corpus 3D — les codes de chaque famille, avec leur nom quand il en existe un.
 *
 * Deux sources, parce que les modèles ne se nomment pas de la même façon :
 *
 * - **Personnages** : la projection PostgreSQL. Eux seuls portent un nom affichable
 *   (`inagle_characters`), et leur code d'assemblage est le préfixe de `internal_code`
 *   (`c01000010_5000` → `c01000010`).
 * - **Le reste** : le VFS **live**, un sous-dossier par code sous `data/common/chr/_<famille>`.
 *   Aucun manifeste statique : l'ancienne galerie filtrait sur une liste écrite à la main qui
 *   plafonnait à 509 modèles sur les 6 236 du jeu.
 */

import { lsOrNull } from "@rosegriffon/azalee/cpk/live";
import { type ModelFamily, modelFamily } from "@rosegriffon/azalee/cpk/models";
import { selectInagle } from "@rosegriffon/db/inagle";

/** Un modèle du corpus. */
export interface ModelEntry {
  /** Code d'assemblage, ex. `c01000010` ou `a000010`. */
  code: string;
  /** Nom affichable, `null` si le jeu n'en donne pas (props, décors). */
  name: string | null;
  /** Slug de la fiche personnage, pour lier. `null` hors famille `perso`. */
  slug: string | null;
  /**
   * Nombre de fichiers dans le dossier du modèle — maillage, squelette, motions, packs.
   *
   * C'est le seul contexte disponible à l'échelle d'une liste : il vient du listing du dossier
   * PARENT, déjà chargé, et ne coûte donc aucune requête supplémentaire. `null` pour les
   * personnages, dont les pièces sont éclatées entre corps, visage et uniforme.
   */
  files: number | null;
  /** Libellé de version officiel, quand plusieurs modèles portent le même nom. */
  variantLabel?: string;
  /** Hash du portrait officiel Zukan, notamment pour une forme sans géométrie VFS. */
  zukanHash?: string;
  /** Le Zukan documente la forme, mais le VFS ne contient aucun modèle 3D assemblable. */
  previewOnly?: boolean;
}

/** Shawn est ambigu par nom : 7 cartes Zukan, 17 variantes IEVR et seulement 5 GLB VFS. */
const SHAWN_MODELS: Record<string, { label: string; slug: string; zukanHash: string; previewOnly?: boolean }> = {
  c02023290: {
    label: "IE2 · Défenseur · collège (8e année)",
    slug: "shawn-froste-0xA2957757",
    zukanHash: "k/o/p/opancch54ie",
  },
  c02023370: {
    label: "IE2 · Attaquant · collège (8e année)",
    slug: "shawn-froste-0x3DD430EE",
    zukanHash: "k/i/g/iggcoacccik",
  },
  c11902360: {
    label: "IE2 · personnalité d’Aiden · collège",
    slug: "shawn-froste-0x3CFE7E61",
    zukanHash: "k/i/3/i30spf7yhce",
    previewOnly: true,
  },
  c02023380: {
    label: "IE2 · Bear Killer · collège (8e année)",
    slug: "shawn-froste-0xBA4C2C21",
    zukanHash: "k/w/k/wk5ezxf-7dm",
  },
  c05024700: {
    label: "GO Chrono Stone · adulte · Inazuma Legend National",
    slug: "shawn-froste-0x2DEC08C2",
    zukanHash: "k/n/p/npvivtwkt3m",
  },
  c11908200: {
    label: "GO Chrono Stone · Miximax Axel × Shawn",
    slug: "shawn-froste-0x04DB53B4",
    zukanHash: "k/m/c/mc0a0kigy_k",
    previewOnly: true,
  },
  c07090010: {
    label: "Ares · capitaine d’Alpin · collège",
    slug: "shawn-froste-0x5E959869",
    zukanHash: "k/g/1/g1zm_1kbai8",
  },
};

/**
 * Filtre une liste de modèles sur une recherche libre — nom ET code.
 *
 * Comparaison insensible à la casse et aux accents : `deja` doit trouver « Déjà ». La recherche
 * porte sur la famille entière côté serveur, jamais sur la seule page rendue.
 */
export function filtrer(entrees: ModelEntry[], q: string): ModelEntry[] {
  const besoin = normaliser(q);
  if (!besoin) return entrees;
  return entrees.filter(
    m =>
      normaliser(m.code).includes(besoin) ||
      (m.name && normaliser(m.name).includes(besoin)) ||
      (m.variantLabel && normaliser(m.variantLabel).includes(besoin)),
  );
}

function normaliser(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/** Ligne du miroir dont on a besoin. */
interface CharaRow {
  internal_code: string | null;
  name_fr: string | null;
  name_en: string | null;
  name_ja: string | null;
  slug: string | null;
}

let _characters: Promise<ModelEntry[]> | null = null;

/**
 * Les personnages, dédoublonnés par code d'assemblage et triés par nom.
 *
 * Un personnage a plusieurs variantes (`_5000`, `_5001`…) qui partagent le même code de modèle :
 * les lister toutes afficherait le même modèle des dizaines de fois. La promesse est mémorisée,
 * pas son résultat, pour que deux rendus concurrents partagent la requête.
 */
export function characters(): Promise<ModelEntry[]> {
  _characters ??= (async () => {
    const parCode = new Map<string, ModelEntry>();
    try {
      const rows = await selectInagle<CharaRow>("inagle_characters", "internal_code,name_fr,name_en,name_ja,slug");
      for (const row of rows) {
        const code = row.internal_code?.split("_")[0];
        if (!code) continue;
        if (parCode.has(code)) continue;
        const shawn = SHAWN_MODELS[code];
        parCode.set(code, {
          code,
          files: null,
          name: row.name_fr || row.name_en || row.name_ja || null,
          slug: shawn?.slug || row.slug,
          variantLabel: shawn?.label,
          zukanHash: shawn?.zukanHash,
          previewOnly: shawn?.previewOnly,
        });
      }
    } catch {
      // Miroir absent : la famille rend vide plutôt que d'échouer.
    }
    return [...parCode.values()].toSorted((a, b) =>
      (a.name ?? a.code).localeCompare(b.name ?? b.code, "fr", { numeric: true }),
    );
  })();
  return _characters;
}

const _familles = new Map<ModelFamily, Promise<ModelEntry[]>>();

/**
 * Les codes d'une famille non-personnage, lus sur le VFS live.
 *
 * Un code = un sous-dossier de `data/common/chr/_<famille>`. Ces modèles n'ont pas de nom dans
 * les données du jeu : on rend le code, sans en inventer un.
 */
function famillleVfs(famille: ModelFamily): Promise<ModelEntry[]> {
  const cache = _familles.get(famille);
  if (cache) return cache;
  const p = (async () => {
    const def = modelFamily(famille);
    if (!def?.vfsDir) return [];
    const listing = await lsOrNull(def.vfsDir, 0);
    return (listing?.dirs ?? [])
      .map(d => ({ code: d.name, files: d.count ?? null, name: null, slug: null }) satisfies ModelEntry)
      .toSorted((a, b) => a.code.localeCompare(b.code, "fr", { numeric: true }));
  })();
  _familles.set(famille, p);
  return p;
}

/** Tous les modèles d'une famille, quelle qu'en soit la source. */
export function modelesDe(famille: ModelFamily): Promise<ModelEntry[]> {
  return famille === "chara" ? characters() : famillleVfs(famille);
}
