import type { BaseCharacter, Item } from "@rosegriffon/inagle";
import type { Skill, Team } from "@rosegriffon/inagle";
import { ELEMENT_NAMES as ElementNames } from "@rosegriffon/inagle/core/game-codes";
import type { Database } from "@rosegriffon/db";
import { createInagleSql, sql } from "@rosegriffon/db/inagle-sql";
import type { Database as SqlDatabase } from "@rosegriffon/db/schema";
import {
  extractKeshinModelCode,
  galleryVariantUrl,
  getArmureModelGlbUrl,
  getAuraImageUrl,
  getGalleryImageUrl,
  getKeshinModelGlbUrl,
  getMiximaxIconUrl,
  getMiximaxImageUrl,
  listServedArmureCodes,
  listServedKeshinCodes,
  resolveAssetUrl,
  resolveAuraTelopUrl,
} from "../images";
import { getTeamsList } from "./teams";
import { SHOP_FR, TACTIC_FR, tacticSlug } from "../text/translations";
import { LEGACY_FORMATIONS, type Formation, type PositionCoord } from "../game/formations";
import type { SkillCutinEntry } from "../game/skills-cutin";

type SqlFormationRow = SqlDatabase["inagle_formations"];
interface CoordinatorSqlRow {
  id: number;
  image: string | null;
  name_kanji: string | null;
  name_localised: string | null;
  name_romaji: string | null;
  gender: string | null;
  role: string | null;
  game: string | null;
  element: string | null;
  passive_no: number | null;
  requirements: string | null;
  stat: string | null;
  buff: string | null;
}
interface ManagerPassiveSqlRow {
  id: number | string;
  data: unknown;
  text_fr: string | null;
  text_en: string | null;
  text_ja: string | null;
}
interface AuraSqlRow {
  id: string;
  name_en: string | null;
  name_fr: string | null;
  name_ja?: string | null;
  image_url?: string | null;
  icon_code?: string | null;
  asset_code?: string | null;
  element_id?: number | null;
  sheet_data?: unknown;
  description_fr?: string | null;
  data?: unknown;
  sub_type: string | null;
}
interface TacticSqlRow {
  id: string | null;
  name: string;
  name_fr: string | null;
  name_ja: string | null;
  description_fr: string | null;
  description_en: string | null;
  description_ja: string | null;
  effect1: string | null;
  effect2: string | null;
  effect3: string | null;
  duration: number | null;
  cooldown: number | null;
  shop: string | null;
  internal_code: string | null;
  element: string | null;
  power: number | null;
  recast_time: number | null;
  partner_count: number | null;
  partner_ids: unknown;
  image_url: string | null;
}
interface SpecialTacticSqlRow {
  id: string;
  internal_code: string | null;
  name_en: string | null;
  name_fr: string | null;
  name_ja: string | null;
  description_en: string | null;
  description_fr: string | null;
  description_ja: string | null;
  element: string | null;
  element_id: number;
  power: number;
  recast_time: number;
  partner_count: number;
  partner_ids: unknown;
  data: unknown;
}
interface TweetSqlRow {
  author_id: string | null;
  author_name: string | null;
  author_username: string | null;
  category: string | null;
  created_at: string | null;
  id: string;
  is_thread: boolean | null;
  media: unknown;
  metrics: unknown;
  quoted_tweets: unknown;
  raw_tweets: unknown;
  text: string | null;
  translation: string | null;
  tweet_count: number | null;
  updated_at: string | null;
}
type AuraTableName =
  | "inagle_keshins"
  | "inagle_souls"
  | "inagle_miximax"
  | "inagle_awakenings"
  | "inagle_mode_changes"
  | "inagle_auras"
  | "inagle_keshins_clean"
  | "inagle_souls_clean"
  | "inagle_miximax_clean"
  | "inagle_awakenings_clean"
  | "inagle_mode_changes_clean";
type WikiSqlDatabase = SqlDatabase & {
  inagle_override_skills: {
    id: string;
    conditions: unknown;
    name_fr: string | null;
    name_en: string | null;
    name_ja: string | null;
    element_id: number | null;
    category_id: number | null;
    power_min: number | null;
    power_max: number | null;
  };
  inagle_coordinators: CoordinatorSqlRow;
  inagle_manager_passives: ManagerPassiveSqlRow;
  inagle_keshins: AuraSqlRow;
  inagle_souls: AuraSqlRow;
  inagle_miximax: AuraSqlRow;
  inagle_awakenings: AuraSqlRow;
  inagle_mode_changes: AuraSqlRow;
  inagle_auras: AuraSqlRow;
  inagle_keshins_clean: AuraSqlRow;
  inagle_souls_clean: AuraSqlRow;
  inagle_miximax_clean: AuraSqlRow;
  inagle_awakenings_clean: AuraSqlRow;
  inagle_mode_changes_clean: AuraSqlRow;
  inagle_tactics: TacticSqlRow;
  inagle_special_tactics: SpecialTacticSqlRow;
  tweets: TweetSqlRow;
};

interface SqlFormationData {
  valid?: boolean;
  label?: string;
  positions?: Array<{
    positionNo?: number;
    position_no?: number;
    role?: string;
    start?: { x?: number; y?: number };
  }>;
}

function sqlFormationToClient(row: SqlFormationRow): Formation | null {
  const raw = row.data as unknown as SqlFormationData;
  if (raw?.valid === false || !Array.isArray(raw?.positions)) return null;
  const roleSet = new Set(["FW", "MF", "DF", "GK"]);
  const positions = raw.positions.map((position, index) => {
    const x = position.start?.x;
    const y = position.start?.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return {
      index: position.positionNo ?? position.position_no ?? index,
      top: Math.max(1, Math.min(46, 43.75 * Number(y) + 2)),
      left: Math.max(1, Math.min(80, 40 + Number(x) * 47)),
      role: (roleSet.has(position.role ?? "") ? position.role : "MF") as PositionCoord["role"],
    };
  });
  if (positions.some(position => position === null)) return null;
  return {
    id: `g_${row.id}`,
    label: row.name_fr ?? row.name_en ?? row.name_ja ?? "Formation",
    name: `${row.name_fr ?? row.name_en ?? row.name_ja ?? "Formation"} (jeu)`,
    positions: positions as PositionCoord[],
  };
}

// Use generated types
type DbItem = Database["public"]["Tables"]["inagle_items"]["Row"];
type DbSkill = Database["public"]["Tables"]["inagle_skills"]["Row"];
type DbAura =
  | Database["public"]["Tables"]["inagle_auras"]["Row"]
  | Database["public"]["Tables"]["inagle_keshins"]["Row"]
  | Database["public"]["Tables"]["inagle_souls"]["Row"]
  | Database["public"]["Tables"]["inagle_awakenings"]["Row"]
  | Database["public"]["Tables"]["inagle_miximax"]["Row"]
  | Database["public"]["Tables"]["inagle_mode_changes"]["Row"];

interface ListParams {
  page?: number;
  limit?: number;
  q?: string;
  element?: string;
  position?: string;
  rarity?: string;
  category?: string;
  team?: string;
  series?: string;
  gender?: string;
  playstyle?: string;
  has_video?: string;
  show_aura?: string;
  overdrive?: string;
  sort?: string;
  power_min?: string;
  power_max?: string;
  status?: string;
  role?: string;
  ageGroup?: string;
  schoolYear?: string;
}

interface ListResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface GalleryItem {
  id: string;
  imgPath: string;
  category: string;
  title: string;
  /** URL source pleine résolution (PNG brut, multi-Mo) — réservée au téléchargement. */
  image: string | null;
  /** Variante WebP légère (w=400) pour la vignette de carte (~4–60 Ko vs ~12 Mo). */
  thumb: string | null;
  /** Variante WebP grande (w=1600) pour le lightbox plein écran (~65–300 Ko). */
  full: string | null;
  needTokenNum: number;
  flgNo: number;
}

/**
 * Décline une URL d'illustration source en triplet `{ image, thumb, full }` :
 *   - `image` : PNG plein cadre d'origine (téléchargement haute résolution)
 *   - `thumb` : WebP w=400 (vignette de carte — cache disque CDN)
 *   - `full`  : WebP w=1600 (lightbox plein écran — cache disque CDN)
 * Les URLs non-CDN/non-raster sont renvoyées telles quelles par `galleryVariantUrl`.
 */
function galleryVariants(image: string | null): {
  image: string | null;
  thumb: string | null;
  full: string | null;
} {
  // `crop=bandes` sur la vignette ET sur la version large : le jeu enveloppe ses
  // illustrations de deux bandes noires (letterbox) qui mangent près d'un tiers
  // de la hauteur — sur une grille à ratio fixe, elles se cumulent avec le
  // cadrage et il ne reste qu'un bandeau. `image` reste l'ORIGINAL intact :
  // c'est ce qu'on télécharge, et un téléchargement doit rendre le fichier du
  // jeu, pas notre interprétation.
  return {
    image,
    thumb: galleryVariantUrl(image, 400, { recadrerBandes: true }),
    full: galleryVariantUrl(image, 1600, { recadrerBandes: true }),
  };
}

/**
 * Catégories d'illustrations. Les 5 premières dérivent du préfixe `img_<category>_`
 * du `img_path` de la table SQL `inagle_gallery`. Les chemins d'assets sont
 * servis live par le CDN ; aucune liste JSON n'est une source runtime.
 */
export const GALLERY_CATEGORIES: ReadonlyArray<{ value: string; label: string; icon: string }> = [
  { value: "story", label: "Histoire", icon: "menu_book" },
  { value: "chronicle", label: "Chroniques", icon: "history_edu" },
  { value: "special", label: "Spéciales", icon: "star" },
  { value: "kizuna", label: "Liens", icon: "favorite" },
  { value: "other", label: "Autres", icon: "image" },
  { value: "gallery_img2", label: "Galerie", icon: "grid_view" },
  { value: "ev_pic", label: "Événements", icon: "person_celebrate" },
  { value: "stadium", label: "Stades", icon: "stadium" },
  { value: "vsroute_map", label: "Cartes route", icon: "strategy" },
  { value: "hlp", label: "Aide", icon: "lightbulb" },
  { value: "telop_waza", label: "Techniques", icon: "bolt" },
];

const GALLERY_CATEGORY_VALUES = new Set(GALLERY_CATEGORIES.map(c => c.value));

/** Catégorie d'un `img_path` (2e token `img_<cat>_…`), `other` par défaut. */
function galleryCategoryOf(imgPath: string | undefined | null): string {
  const m = imgPath?.match(/^img_([a-z]+)/);
  const cat = m?.[1];
  return cat && GALLERY_CATEGORY_VALUES.has(cat) ? cat : "other";
}

/**
 * Dérive un titre lisible depuis le `img_path` brut : retire le préfixe `img_`,
 * remplace les `_` par des espaces et met en Title Case. Pas de localisation en DB
 * pour ces illustrations — c'est le meilleur libellé dérivable.
 */
function galleryTitleOf(imgPath: string): string {
  const cleaned = imgPath.replace(/^img_/, "").replaceAll("_", " ").trim();
  return cleaned.replace(/\b\w/g, c => c.toUpperCase()) || imgPath;
}

function galleryRowToItem(row: any): GalleryItem {
  const imgPath: string = row.img_path || "";
  return {
    id: row.id,
    imgPath,
    category: galleryCategoryOf(imgPath),
    title: galleryTitleOf(imgPath),
    ...galleryVariants(getGalleryImageUrl(imgPath)),
    needTokenNum: row.need_token_num ?? 0,
    flgNo: row.flg_no ?? 0,
  };
}

// Helpers — returns all matching element IDs (Void maps to both 0 and 5)
function getElementIds(name: string): number[] {
  if (!name) {
    return [];
  }
  const n = name.toLowerCase();
  const ids: number[] = [];
  for (const [id, val] of Object.entries(ElementNames)) {
    const v = val as any;
    if (v.en?.toLowerCase() === n || v.fr?.toLowerCase() === n) {
      ids.push(Number(id));
    }
  }
  return ids;
}

/**
 * Sanitize user input for PostgREST filter interpolation to prevent filter injection.
 * On retire les chars structurels PostgREST (`,` sépare les conditions `.or()`, `.`
 * sépare col.op.val, `()` groupent, `*`/`\`) + le joker `%`. On NE retire PAS `_` :
 * ce n'est un joker que pour `LIKE`/`ILIKE`, jamais pour un `.eq.` exact, et les IDs
 * d'auras en contiennent (`keshin_0x…`, `soul_0x…`) — le strip cassait getAura → 404.
 */
function sanitizeFilter(input: string): string {
  return input.replaceAll(/[%,().*\\]/g, "");
}

/**
 * Héros with unique internal codes → base (untransformed) character codes.
 * Used to display the base face icon instead of the Héros-transformed one.
 * Only needed for Héros whose code differs from any Normal entry.
 */
const HERO_BASE_CODES: Record<string, string> = {
  c03030100: "c03032210", // Hector Helio → Hector
  c05024640: "c02024040", // Hurley Kane → Hurley (surfer young)
  c05024690: "c03030040", // Xavier Schiller → Xavier
  c05026600: "c03030010", // Austin Hobbes → Austin
  c06037430: "c02023810", // Darren LaChance → Darren
  c06037440: "c03030020", // Archer Hawkins → Archer
  c06039070: "c04000100", // Victor Blade → Victor
  c07020120: "c01000300", // Jude Sharp → Jude
  c07040120: "c01000030", // Jack Wallside → Jack
  c07050010: "c01000100", // Axel Blaze → Axel
  c07070010: "c01000210", // Joseph King → Joseph
  c07070110: "c02023700", // Caleb Stonewall → Caleb
  c07070120: "c01000020", // Nathan Swift → Nathan
  c07080010: "c01001900", // Byron Love → Byron Love (Zeus young)
  c07090010: "c02023290", // Shawn Froste → Shawn
  c07110020: "c01000010", // Mark Evans → Mark
  c07120060: "c01010910", // Erik Eagle → Erik
  c11010230: "c11010070", // Cade Shelby → Cade
  c11250060: "c03033690", // Bash Lancer → Bash
  c11600030: "c05028160", // Zanark Avalonic → Zanark
};

function normalizeAuraSheetData(sd: any): any {
  if (!sd) {
    return null;
  }
  const nested = sd.sheetData;
  const base = nested && nested !== "null" ? { ...sd, ...nested } : sd;
  return {
    ...base,
    // "passive" (DB field) → "passiveEffect" (component field)
    passiveEffect: base.passiveEffect || base.passive,
    hissatsu: base.hissatsu,
    buff: base.buff,
    matchedName: base.matchedName,
  };
}

/**
 * Tactiques : la table historique `inagle_tactics` (70) porte les effets/durée/boutique ;
 * le superset `inagle_special_tactics` (85, nommé FR) ajoute power/element/partner_count/
 * partner_ids ET ~10 tactiques `wht*` de scénario absentes de la première. On fusionne :
 * `inagle_tactics` reste la source primaire, on complète les champs manquants depuis le
 * superset et on ajoute les codes qui n'existent QUE dans le superset.
 *
 * On écarte les lignes de gabarit/test du superset (noms placeholder japonais
 * « 必殺タクティクス… », codes `test_…`) pour ne pas polluer la liste.
 */
function isPlaceholderSpecialTactic(row: any): boolean {
  const code = String(row?.internal_code || "");
  if (!code || code.startsWith("test_")) return true;
  const fr = String(row?.name_fr || "");
  const en = String(row?.name_en || "");
  return fr.includes("必殺タクティクス") || en.includes("必殺タクティクス");
}

/** Forme « détail » (cf. getTactic) depuis une ligne `inagle_tactics`, complétée par le superset. */
function tacticDetailFromTactics(match: any, special: any | null): any {
  // Ne complète QUE si le champ historique est absent (préserve ex. l'élément accentué « Néant »).
  const fill = (tVal: any, sVal: any) => (tVal === null || tVal === undefined ? (sVal ?? null) : tVal);
  const img = resolveAssetUrl(match.image_url) || null;
  return {
    slug: tacticSlug(match.name),
    name: match.name,
    name_fr: match.name_fr || TACTIC_FR[match.name] || match.name,
    name_ja: match.name_ja,
    description_fr: match.description_fr,
    description_en: match.description_en,
    description_ja: match.description_ja,
    effect1: match.effect1,
    effect2: match.effect2,
    effect3: match.effect3,
    duration: match.duration,
    cooldown: match.cooldown,
    shop: match.shop,
    internalCode: match.internal_code,
    element: fill(match.element, special?.element),
    power: fill(match.power, special?.power),
    recastTime: fill(match.recast_time, special?.recast_time),
    partnerCount: fill(match.partner_count, special?.partner_count),
    partnerIds: fill(match.partner_ids, special?.partner_ids),
    image: img,
    imageUrl: img,
  };
}

/** Forme « détail » (cf. getTactic) depuis une ligne `inagle_special_tactics` pure (wht* scénario). */
function specialTacticToDetail(s: any): any {
  const nameEn = s.name_en || s.name_fr || s.internal_code;
  return {
    slug: tacticSlug(nameEn),
    name: nameEn,
    name_fr: s.name_fr || TACTIC_FR[nameEn] || nameEn,
    name_ja: s.name_ja,
    description_fr: s.description_fr,
    description_en: s.description_en,
    description_ja: s.description_ja,
    // La table superset ne porte pas effets/durée/boutique : champs absents.
    effect1: null,
    effect2: null,
    effect3: null,
    duration: null,
    cooldown: s.recast_time ?? null,
    shop: null,
    internalCode: s.internal_code,
    element: s.element ?? null,
    power: s.power ?? null,
    recastTime: s.recast_time ?? null,
    partnerCount: s.partner_count ?? null,
    partnerIds: s.partner_ids ?? null,
    // Pas d'image telop fiable pour ces codes → laissé vide (le composant retombe sur l'icône).
    image: null,
    imageUrl: null,
  };
}

/** Forme « liste » (cf. getTacticsList) depuis une ligne `inagle_special_tactics` pure. */
function specialTacticToListItem(s: any): any {
  const nameEn = s.name_en || s.name_fr || s.internal_code;
  return {
    itemId: s.internal_code || tacticSlug(nameEn),
    internalCode: s.internal_code || "TACTIC",
    names: {
      en: nameEn,
      fr: s.name_fr || TACTIC_FR[nameEn] || nameEn,
      ja: s.name_ja || nameEn,
    },
    name_FR: s.name_fr || TACTIC_FR[nameEn] || nameEn,
    description: s.description_fr,
    description_JA: s.description_ja,
    category: "special_tactics",
    rarity: 3,
    image: null,
    price: null,
    location: null,
    stats: {
      effect1: null,
      effect2: null,
      effect3: null,
      duration: null,
      cooldown: s.recast_time ?? null,
    },
    shops: [],
  };
}

export const wikiService = {
  /** Cut-in canonique, lu depuis la projection PostgreSQL importée. */
  async getSkillCutin(codeOrId: string): Promise<SkillCutinEntry | null> {
    try {
      const db = createInagleSql<SqlDatabase>();
      const row = await db
        .selectFrom("inagle_skill_cutins")
        .select("data")
        .where("skill_id", "=", codeOrId)
        .executeTakeFirst();
      return (row?.data as unknown as SkillCutinEntry) ?? null;
    } catch {
      return null;
    }
  },

  /** Batch SQL lookup used by server components before crossing into client islands. */
  async getSkillCutins(codes: string[]): Promise<SkillCutinEntry[]> {
    if (codes.length === 0) return [];
    try {
      const db = createInagleSql<SqlDatabase>();
      const rows = await db.selectFrom("inagle_skill_cutins").select("data").where("skill_id", "in", codes).execute();
      return rows.map(row => row.data as unknown as SkillCutinEntry);
    } catch {
      return [];
    }
  },

  /** CDN gate for cut-in models, also sourced from PostgreSQL. */
  async hasSkillCutinAssets(eventIdName: string | null | undefined): Promise<boolean> {
    if (!eventIdName) return false;
    try {
      const db = createInagleSql<SqlDatabase>();
      const row = await db
        .selectFrom("inagle_skill_cutin_assets")
        .select("event_id_name")
        .where("event_id_name", "=", eventIdName)
        .executeTakeFirst();
      return Boolean(row);
    } catch {
      return false;
    }
  },

  async getSkillCutinAssets(eventIds: string[]): Promise<Set<string>> {
    if (eventIds.length === 0) return new Set();
    try {
      const db = createInagleSql<SqlDatabase>();
      const rows = await db
        .selectFrom("inagle_skill_cutin_assets")
        .select("event_id_name")
        .where("event_id_name", "in", eventIds)
        .execute();
      return new Set(rows.map(row => row.event_id_name));
    } catch {
      return new Set();
    }
  },

  /**
   * Formations canoniques : SQL/PostgreSQL est la seule source durable.
   * Les huit formations legacy restent dans le code uniquement pour décoder
   * les équipes historiques quand la base n'est pas disponible (CLI offline).
   */
  async getFormations(): Promise<Formation[]> {
    try {
      const db = createInagleSql<SqlDatabase>();
      const rows = await db.selectFrom("inagle_formations").selectAll().orderBy("id", "asc").execute();
      const game = rows
        .map(row => sqlFormationToClient(row as SqlFormationRow))
        .filter((formation): formation is Formation => formation !== null);
      return [...LEGACY_FORMATIONS, ...game];
    } catch {
      return [...LEGACY_FORMATIONS];
    }
  },

  /** Get all distinct constellations for a character (by name — heroes appear in multiple constellations via different chara_ids) */
  async _getHeroConstellations(row: any): Promise<Array<{ name: string; index: number }>> {
    const name = row?.name_en;
    if (!name) return [];
    const db = createInagleSql<SqlDatabase>();
    const data = await db
      .selectFrom("inagle_characters")
      .select(["constellation", "constellation_index"])
      .where("name_en", "=", name)
      .where("constellation", "is not", null)
      .execute();
    // Deduplicate by constellation name
    const seen = new Set<string>();
    const results: Array<{ name: string; index: number }> = [];
    for (const r of data) {
      if (r.constellation && !seen.has(r.constellation)) {
        seen.add(r.constellation);
        results.push({
          name: r.constellation,
          index: r.constellation_index ?? 0,
        });
      }
    }
    return results;
  },

  /** If character has no constellation (e.g. BASARA/Hero), inherit from counterpart via chara_id or name */
  async _inheritConstellation(base: BaseCharacter, row: any): Promise<void> {
    if ((base as any).constellation) return;
    const db = createInagleSql<SqlDatabase>();

    // Try 1: inherit from sibling with same chara_id
    if (row?.chara_id) {
      const sibling = await db
        .selectFrom("inagle_characters")
        .select(["constellation", "constellation_index"])
        .where("chara_id", "=", row.chara_id)
        .where("constellation", "is not", null)
        .limit(1)
        .executeTakeFirst();
      if (sibling?.constellation) {
        (base as any).constellation = {
          index: sibling.constellation_index ?? 0,
          names: { fr: sibling.constellation },
        };
        return;
      }
    }

    // Try 2: inherit from name-matched variant (hero forms have different chara_id)
    const name = row?.name_en;
    if (name) {
      const nameMatch = await db
        .selectFrom("inagle_characters")
        .select(["constellation", "constellation_index"])
        .where("name_en", "=", name)
        .where("constellation", "is not", null)
        .limit(1)
        .executeTakeFirst();
      if (nameMatch?.constellation) {
        (base as any).constellation = {
          index: nameMatch.constellation_index ?? 0,
          names: { fr: nameMatch.constellation },
        };
      }
    }
  },

  /** Find an aura/keshin/soul/miximax by name (partial match) — used for hero hyper techniques */
  async findAuraByName(name: string): Promise<{
    id: string;
    name_en: string;
    name_fr: string;
    sub_type?: string;
    categorySlug?: string;
  } | null> {
    const db = createInagleSql<WikiSqlDatabase>();
    // Clean the search name (remove common prefixes)
    const cleanName = name
      .replace(/^Mix 'n' Match: /i, "")
      .replace(/^Miximax Trans\.: /i, "")
      .replace(/ Totem$/i, "")
      .trim();
    // Search across aura-related tables — map table to URL category slug
    const tables = [
      { table: "inagle_keshins", slug: "esprits-guerriers" },
      { table: "inagle_souls", slug: "totems" },
      { table: "inagle_miximax", slug: "miximax" },
      { table: "inagle_auras", slug: "autres" },
    ] as const;
    const pattern = `%${cleanName}%`;
    for (const { table, slug } of tables) {
      const row = await db
        .selectFrom(table)
        .select(["id", "name_en", "name_fr", "sub_type"])
        .where(eb => eb.or([eb("name_en", "ilike", pattern), eb("name_fr", "ilike", pattern)]))
        .limit(1)
        .executeTakeFirst();
      if (row)
        return {
          ...row,
          name_en: row.name_en ?? row.name_fr ?? "",
          name_fr: row.name_fr ?? row.name_en ?? "",
          sub_type: row.sub_type ?? undefined,
          categorySlug: slug,
        };
    }
    // Exact match: use parameterized .eq() to avoid filter injection
    const exact = await db
      .selectFrom("inagle_auras")
      .select(["id", "name_en", "name_fr", "sub_type"])
      .where(eb => eb.or([eb("name_en", "=", name), eb("name_fr", "=", name)]))
      .limit(1)
      .executeTakeFirst();
    if (exact)
      return {
        ...exact,
        name_en: exact.name_en ?? exact.name_fr ?? "",
        name_fr: exact.name_fr ?? exact.name_en ?? "",
        sub_type: exact.sub_type ?? undefined,
        categorySlug: "autres",
      };
    return null;
  },

  /** Get all distinct base_slugs for generateStaticParams */
  async getAllBaseSlugParams(): Promise<Array<{ id: string }>> {
    const db = createInagleSql<SqlDatabase>();
    const data = await db
      .selectFrom("inagle_characters")
      .select("base_slug")
      .where("base_slug", "is not", null)
      .execute();
    // Deduplicate
    const seen = new Set<string>();
    const params: Array<{ id: string }> = [];
    for (const row of data) {
      if (row.base_slug && !seen.has(row.base_slug)) {
        seen.add(row.base_slug);
        params.push({ id: row.base_slug });
      }
    }
    return params;
  },

  async getAllTeams(): Promise<Array<{ id: string; name: string }>> {
    const teams = await getTeamsList();
    return teams.map(team => ({
      id: team.id,
      name: team.name,
      name_ja: team.nameJa,
    }));
  },

  async getCharacterAuras(
    charaId: string,
    charaParamId: string,
  ): Promise<
    Array<{
      id: string;
      name: string;
      type: string;
      categorySlug: string;
      imageUrl: string | null;
      assetCode: string | null;
      subType: string;
      element?: { en?: string; ja?: string; fr?: string };
      passiveEffect?: string;
      hissatsuName?: string;
    }>
  > {
    const db = createInagleSql<WikiSqlDatabase>();
    const supabaseHexIds = new Set<string>();

    // 1. Get from database: inagle_characters (data->'auras')
    const charData = await db
      .selectFrom("inagle_characters")
      .select("data")
      .where(eb => eb.or([eb("chara_id", "=", charaId), eb("id", "=", charaParamId)]))
      .executeTakeFirst();

    if (charData) {
      const dbAuras = (charData.data as any)?.auras || [];
      for (const a of dbAuras) {
        if (a.skillId) supabaseHexIds.add(a.skillId.toLowerCase());
      }
    }

    // 2. SQL projection: imported aura rows carry their owner and skill ids in data.
    // inagle_auras is a normalized catalog without a `data` column or an
    // owner ID. Only the three owned aura tables carry this projection.
    for (const table of ["inagle_keshins", "inagle_souls", "inagle_miximax"] as const) {
      const auraRows = await db.selectFrom(table).select(["id", "data"]).execute();
      for (const row of auraRows) {
        const payload: any = row.data && typeof row.data === "object" ? row.data : {};
        const owner = String(payload.ownerCharaParamId ?? payload.charaParamId ?? "").toLowerCase();
        if (owner === charaId.toLowerCase() || owner === charaParamId.toLowerCase()) {
          supabaseHexIds.add(String(payload.skillId ?? payload.id ?? row.id).toLowerCase());
        }
      }
    }

    const results: any[] = [];
    const tables = [
      { table: "inagle_keshins", slug: "esprits-guerriers", prefix: "keshin_" },
      { table: "inagle_souls", slug: "totems", prefix: "soul_" },
      { table: "inagle_miximax", slug: "miximax", prefix: "miximax_" },
    ] as const;

    for (const hexId of supabaseHexIds) {
      const cleanHexPart = hexId.replace(/^0x/i, "").toUpperCase();
      const formattedId = "0x" + cleanHexPart;

      for (const t of tables) {
        const prefixedId = t.prefix + formattedId;
        const possibleIds = [prefixedId, formattedId, hexId];

        // `icon_code` n'existe que sur inagle_miximax (pas keshins/souls) — sélection
        // conditionnelle pour éviter l'erreur PostgREST « column does not exist ».
        const auraRows = await db
          .selectFrom(t.table)
          .select([
            "id",
            "name_fr",
            "name_en",
            "name_ja",
            "image_url",
            "asset_code",
            "element_id",
            "sheet_data",
            "description_fr",
          ])
          .where("id", "in", possibleIds)
          .execute();

        if (auraRows.length > 0) {
          const a = auraRows[0];
          const sd = normalizeAuraSheetData(a.sheet_data) || {};
          // Miximax : icône manifeste (cn/ca), jamais le telop périmé `aura_mixi_c05028*`
          // du DB (= bannière d'un autre perso, cf. bug Arthur). Autres types : icône
          // résolue via asset_code, fallback image_url DB.
          const resolvedImageUrl =
            t.slug === "miximax"
              ? getMiximaxImageUrl((a as any).icon_code, a.asset_code, a.image_url)
              : getAuraImageUrl(a.asset_code, sd.subType) || resolveAssetUrl(a.image_url);
          results.push({
            id: a.id,
            name: a.name_fr || a.name_en || a.name_ja || sd.displayName || sd.name_FR || sd.name_EN || "Inconnu",
            type: t.table.replace("inagle_", "").replace("s", ""),
            categorySlug: t.slug,
            imageUrl: resolvedImageUrl,
            assetCode: a.asset_code,
            subType: t.table.replace("inagle_", "").replace("s", ""),
            element: ElementNames[a.element_id as keyof typeof ElementNames] || undefined,
            sheetData: sd,
            passiveEffect: sd.passiveEffect || sd.passive || a.description_fr || sd.desc_FR || undefined,
            hissatsuName: sd.hissatsu?.name || sd.sheetData?.hissatsu?.name || undefined,
          });
          break; // Found it in this table, move to the next hexId
        }
      }
    }

    return results;
  },

  async getAura(id: string, typeSlug: string): Promise<any | undefined> {
    const db = createInagleSql<WikiSqlDatabase>();

    // Map slug to the actual table (not view) for detail lookups
    const tableMap: Record<string, string> = {
      "esprits-guerriers": "inagle_keshins",
      totems: "inagle_souls",
      miximax: "inagle_miximax",
      eveil: "inagle_awakenings",
      "changement-mode": "inagle_mode_changes",
      autres: "inagle_auras",
    };

    const table = tableMap[typeSlug];
    if (!table) return undefined;

    // For "éveil", also search in inagle_auras (generic auras used as awakenings)
    const tablesToSearch: AuraTableName[] =
      typeSlug === "eveil" ? [table as AuraTableName, "inagle_auras"] : [table as AuraTableName];

    // Try match by ID or asset_code across all candidate tables in parallel.
    // sanitizeFilter : `id` vient d'un param d'URL → éviter l'injection de filtre
    // PostgREST (virgules/points/parenthèses casseraient le .or()).
    const searchResults = await Promise.all(
      tablesToSearch.map(tableName =>
        db
          .selectFrom(tableName)
          .selectAll()
          .where(eb => eb.or([eb("id", "=", id), eb("asset_code", "=", id)]))
          .limit(1)
          .executeTakeFirst(),
      ),
    );
    const row = searchResults.find(Boolean) || null;

    if (!row) return undefined;

    const a = row as any;
    const elementInfo = ElementNames[a.element_id as keyof typeof ElementNames] || ElementNames[0];
    const sd = normalizeAuraSheetData(a.sheet_data) || {};

    // Fetch linked skill video and owner in parallel
    let skillVideoUrl: string | null = null;
    let skillInternalCode: string | null = null;
    let skillNameFR: string | null = null;
    let ownerName: string | undefined;
    let ownerSlug: string | undefined;

    const rawSd = (a.sheet_data || {}) as any;
    // Le lien aura→technique (skillId1/skillId2) vit dans `config`, présent soit dans
    // sheet_data (injecté par cli-push) soit dans la colonne `data` (AuraSkill complet).
    const config = rawSd.config || (a.data as any)?.config || {};
    const possibleSkillIds = [config.skillId1, config.skillId2].filter((sid: string) => sid && sid !== "0x00000000");

    const parallelPromises: Array<Promise<{ type: "skill" | "owner"; data: any }>> = [];

    // Push skill queries
    if (a.skill_id) {
      parallelPromises.push(
        db
          .selectFrom("inagle_skills")
          .select(["video_url", "internal_code", "name_fr", "name_en"])
          .where("id", "=", a.skill_id)
          .executeTakeFirst()
          .then(data => ({ type: "skill" as const, data })),
      );
    }
    for (const sid of possibleSkillIds) {
      parallelPromises.push(
        db
          .selectFrom("inagle_skills")
          .select(["video_url", "internal_code", "name_fr", "name_en"])
          .where(eb => eb.or([sql<boolean>`data->>'skillID' = ${sid}`, sql<boolean>`sheet_data->>'skillID' = ${sid}`]))
          .limit(1)
          .executeTakeFirst()
          .then(data => ({ type: "skill" as const, data })),
      );
    }

    // Push owner query
    let ownerCharaId = a.owner_chara_id || (a.data as any)?.ownerCharaParamId;
    if (ownerCharaId) {
      parallelPromises.push(
        db
          .selectFrom("inagle_characters")
          .select(["name_fr", "name_en", "slug", "base_slug"])
          .where("id", "=", ownerCharaId)
          .executeTakeFirst()
          .then(data => ({ type: "owner" as const, data })),
      );
    }

    if (parallelPromises.length > 0) {
      const results = await Promise.all(parallelPromises);

      // Process skill results
      const skillResults = results.filter((r: any) => r.type === "skill" && r.data).map((r: any) => r.data);
      const foundSkill = skillResults.find(s => s && (s.name_fr || s.name_en));
      const fallbackSkill = skillResults.find(s => s);
      const targetSkill = foundSkill || fallbackSkill;
      if (targetSkill) {
        skillVideoUrl = targetSkill.video_url;
        skillInternalCode = targetSkill.internal_code;
        skillNameFR = targetSkill.name_fr || targetSkill.name_en || null;
      }

      // Process owner result
      const ownerResult = results.find(r => r.type === "owner" && r.data)?.data;
      if (ownerResult) {
        ownerName = ownerResult.name_fr || ownerResult.name_en || undefined;
        ownerSlug = ownerResult.base_slug || ownerResult.slug || ownerCharaId || undefined;
      }
    }

    return {
      auraId: a.id,
      auraIdStr: a.id,
      displayName: a.name_fr || a.name_en || sd.displayName || sd.name_FR || sd.name_EN || "Inconnu",
      name_FR: a.name_fr || sd.name_FR,
      name_EN: a.name_en || sd.name_EN,
      name_JA: a.name_ja || sd.name_JA,
      desc_FR: a.description_fr || sd.desc_FR,
      desc_JA: a.description_ja || sd.desc_JA,
      element: a.element_id,
      elementName: elementInfo,
      // Image principale = icone carree 256x256 (aura_fs / aura_soul / image_url DB).
      // La telop 1728x352 est un bandeau horizontal, exposee separement via telopUrl
      // pour un affichage adapte (aspect 4.9:1) — pas adaptee au container carre.
      image: (() => {
        const ac = a.asset_code || sd.assetCode || null;
        const subType = a.sub_type || sd.subType;
        // Miximax : icône via le manifeste (cn/ca), JAMAIS le telop périmé
        // `aura_mixi_c05028*` du DB (= bannière d'un autre perso, cf. bug Arthur).
        if (typeSlug === "miximax" || subType === "Miximax") {
          return getMiximaxImageUrl(a.icon_code, ac, a.image_url);
        }
        return (
          getAuraImageUrl(ac, subType) ||
          resolveAssetUrl(a.image_url) ||
          getMiximaxIconUrl(a.icon_code) ||
          resolveAuraTelopUrl(ac) ||
          sd.image ||
          null
        );
      })(),
      // Bandeau telop (1728x352) — affichage banner sous l'image principale.
      // Pour les miximax `wmm`, resolveAuraTelopUrl renvoie null (aucun telop valide).
      telopUrl: resolveAuraTelopUrl(a.asset_code || sd.assetCode || null),
      assetCode: a.asset_code || sd.assetCode,
      subType: a.sub_type || sd.subType || "Aura",
      sheetData: sd,
      skillId: a.skill_id || null,
      skillVideoUrl,
      skillInternalCode,
      skillNameFR,
      ownerCharaParamId: ownerCharaId || undefined,
      ownerName,
      ownerSlug,
      // Modèle 3D COMPLET keshin (corps+armure+textures) assemblé live depuis les CPK.
      // Le code `k<NNNNNN>` vit dans le chemin d'icône (`aura_fs/k…`) ou la colonne `data`.
      // Gardé sur le manifeste des modèles réellement servis → null si non assemblable.
      modelGlbUrl:
        typeSlug === "esprits-guerriers" || typeSlug === "totems"
          ? getKeshinModelGlbUrl(
              extractKeshinModelCode(
                a.image_url,
                typeof a.data === "string" ? a.data : JSON.stringify(a.data ?? ""),
                sd.image,
              ),
            )
          : null,
    };
  },

  /**
   * Galerie des modèles 3D COMPLETS keshin + armures réellement servis live
   * (`/model-full/<code>.glb`). Source codes = manifeste CPK agrégé TypeScript
   * (gate anti-404). Les noms viennent de `inagle_keshins` (par code `k<NNNNNN>` extrait
   * de l'icône) ; l'armure `ka<NNNNNN>NN` mappe sur le même groupe keshin (forme blindée).
   */
  async getKeshinModelGallery(): Promise<{
    keshin: Array<{ code: string; name: string; glbUrl: string }>;
    armures: Array<{ code: string; name: string; glbUrl: string }>;
  }> {
    const db = createInagleSql<WikiSqlDatabase>();
    const rows = await db.selectFrom("inagle_keshins").select(["name_fr", "name_en", "image_url", "data"]).execute();

    // Index code keshin (`k<NNNNNN>`) -> nom FR, extrait icône/data.
    const nameByCode = new Map<string, string>();
    for (const r of rows) {
      const blob = `${r.image_url || ""} ${typeof r.data === "string" ? r.data : JSON.stringify(r.data ?? "")}`;
      const code = extractKeshinModelCode(blob);
      const name = r.name_fr || r.name_en;
      if (code && name && !nameByCode.has(code)) nameByCode.set(code, name);
    }

    const keshin = listServedKeshinCodes().flatMap(code => {
      const glbUrl = getKeshinModelGlbUrl(code);
      return glbUrl ? [{ code, glbUrl, name: nameByCode.get(code) || code }] : [];
    });

    // Armure `ka00<GG>01` -> keshin `k00<GG>0` (groupe). Fallback : code armure.
    const armures = listServedArmureCodes().flatMap(code => {
      const glbUrl = getArmureModelGlbUrl(code);
      if (!glbUrl) return [];
      const grp = code.match(/^ka(\d{2})(\d{2})\d{2}$/);
      const keshinCode = grp ? `k${grp[1]}${grp[2]}0` : null;
      const baseName = keshinCode ? nameByCode.get(keshinCode) : undefined;
      return [{ code, glbUrl, name: baseName ? `${baseName} (Armure)` : code }];
    });

    return { armures, keshin };
  },

  async getAurasList(params: ListParams & { typeSlug: string }): Promise<ListResult<any>> {
    const db = createInagleSql<WikiSqlDatabase>();
    const page = params.page || 1;
    const limit = params.limit || 50;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    // Deduplicate exactly like the `*_clean` views (DISTINCT ON name_fr, lowest id)
    // but read the base tables: the production views were created with a frozen
    // column list, so souls/awakenings/mode_changes lack asset_code, element_id and
    // sub_type ("column asset_code does not exist"). Every base table has them.
    const viewMap: Record<string, AuraTableName> = {
      "esprits-guerriers": "inagle_keshins",
      totems: "inagle_souls",
      miximax: "inagle_miximax",
      eveil: "inagle_awakenings",
      "changement-mode": "inagle_mode_changes",
      autres: "inagle_auras",
    };
    const dedupe = (table: AuraTableName) => table !== "inagle_auras";

    const view = viewMap[params.typeSlug];
    if (!view) return { data: [], total: 0, page, limit };

    // For "éveil", combine awakenings + generic auras (which contain the real awakening entries)
    if (params.typeSlug === "eveil") {
      const buildQuery = (table: AuraTableName) => {
        let query = db
          .selectFrom(table)
          .select([
            "id",
            "name_en",
            "name_fr",
            "name_ja",
            "image_url",
            "asset_code",
            "element_id",
            "sheet_data",
            "description_fr",
            "sub_type",
          ]);
        if (dedupe(table)) query = query.distinctOn("name_fr").orderBy("name_fr").orderBy("id");
        if (params.q) {
          const pattern = `%${params.q}%`;
          query = query.where(eb =>
            eb.or([
              eb("name_fr", "ilike", pattern),
              eb("name_en", "ilike", pattern),
              sql<boolean>`sheet_data->>'name_FR' ILIKE ${pattern}`,
              sql<boolean>`sheet_data->>'name_EN' ILIKE ${pattern}`,
            ]),
          );
        }
        if (params.element) {
          const elIds = getElementIds(params.element);
          if (elIds.length) query = query.where("element_id", "in", elIds);
        }
        return query.orderBy("name_fr", "asc").limit(2000).execute();
      };

      const [awakenings, auras] = await Promise.all([buildQuery("inagle_awakenings"), buildQuery("inagle_auras")]);

      const combined = [...awakenings, ...auras];
      combined.sort((a: any, b: any) => (a.name_fr || "").localeCompare(b.name_fr || "", "fr"));
      const total = combined.length;
      const paged = combined.slice(from, to + 1);

      const results = (paged as unknown as DbAura[]).map(a => {
        const elementInfo = ElementNames[a.element_id as keyof typeof ElementNames] || ElementNames[0];
        const sd = (a.sheet_data || {}) as any;
        const assetCode = (a as any).asset_code || sd.assetCode || null;
        return {
          id: a.id,
          auraId: a.id,
          name: a.name_fr || a.name_en || sd.displayName || sd.name_FR || sd.name_EN || "Inconnu",
          passive: a.description_fr || sd.desc_FR,
          hissatsu_name: sd?.hissatsu?.name || sd?.sheetData?.hissatsu?.name,
          element: elementInfo.en,
          image_url:
            getAuraImageUrl(assetCode, (a as any).sub_type || sd.subType) ||
            getMiximaxIconUrl((a as any).icon_code) ||
            resolveAssetUrl(a.image_url) ||
            resolveAuraTelopUrl(assetCode) ||
            sd.image,
          type: (a as any).sub_type || sd.subType,
          sheetData: normalizeAuraSheetData(a.sheet_data),
          assetCode,
        };
      });

      return { data: results, total, page, limit };
    }

    let query = db
      .selectFrom(view)
      .select([
        "id",
        "name_en",
        "name_fr",
        "name_ja",
        "image_url",
        "asset_code",
        "element_id",
        "sheet_data",
        "description_fr",
        "sub_type",
        ...(view === "inagle_miximax" ? (["icon_code"] as const) : []),
      ]);
    if (dedupe(view)) query = query.distinctOn("name_fr").orderBy("name_fr").orderBy("id");

    // Filter out Keshin Armed (wa*) and Link Transformations (wkt*) from Keshin list to avoid duplicates
    if (view === "inagle_keshins") {
      query = query.where("asset_code", "not ilike", "wa%").where("asset_code", "not ilike", "wkt%");
    }

    if (params.q) {
      const pattern = `%${params.q}%`;
      // Search in both DB columns and sheet_data names (some auras only have names in sheet_data)
      query = query.where(eb =>
        eb.or([
          eb("name_fr", "ilike", pattern),
          eb("name_en", "ilike", pattern),
          sql<boolean>`sheet_data->>'name_FR' ILIKE ${pattern}`,
          sql<boolean>`sheet_data->>'name_EN' ILIKE ${pattern}`,
        ]),
      );
    }
    if (params.element) {
      const elIds = getElementIds(params.element);
      if (elIds.length) query = query.where("element_id", "in", elIds);
    }

    // Miximax: prioritize entries with icon (image) first
    const data = await query.orderBy("name_fr", "asc").execute();
    const count = data.length;
    const pagedData = data.slice(from, to + 1);

    const results = (pagedData as unknown as DbAura[]).map(a => {
      const elementInfo = ElementNames[a.element_id as keyof typeof ElementNames] || ElementNames[0];
      const sd = (a.sheet_data || {}) as any;
      // asset_code n'est pas présent dans toutes les views (ex: inagle_souls_clean)
      // — fallback vers sheet_data.assetCode
      const assetCode = (a as any).asset_code || sd.assetCode || null;
      return {
        id: a.id, // auraId
        auraId: a.id,
        name: a.name_fr || a.name_en || sd.displayName || sd.name_FR || sd.name_EN || "Inconnu",
        passive: a.description_fr || sd.desc_FR,
        hissatsu_name: sd?.hissatsu?.name || sd?.sheetData?.hissatsu?.name,
        element: elementInfo.en,
        image_url:
          // Miximax : icône manifeste (cn/ca), jamais le telop périmé du DB
          // (`aura_mixi_c05028*` = bannière d'un autre perso, cf. bug Arthur).
          params.typeSlug === "miximax"
            ? getMiximaxImageUrl((a as any).icon_code, assetCode, a.image_url)
            : getAuraImageUrl(assetCode, (a as any).sub_type || sd.subType) ||
              getMiximaxIconUrl((a as any).icon_code) ||
              // image_url DB = chemin icône relatif (200_icon/) — priorité sur sd.image (telop)
              resolveAssetUrl(a.image_url) ||
              resolveAuraTelopUrl(assetCode) ||
              sd.image,
        type: (a as any).sub_type || sd.subType,
        sheetData: normalizeAuraSheetData(a.sheet_data),
        assetCode,
      };
    });

    return {
      data: results,
      total: count,
      page,
      limit,
    };
  },

  async getCharacter(id: string): Promise<BaseCharacter | undefined> {
    const db = createInagleSql<SqlDatabase>();
    const row = await db.selectFrom("inagle_characters").selectAll().where("id", "=", id).executeTakeFirst();
    if (!row) return undefined;

    // Fetch all variants sharing this base_slug (or chara_id if base_slug is null)
    let query = db.selectFrom("inagle_characters").selectAll();
    if (row.base_slug) {
      query = query.where("base_slug", "=", row.base_slug);
    } else {
      query = query.where("chara_id", "=", row.chara_id);
    }
    const rows = await query.orderBy("zukan_order", "asc").orderBy("id", "asc").execute();

    const allRows = rows.length > 0 ? rows : [row];
    const mapped = allRows.map(r => this.mapDbCharacterToBase(r)!).filter(Boolean);
    const base = this.groupVariants(mapped)[0];

    if (base) {
      await this._inheritConstellation(base, row);
      if ((row as any)?.rarity_label === "Héros") {
        (base as any).heroConstellations = await this._getHeroConstellations(row);
      }
    }
    return base;
  },

  /** Fetch character by base_slug (name_en + internal_code) — returns best variant as BaseCharacter */
  async getCharacterByBaseSlug(baseSlug: string): Promise<BaseCharacter | undefined> {
    const db = createInagleSql<SqlDatabase>();
    // Fetch all variants sharing this base_slug, ordered by age ASC (youngest first)
    const rows = await db
      .selectFrom("inagle_characters")
      .selectAll()
      .where("base_slug", "=", baseSlug)
      .orderBy("zukan_order", "asc")
      .orderBy("id", "asc")
      .execute();
    if (rows.length === 0) return undefined;

    const mapped = rows.map(r => this.mapDbCharacterToBase(r)!).filter(Boolean);
    const base = this.groupVariants(mapped)[0];

    if (base) {
      const mainRow = rows[0];
      await this._inheritConstellation(base, mainRow);
      if (mainRow?.rarity_label === "Héros") {
        (base as any).heroConstellations = await this._getHeroConstellations(mainRow);
      }
    }
    return base;
  },

  async getCharacterBySlug(slug: string): Promise<BaseCharacter | undefined> {
    const db = createInagleSql<SqlDatabase>();
    const row = await db.selectFrom("inagle_characters").selectAll().where("slug", "=", slug).executeTakeFirst();
    if (!row) return undefined;

    // Fetch all variants sharing this base_slug (or chara_id if base_slug is null)
    let query = db.selectFrom("inagle_characters").selectAll();
    if (row.base_slug) {
      query = query.where("base_slug", "=", row.base_slug);
    } else {
      query = query.where("chara_id", "=", row.chara_id);
    }
    const rows = await query.orderBy("zukan_order", "asc").orderBy("id", "asc").execute();

    const allRows = rows.length > 0 ? rows : [row];
    const mapped = allRows.map(r => this.mapDbCharacterToBase(r)!).filter(Boolean);
    const base = this.groupVariants(mapped)[0];

    if (base) {
      await this._inheritConstellation(base, row);
      if ((row as any)?.rarity_label === "Héros") {
        (base as any).heroConstellations = await this._getHeroConstellations(row);
      }
    }
    return base;
  },

  /** Get all distinct forms/variants of a character (same chara_id, different pos/elem/rarity) */
  async getCharacterForms(
    charaId: string,
    sheetId?: string,
    baseSlug?: string,
  ): Promise<
    Array<{
      id: string;
      slug: string;
      position: string;
      element: string;
      rarity: string;
      rarityCode: number;
      zukanHash?: string;
      internalCode?: string;
      heroType?: string;
      series?: string;
      ageGroup?: string;
      schoolYear?: string;
      zukanOrder?: number;
    }>
  > {
    const db = createInagleSql<SqlDatabase>();
    const fields = [
      "id",
      "slug",
      "position",
      "element",
      "rarity_label",
      "rarity",
      "zukan_hash",
      "zukan_order",
      "internal_code",
      "stat_frappe",
      "hero_type",
      "series",
      sql<string | null>`age_group`.as("age_group"),
      sql<string | null>`school_year`.as("school_year"),
    ] as const;
    let query = db.selectFrom("inagle_characters").select(fields);
    if (baseSlug) {
      query = query.where("base_slug", "=", baseSlug);
    } else if (sheetId) {
      query = query.where(sql<boolean>`sheet_data->>'sheetId' = ${sheetId}`);
    } else {
      query = query.where("chara_id", "=", charaId);
    }
    const data = await query.orderBy("zukan_order", "asc").orderBy("id", "asc").execute();
    const groupByZukanVersion = baseSlug?.startsWith("shawn-froste") ?? false;
    // Sort within groups: prefer versions with zukan_hash, then highest stat_frappe
    // This ensures dedup picks the most enriched version as canonical
    const sorted = (data as any[]).sort((a: any, b: any) => {
      if (groupByZukanVersion) {
        const orderDiff = (a.zukan_order ?? 999999) - (b.zukan_order ?? 999999);
        if (orderDiff !== 0) return orderDiff;
      }
      // Primary: rarity DESC
      const rDiff = (Number(b.rarity) || 0) - (Number(a.rarity) || 0);
      if (rDiff !== 0) return rDiff;
      // Secondary: has zukan_hash first
      const aHash = a.zukan_hash ? 1 : 0;
      const bHash = b.zukan_hash ? 1 : 0;
      if (bHash !== aHash) return bHash - aHash;
      // Tertiary: highest stat_frappe (proxy for enrichment quality)
      return (Number(b.stat_frappe) || 0) - (Number(a.stat_frappe) || 0);
    });
    // Deduplicate by position+element+rarity+heroType+internalCode combo (keep first = most enriched)
    const seen = new Set<string>();
    const results: Array<{
      id: string;
      slug: string;
      position: string;
      element: string;
      rarity: string;
      rarityCode: number;
      zukanHash?: string;
      internalCode?: string;
      heroType?: string;
      series?: string;
      ageGroup?: string;
      schoolYear?: string;
      zukanOrder?: number;
    }> = [];
    for (const r of sorted) {
      const pos = r.position || "MF";
      const elem = r.element || "Void";
      const rar = r.rarity_label || "Normal";
      const heroType = r.hero_type || "";
      const internalCode = r.internal_code || "";
      const key =
        groupByZukanVersion && r.zukan_hash
          ? `zukan:${r.zukan_hash}`
          : `${pos}|${elem}|${rar}|${heroType}|${internalCode}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        id: r.id,
        slug: r.slug || r.id,
        position: pos,
        element: elem,
        rarity: rar,
        rarityCode: Number(r.rarity) || 1,
        zukanHash: r.zukan_hash || undefined,
        internalCode: r.internal_code || undefined,
        heroType: r.hero_type || undefined,
        series: r.series || undefined,
        ageGroup: r.age_group || undefined,
        schoolYear: r.school_year || undefined,
        zukanOrder: r.zukan_order ?? undefined,
      });
    }
    return results;
  },

  async getCharactersList(params: ListParams): Promise<ListResult<BaseCharacter>> {
    if (params.position === "COACH" || params.role === "Coordinator" || params.role === "Coach") {
      return this.getCoordinatorsList(params);
    }

    const db = createInagleSql<SqlDatabase>();
    const page = params.page || 1;
    const limit = params.limit || 50;
    const from = (page - 1) * limit;
    const predicates = [sql<boolean>`name_en is not null and name_en <> ''`];

    if (params.q) {
      const pattern = `%${params.q}%`;
      predicates.push(sql<boolean>`(name_fr ilike ${pattern} or name_en ilike ${pattern})`);
    }
    if (params.element) {
      // Filter by exact text code ("Fire", "Wind"). DB columns are in French.
      const elementMap: Record<string, string> = {
        Fire: "Feu",
        Wind: "Vent",
        Forest: "Forêt",
        Mountain: "Montagne",
      };
      const dbElement = elementMap[params.element] || params.element;
      predicates.push(sql<boolean>`element = ${dbElement}`);
    }
    if (params.position) {
      // Filter by exact text code ("GK", "FW"). DB columns are in French.
      const positionMap: Record<string, string> = {
        GK: "Gardien",
        DF: "Défenseur",
        MF: "Milieu",
        FW: "Attaquant",
      };
      const dbPosition = positionMap[params.position] || params.position;
      predicates.push(sql<boolean>`position = ${dbPosition}`);
    }
    if (params.rarity === "Héros") {
      predicates.push(sql<boolean>`rarity_label = 'Héros'`);
    } else if (params.rarity === "BASARA") {
      predicates.push(sql<boolean>`rarity_label = 'BASARA'`);
    } else {
      if (params.rarity) {
        predicates.push(sql<boolean>`rarity_label = ${params.rarity}`);
      }
      predicates.push(sql<boolean>`is_primary = true`);
    }
    // Exclude _5000 variant entries (duplicates of normal characters)
    predicates.push(sql<boolean>`internal_code not like '%_5000'`);
    // Exclude MixiMax forms (c05028*) and fusions (× in name)
    predicates.push(sql<boolean>`internal_code not like 'c05028%'`);
    predicates.push(sql<boolean>`name_en not like '%×%'`);
    // Exclude animal/NPC entries (an* prefix) and nameless entries
    predicates.push(sql<boolean>`internal_code not like 'an%'`);
    if (params.team) {
      // Use parameterized .eq() for team_id and separate JSONB containment
      // (avoid string-interpolating values with quotes into the filter)
      const safeTeam = params.team;
      predicates.push(sql<boolean>`(team_id = ${safeTeam} or teams @> ${JSON.stringify([{ id: safeTeam }])}::jsonb)`);
    }
    if (params.gender) {
      // FilterChips: "1" = male, "2" = female; DB column: "M" / "F"
      const genderMap: Record<string, string> = { "1": "M", "2": "F" };
      const dbGender = genderMap[params.gender];
      if (dbGender) predicates.push(sql<boolean>`gender = ${dbGender}`);
    }
    if (params.playstyle) {
      // "Freedom" (Orion) = "Breach" (Victory Road) — meme style de jeu
      if (params.playstyle === "Breach") {
        predicates.push(sql<boolean>`sheet_data->>'playstyle' in ('Breach', 'Freedom')`);
      } else {
        predicates.push(sql<boolean>`sheet_data->>'playstyle' = ${params.playstyle}`);
      }
    }
    if (params.status !== "all") {
      // "Incomplets masqués" : on garde tout perso jouable (sheet_data),
      // contrôlable, OU présent dans le zukan officiel (zukan_order non null).
      // Sans la clause zukan_order, les persos emblématiques sans sheet_data
      // (Mark Evans #0, etc.) disparaissaient → la liste ne commençait plus
      // au #0 du zukan. On ne masque désormais que les entrées hors-zukan.
      predicates.push(sql<boolean>`(sheet_data is not null or is_controllable = true or zukan_order is not null)`);
    }
    if (params.status === "jouable") {
      predicates.push(sql<boolean>`is_controllable = true`);
    }
    if (params.series) {
      // Series column is authoritative (from cfg.bin seriesId + zukan game)
      // No prefix-based fallback needed — DB series are correct
      predicates.push(sql<boolean>`series = ${params.series}`);
    }
    if (params.ageGroup) {
      // Valeur brute EN, telle que capturée par crawlZukanOrder (zukan.inazuma.jp
      // `ul.basic`) — pas de table de correspondance FR côté DB, l'UI traduit à
      // l'affichage (cf. CharacterFilters).
      predicates.push(sql<boolean>`age_group = ${params.ageGroup}`);
    }
    if (params.schoolYear) {
      // Valeur EN officielle du Zukan (Grade 7/8/9), alimentée par le même crawl
      // que zukan_order et filtrée en base avant pagination.
      predicates.push(sql<boolean>`school_year = ${params.schoolYear}`);
    }
    // Default sort: zukan_order ASC (official zukan.inazuma.jp order), fallback internal_code
    const where = sql<boolean>`${sql.join(predicates, sql` and `)}`;
    let data: any[] = [];
    let count = 0;
    try {
      [data, count] = await Promise.all([
        db
          .selectFrom("inagle_characters")
          .selectAll()
          .where(where)
          .orderBy("zukan_order", "asc")
          .orderBy("internal_code", "asc")
          .limit(limit)
          .offset(from)
          .execute(),
        db
          .selectFrom("inagle_characters")
          .select(eb => eb.fn.countAll<number>().as("count"))
          .where(where)
          .executeTakeFirst()
          .then(row => Number(row?.count ?? 0)),
      ]);
    } catch (error) {
      console.error("Error fetching characters:", error);
      return { data: [], total: 0, page, limit };
    }

    // Map to BaseCharacter — chaque variante est une carte distincte (pas de groupement)
    const mapped = (data as any[]).map(char => this.mapDbCharacterToBase(char)!).filter(Boolean);

    // Regrouper les variantes de rareté d'un même personnage (Normal + Héros = 1 carte)
    const deduped = this.groupVariants(mapped);

    // Note: `count` est le nombre de ROWS post-filtres (≈ nombre de cartes
    // avant groupement). Le ratio de déduplication est ~5-15% (variantes
    // Normal+Expert d'un même perso → 1 carte). L'ancienne formule
    // `count - (mapped.length - deduped.length)` se basait sur le delta de
    // la page courante seulement → sous-estimait de ~80% le vrai total.
    // `count` direct sur-estime légèrement (~10%) mais c'est très proche
    // du vrai nombre de personnages affichés et la pagination est correcte.
    return {
      data: deduped,
      total: count || 0,
      page,
      limit,
    };
  },

  async getCoordinatorPools(): Promise<{ coaches: any[]; managers: any[] }> {
    const db = createInagleSql<WikiSqlDatabase>();
    const rows = await db
      .selectFrom("inagle_coordinators")
      .selectAll()
      .where("role", "in", ["Coach", "Manager", "Coordinator"])
      .execute();
    // DB "Manager" + "Coach" = coachs in-game, DB "Coordinator" = manageuses
    return {
      coaches: rows.filter((r: any) => r.role === "Manager" || r.role === "Coach"),
      managers: rows.filter((r: any) => r.role === "Coordinator"),
    };
  },

  async getCoordinatorsList(params: ListParams): Promise<ListResult<BaseCharacter>> {
    const db = createInagleSql<WikiSqlDatabase>();
    const page = params.page || 1;
    const limit = params.limit || 50;
    const from = (page - 1) * limit;
    const predicates = [sql<boolean>`role is not null`];

    if (params.q) {
      const q = `%${params.q}%`;
      predicates.push(sql<boolean>`(name_localised ilike ${q} or name_romaji ilike ${q})`);
    }

    if (params.role === "Coordinator") {
      predicates.push(sql<boolean>`role = 'Coordinator'`);
    } else if (params.role === "Coach") {
      predicates.push(sql<boolean>`role in ('Coach', 'Manager')`);
    }

    // Element filter for Coordinators (stored as Kanji)
    if (params.element) {
      const elementMap: Record<string, string> = {
        Wind: "風",
        Wood: "林", // Assuming Wood/Forest
        Forest: "林",
        Fire: "火",
        Earth: "山", // Assuming Earth/Mountain
        Mountain: "山",
        Void: "無",
      };
      const kanji = elementMap[params.element];
      if (kanji) predicates.push(sql<boolean>`element = ${kanji}`);
    }

    const where = sql<boolean>`${sql.join(predicates, sql` and `)}`;
    try {
      const [data, countRow] = await Promise.all([
        db
          .selectFrom("inagle_coordinators")
          .selectAll()
          .where(where)
          .orderBy("name_localised", "asc")
          .limit(limit)
          .offset(from)
          .execute(),
        db
          .selectFrom("inagle_coordinators")
          .select(eb => eb.fn.countAll<number>().as("count"))
          .where(where)
          .executeTakeFirst(),
      ]);
      const count = Number(countRow?.count ?? 0);
      // Zukan hash mapping for coordinators/coaches (matched from zukan.inazuma.jp by name)
      const COORD_ZUKAN: Record<number, string> = {
        1: "k/c/b/cb88nfolkwe",
        2: "k/z/p/zpndk6oxjls",
        3: "k/x/i/xikbkjcdmjs",
        4: "k/t/2/t2vvykaoccs",
        5: "k/n/z/nz2ghxvgpic",
        6: "k/q/u/quvzfkeq5ns",
        7: "k/o/3/o32tnwlthge",
        8: "k/k/h/kh5u-b7dslk",
        9: "k/v/v/vvi1tkdn_4m",
        10: "k/h/f/hf3tipefyhk",
        11: "k/k/5/k5er_or9jem",
        12: "k/o/y/oyxxlfats7e",
        13: "k/6/x/6xd84b32hzk",
        14: "k/b/x/bxrne-6vwfk",
        15: "k/e/u/euxp3_h_s_c",
        16: "k/o/z/ozsfcxwjxve",
        17: "k/u/g/ugqtm_smug0",
        18: "k/d/d/dddirygeelc",
        19: "k/h/c/hcb0r88rb-s",
        20: "k/k/f/kfck9hlg5js",
        21: "k/y/a/yaeyhvxpmwc",
        22: "k/s/y/sy5iwvawaj0",
        23: "k/u/t/ut_eshg5f8e",
        24: "k/n/l/nl_glun8epm",
        25: "k/c/m/cmtsbm0og6u",
        26: "k/t/k/tkcz2zs0rj8",
        27: "k/h/j/hjc80umli2k",
        28: "k/o/m/om1n5jmhidm",
        29: "k/7/8/78eqog2k9du",
        30: "k/y/5/y5zbdtcoxo8",
        31: "k/9/i/9ixx-wa6jqu",
        32: "k/8/w/8wocttgsuu0",
        33: "k/n/y/ny_j-sgwdnc",
        34: "k/p/5/p54_qlu6ghc",
        35: "k/e/-/e-qruphieye",
        36: "k/v/w/vwbkdwhyzbs",
        37: "k/b/8/b8ksybiqu-e",
        38: "k/e/8/e8o-flnjyhm",
        39: "k/1/u/1u_foarz1sk",
        40: "k/v/7/v7cq7herayu",
        41: "k/v/v/vvrzhm1aiie",
        42: "k/k/t/kttlw44rtb8",
        43: "k/s/n/snbzvhuzhmm",
        44: "k/m/i/mi4sg8b7ug8",
        45: "k/u/g/ugcf748fkgm",
        46: "k/9/g/9gjnrd9b51u",
        47: "k/o/p/op_woljxra8",
        48: "k/f/u/futkwhaljtk",
        49: "k/c/f/cft3awvkb0e",
        50: "k/g/-/g-obvenkgrc",
        51: "k/b/w/bwxwy2_pw90",
        52: "k/8/w/8w28mu4bix0",
        53: "k/c/f/cfvj1znj93e",
        54: "k/t/3/t3koymrzqes",
        55: "k/v/w/vwj02v5fvcs",
        56: "k/e/-/e-svbqfl4xe",
        57: "k/-/r/-rxgi3qtnr0",
        58: "k/p/5/p5ablimxgic",
        59: "k/7/t/7t_zufp1hd0",
        60: "k/k/7/k7o456ppquc",
      };
      const results = data.map(c => {
        const revMap: Record<string, string> = {
          風: "Wind",
          林: "Forest",
          火: "Fire",
          山: "Mountain",
          無: "Void",
        };
        const elEn = revMap[c.element ?? ""] || "Void";
        const zukanHash = COORD_ZUKAN[c.id] || undefined;
        const imageUrl = zukanHash ? `https://dxi4wb638ujep.cloudfront.net/1/${zukanHash}.png` : null;
        return {
          charaId: `coord_${c.id}`,
          internalCode: `COORD_${c.id}`,
          names: { fr: c.name_localised, en: c.name_localised, ja: c.name_kanji },
          gender: c.gender === "女" ? 1 : 0,
          variants: [
            {
              charaParamId: `coord_${c.id}`,
              position: "COACH",
              positionRaw: 0,
              element: elEn,
              rarity: c.role || "Coach",
              rarityCode: 1,
              stats: { lv99: {} },
              skills: [],
              image: imageUrl,
              zukanHash,
            },
          ],
          bestRarity: c.role || "Coach",
          bestRarityCode: 1,
          isBasara: false,
          image: imageUrl,
          descriptions: {
            fr: `Rôle: ${c.role}\nEffet: ${c.stat} +${c.buff}\nCondition: ${c.requirements}`,
          },
          sheetData: {
            passive_no: c.passive_no,
            buff: c.buff,
            stat: c.stat,
            requirements: c.requirements,
          },
          wikiSections: [],
          slug: `coord-${c.id}`,
          series: c.game || "Inazuma Eleven",
          teamId: null,
          teamName: "Coach/Manager",
          zukanHash,
        } as any;
      });
      return { data: results, total: count, page, limit };
    } catch (error) {
      console.error("Error fetching coordinators:", error);
      return { data: [], total: 0, page, limit };
    }
  },
  async getItem(id: string): Promise<Item | undefined> {
    // ... existing getItem ...
    const db = createInagleSql<SqlDatabase>();
    // Try exact match on ID first (hex), then internal_code/name if needed
    let row = await db.selectFrom("inagle_items").selectAll().where("id", "=", id).executeTakeFirst();

    if (!row) {
      const fallbackRow = await db
        .selectFrom("inagle_items")
        .selectAll()
        .where(eb => eb.or([eb("internal_code", "=", id), eb("name_en", "=", id), eb("name_fr", "=", id)]))
        .limit(1)
        .executeTakeFirst();
      row = fallbackRow;
    }

    if (row) {
      const item = row as unknown as DbItem;
      const sd = (item.sheet_data || {}) as any;
      // `data` = ParsedItem complet (parser inagle) — porte bonuses/maxStack/descriptions
      // natifs même si sheet_data est un snapshot communautaire plus ancien.
      const parsed = ((row as any).data || {}) as any;
      const community = sd.sheetData || {};
      const descFr = item.description_fr || sd.descriptions?.fr || parsed.descriptions?.fr || null;
      const descEn = item.description_en || sd.descriptions?.en || parsed.descriptions?.en || null;
      const descJa = item.description_ja || sd.descriptions?.ja || parsed.descriptions?.ja || null;
      // Bonus de stats RÉELS (kick +6, …) — natifs parser, jamais les codes bruts stat1/stat2.
      const bonuses =
        sd.bonuses && Object.keys(sd.bonuses).length
          ? sd.bonuses
          : parsed.bonuses && Object.keys(parsed.bonuses).length
            ? parsed.bonuses
            : null;
      const maxStack = sd.maxStack ?? parsed.maxStack ?? null;
      return {
        itemId: item.id,
        internalCode: item.internal_code || sd.internalCode || parsed.internalCode,
        names: {
          fr: item.name_fr,
          en: item.name_en,
          ja: item.name_ja || sd.names?.ja,
        },
        descriptions: { fr: descFr, en: descEn, ja: descJa },
        name_FR: item.name_fr,
        description: descFr,
        description_EN: descEn,
        description_JA: descJa,
        category: item.category,
        rarity: item.rarity,
        image: resolveAssetUrl(item.image_url) || item.image_url,
        imageUrl: resolveAssetUrl(item.image_url) || item.image_url,
        // Shops: top-level column (populated by update-item-prices.ts), fallback to sheet_data
        shops: (row as any).shops || sd.shops || parsed.shops || null,
        // Note: top-level 'price' column contains catalog sort IDs (not real GP prices) — do not use
        price: sd.price || parsed.price || null,
        stats: community.stats || null,
        bonuses,
        maxStack,
        location: community.location || null,
        attributes: sd.attributes || parsed.attributes || null,
        exchangeRecipes: sd.exchangeRecipes || null,
        sheetData: community,
      } as any;
    }
    return undefined;
  },

  async getItemsList(params: ListParams): Promise<ListResult<Item>> {
    if (params.category === "special_tactics") {
      return this.getTacticsList(params);
    }

    const db = createInagleSql<SqlDatabase>();
    const page = params.page || 1;
    const limit = params.limit || 50;
    const from = (page - 1) * limit;
    let query = db.selectFrom("inagle_items");
    let countQuery = db.selectFrom("inagle_items");

    if (params.q) {
      const pattern = `%${sanitizeFilter(params.q)}%`;
      const condition = (builder: typeof query) =>
        builder.where(eb => eb.or([eb("name_fr", "ilike", pattern), eb("name_en", "ilike", pattern)]));
      query = condition(query);
      countQuery = condition(countQuery);
    }
    if (params.category) {
      query = query.where("category", "=", params.category);
      countQuery = countQuery.where("category", "=", params.category);
    }

    try {
      const [data, countRow] = await Promise.all([
        query.selectAll().orderBy("id", "asc").limit(limit).offset(from).execute(),
        countQuery.select(eb => eb.fn.countAll<number>().as("count")).executeTakeFirst(),
      ]);
      const count = Number(countRow?.count ?? 0);
      const results = (data as unknown as DbItem[]).map(item => {
        const sd = (item.sheet_data || {}) as any;
        const parsed = ((item as any).data || {}) as any;
        const community = sd.sheetData || {};
        // Bonus de stats réels (kick +6, …) provenant de la ligne SQL canonique.
        const bonuses =
          sd.bonuses && Object.keys(sd.bonuses).length
            ? sd.bonuses
            : parsed.bonuses && Object.keys(parsed.bonuses).length
              ? parsed.bonuses
              : null;
        return {
          itemId: item.id,
          internalCode: item.internal_code,
          names: { fr: item.name_fr, en: item.name_en, ja: item.name_ja },
          name_FR: item.name_fr,
          category: item.category,
          rarity: item.rarity,
          image: resolveAssetUrl(item.image_url) || item.image_url,
          price: sd.price || parsed.price || null,
          location: community.location || null,
          stats: community.stats || null,
          bonuses,
          shops: (item as any).shops || sd.shops || null,
        } as any;
      });
      return { data: results, total: count, page, limit };
    } catch (error) {
      console.error("Error fetching items:", error);
      return { data: [], total: 0, page, limit };
    }
  },

  async getOverrideSkillsForSkill(skillId: string): Promise<any[]> {
    const db = createInagleSql<WikiSqlDatabase>();

    // Two cases:
    // A) This skill IS the override result → query by id
    // B) This skill appears in conditions → must scan JSONB (no index), fetch all and filter in JS
    const [{ data: directMatch }, { data: allOverrides }] = await Promise.all([
      db
        .selectFrom("inagle_override_skills")
        .selectAll()
        .where("id", "=", skillId)
        .execute()
        .then(data => ({ data })),
      db
        .selectFrom("inagle_override_skills")
        .selectAll()
        .execute()
        .then(data => ({ data })),
    ]);

    if (!allOverrides) return directMatch || [];

    // Deduplicate: merge direct match with condition matches
    const seen = new Set<string>();
    const combined = [
      ...(directMatch || []),
      ...allOverrides.filter((override: any) => {
        if (override.id === skillId) return false; // already in directMatch
        const conditions = override.conditions as any[];
        if (!conditions) return false;
        return conditions.some((c: any) => c.required_skills?.some((rs: any) => rs.skill_id === skillId));
      }),
    ].filter((row: any) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    });

    return combined.map((row: any) => ({
      id: row.id,
      name_fr: row.name_fr,
      name_en: row.name_en,
      name_ja: row.name_ja,
      element_id: row.element_id,
      category_id: row.category_id,
      power_min: row.power_min,
      power_max: row.power_max,
      conditions: row.conditions,
    }));
  },

  async getRandomTeamPools(playstyles?: string[]): Promise<{
    gk: BaseCharacter[];
    df: BaseCharacter[];
    mf: BaseCharacter[];
    fw: BaseCharacter[];
  }> {
    const db = createInagleSql<SqlDatabase>();
    const positionMap: Record<string, string> = {
      GK: "Gardien",
      DF: "Défenseur",
      MF: "Milieu",
      FW: "Attaquant",
    };
    const fetchPool = async (position: string, limit: number) => {
      const dbPosition = positionMap[position] || position;
      let query = db
        .selectFrom("inagle_characters")
        .selectAll()
        .where("position", "=", dbPosition)
        .where("stat_frappe", "is not", null)
        .where("zukan_hash", "is not", null);
      if (playstyles && playstyles.length > 0) {
        query = query.where(
          sql<boolean>`sheet_data->>'playstyle' in (${sql.join(
            playstyles.map(p => sql`${p}`),
            sql`, `,
          )})`,
        );
      }
      const data = await query.limit(limit).execute();
      return data.map(c => this.mapDbCharacterToBase(c)!).filter(Boolean);
    };
    const [gk, df, mf, fw] = await Promise.all([
      fetchPool("GK", 200),
      fetchPool("DF", 400),
      fetchPool("MF", 400),
      fetchPool("FW", 400),
    ]);
    return { gk, df, mf, fw };
  },

  async getSkill(id: string): Promise<Skill | undefined> {
    const db = createInagleSql<SqlDatabase>();
    const row = await db
      .selectFrom("inagle_skills")
      .selectAll()
      .where(eb =>
        eb.or(
          id.startsWith("0x")
            ? [eb("id", "=", id), sql<boolean>`data->>'skillID' = ${id}`, sql<boolean>`sheet_data->>'skillID' = ${id}`]
            : [eb("id", "=", id), eb("internal_code", "=", id), eb("name_en", "=", id), eb("name_fr", "=", id)],
        ),
      )
      .limit(1)
      .executeTakeFirst();

    if (row) {
      const h = row as unknown as DbSkill;
      const elementMap: Record<string, { en: string; ja: string; fr: string }> = {
        Feu: { en: "Fire", ja: "火", fr: "Feu" },
        Vent: { en: "Wind", ja: "風", fr: "Vent" },
        Forêt: { en: "Forest", ja: "林", fr: "Forêt" },
        Montagne: { en: "Mountain", ja: "山", fr: "Montagne" },
        Néant: { en: "Void", ja: "無", fr: "Néant" },
        Aucun: { en: "Void", ja: "無", fr: "Néant" },
      };
      const categoryMap: Record<string, { en: string; ja: string; fr: string }> = {
        Tir: { en: "Shoot", ja: "シュート", fr: "Tir" },
        Dribble: { en: "Dribble", ja: "ドリブル", fr: "Dribble" },
        Défense: { en: "Block", ja: "ブロック", fr: "Défense" },
        Arrêt: { en: "Catch", ja: "キャッチ", fr: "Arrêt" },
      };
      const elementInfo = elementMap[h.element || ""] || { en: "Void", ja: "無", fr: "Néant" };
      const categoryInfo = categoryMap[h.category || ""] || { en: "None", ja: "なし", fr: "Aucun" };
      // La surface complète inagle (shops, foulRate, tags, recastTime…) vit dans la
      // colonne `data` ; `sheet_data` ne porte que les overrides communautaires (souvent
      // vide pour les hissatsu wh*/rh*). On fusionne les deux, sheet_data prioritaire.
      const sd = { ...((h as any).data as any), ...(h.sheet_data as any) } as any;

      return {
        // Spread all inagle fields from data + sheet_data (foulRate, tags, shops, etc.)
        ...sd,
        // Override with DB column values (authoritative)
        skillId: h.id,
        internalCode: h.internal_code,
        names: { en: h.name_en, fr: h.name_fr, ja: h.name_ja },
        descriptions: { fr: h.description_fr, ja: h.description_ja },
        displayName: h.name_fr || h.name_en || "Inconnu",
        name_FR: h.name_fr,
        name_EN: h.name_en,
        name_JA: h.name_ja,
        desc_FR: h.description_fr || sd.desc_FR,
        desc_EN: sd.desc_EN,
        power_min: h.power_min,
        power_max: h.power_max,
        consumeTp: h.tension_cost,
        elementName: elementInfo,
        categoryName: categoryInfo,
        image: resolveAssetUrl(h.image_url) || h.image_url,
        videoUrl: h.video_url || null,
        // Vidéo officielle zukan : `poster_url` est la vraie image d'attente
        // (image extraite de la vidéo), `thumbnail_url` sa vignette webp légère.
        posterUrl: h.poster_url || null,
        thumbnailUrl: h.thumbnail_url || null,
        // Community sheet data (from match-skills enrichment or nested sheetData)
        sheetData:
          sd.sheetData ||
          ({
            matchedName: sd.matchedName,
            shop: sd.shop,
            type: sd.type,
            subType: sd.subType,
            power: sd.power,
            tension: sd.tension,
            duration: sd.duration,
          } as any),
      } as any;
    }
    return undefined;
  },

  async getSkillsList(params: ListParams): Promise<ListResult<Skill>> {
    const db = createInagleSql<WikiSqlDatabase>();
    const page = params.page || 1;
    const limit = params.limit || 50;
    const from = (page - 1) * limit;
    // Only real hissatsu skills (wh*/rh*), exclude _or element variants.
    const predicates = [
      sql<boolean>`(internal_code like 'wh%' or internal_code like 'rh%')`,
      sql<boolean>`id not like '%_or'`,
    ];

    if (params.q) {
      const pattern = `%${params.q}%`;
      predicates.push(sql<boolean>`(name_fr ilike ${pattern} or name_en ilike ${pattern})`);
    }
    if (params.element) {
      // element column stores values like 'Feu', 'Vent', 'Forêt', 'Montagne', 'Néant', 'Aucun'
      // Map param.element (e.g. 'Fire', 'Wind', 'Forest', 'Mountain', 'Void') to French element name
      const elementMap: Record<string, string> = {
        fire: "Feu",
        wind: "Vent",
        forest: "Forêt",
        mountain: "Montagne",
        void: "Néant",
      };
      const searchElem = elementMap[params.element.toLowerCase()] || params.element;
      predicates.push(sql<boolean>`element = ${searchElem}`);
    }
    if (params.category) {
      // category column stores values like 'Tir', 'Défense', 'Dribble', 'Arrêt'
      // Map param.category (e.g. 'shoot', 'block', 'dribble', 'catch') to French category name
      const categoryMap: Record<string, string> = {
        shoot: "Tir",
        block: "Défense",
        dribble: "Dribble",
        catch: "Arrêt",
      };
      const searchCat = categoryMap[params.category.toLowerCase()] || params.category;
      predicates.push(sql<boolean>`category = ${searchCat}`);
    }
    if (params.has_video) {
      predicates.push(sql<boolean>`video_url is not null`);
    }
    if (params.power_min) {
      predicates.push(sql<boolean>`power_max >= ${parseInt(params.power_min, 10)}`);
    }
    if (params.power_max) {
      predicates.push(sql<boolean>`power_max <= ${parseInt(params.power_max, 10)}`);
    }
    if (!params.show_aura) {
      predicates.push(sql<boolean>`is_hyper = false`);
    }

    // Overdrive filter: only show required skills for overdrive combinations
    // inagle_override_skills uses hex IDs; inagle_skills stores the hex ID in sheet_data->>'skillID'
    if (params.overdrive) {
      const overrides = await db.selectFrom("inagle_override_skills").select("conditions").execute();
      const hexIds = new Set<string>();
      for (const o of overrides) {
        for (const c of (o.conditions as any[]) || []) {
          for (const rs of c.required_skills || []) {
            if (rs.skill_id) hexIds.add(rs.skill_id);
          }
        }
      }
      if (hexIds.size > 0) {
        predicates.push(
          sql<boolean>`data->>'skillID' in (${sql.join(
            [...hexIds].map(id => sql`${id}`),
            sql`, `,
          )})`,
        );
      } else {
        predicates.push(sql<boolean>`false`);
      }
    }

    const where = sql<boolean>`${sql.join(predicates, sql` and `)}`;
    let query = db.selectFrom("inagle_skills").where(where);
    let countQuery = db.selectFrom("inagle_skills").where(where);
    if (params.sort === "power") {
      query = query.orderBy("power_max", "desc");
    } else if (params.sort === "tension_asc") {
      query = query.orderBy("tension_cost", "asc");
    } else {
      query = query.orderBy("video_url", "asc").orderBy("tension_cost", "desc");
    }

    try {
      const [data, countRow] = await Promise.all([
        query.selectAll().limit(limit).offset(from).execute(),
        countQuery.select(eb => eb.fn.countAll<number>().as("count")).executeTakeFirst(),
      ]);
      const count = Number(countRow?.count ?? 0);
      const results = (data as unknown as DbSkill[]).map(h => {
        const elementMap: Record<string, { en: string; ja: string; fr: string }> = {
          Feu: { en: "Fire", ja: "火", fr: "Feu" },
          Vent: { en: "Wind", ja: "風", fr: "Vent" },
          Forêt: { en: "Forest", ja: "林", fr: "Forêt" },
          Montagne: { en: "Mountain", ja: "山", fr: "Montagne" },
          Néant: { en: "Void", ja: "無", fr: "Néant" },
          Aucun: { en: "Void", ja: "無", fr: "Néant" },
        };
        const categoryMap: Record<string, { en: string; ja: string; fr: string }> = {
          Tir: { en: "Shoot", ja: "シュート", fr: "Tir" },
          Dribble: { en: "Dribble", ja: "ドリブル", fr: "Dribble" },
          Défense: { en: "Block", ja: "ブロック", fr: "Défense" },
          Arrêt: { en: "Catch", ja: "キャッチ", fr: "Arrêt" },
        };
        const elementInfo = elementMap[h.element || ""] || { en: "Void", ja: "無", fr: "Néant" };
        const categoryInfo = categoryMap[h.category || ""] || {
          en: "None",
          ja: "なし",
          fr: "Aucun",
        };
        return {
          skillId: h.id,
          skillID: h.id,
          skillIDStr: h.internal_code || h.id,
          internalCode: h.internal_code,
          category: h.category_id,
          names: { en: h.name_en, fr: h.name_fr, ja: h.name_ja },
          displayName: h.name_fr || h.name_en || "Inconnu",
          name_FR: h.name_fr,
          name_EN: h.name_en,
          power_min: h.power_min,
          power_max: h.power_max,
          consumeTp: h.tension_cost,
          elementName: elementInfo,
          categoryName: categoryInfo,
          image: resolveAssetUrl(h.image_url) || h.image_url,
          videoUrl: h.video_url || null,
          posterUrl: h.poster_url || null,
          thumbnailUrl: h.thumbnail_url || null,
          shop: (() => {
            const s = (h.sheet_data as any)?.shop;
            return s ? SHOP_FR[s] || s : null;
          })(),
          sheetData: h.sheet_data,
        } as any;
      });
      return { data: results, total: count, page, limit };
    } catch (error) {
      console.error("Error fetching skills:", error);
      return { data: [], total: 0, page, limit };
    }
  },

  async getTactic(slug: string): Promise<any | null> {
    const db = createInagleSql<WikiSqlDatabase>();
    // Fast path: query by internal_code directly (avoids full table scan)
    const direct = await db
      .selectFrom("inagle_tactics")
      .selectAll()
      .where("internal_code", "=", slug)
      .executeTakeFirst();
    if (direct) {
      // Complète les champs manquants (power/element/partenaires) depuis le superset.
      const special = await db
        .selectFrom("inagle_special_tactics")
        .selectAll()
        .where("internal_code", "=", slug)
        .executeTakeFirst();
      return tacticDetailFromTactics(direct, special);
    }
    // La tactique peut n'exister QUE dans le superset (wht* de scénario absentes d'inagle_tactics).
    const directSpecial = await db
      .selectFrom("inagle_special_tactics")
      .selectAll()
      .where("internal_code", "=", slug)
      .executeTakeFirst();
    if (directSpecial && !isPlaceholderSpecialTactic(directSpecial)) {
      return specialTacticToDetail(directSpecial);
    }
    // Fallback: slug is derived from name — must fetch all to compute slug match (les deux tables).
    const [allT, allS] = await Promise.all([
      db.selectFrom("inagle_tactics").selectAll().execute(),
      db.selectFrom("inagle_special_tactics").selectAll().execute(),
    ]);
    const matchT = allT.find(t => tacticSlug(t.name) === slug);
    if (matchT) {
      const special = allS.find((s: any) => s.internal_code === matchT.internal_code);
      return tacticDetailFromTactics(matchT, special);
    }
    const matchS = allS.find(
      (s: any) => !isPlaceholderSpecialTactic(s) && tacticSlug(s.name_en || s.name_fr || s.internal_code) === slug,
    );
    if (matchS) return specialTacticToDetail(matchS);
    return null;
  },

  async getTacticsList(params: ListParams): Promise<ListResult<Item>> {
    const db = createInagleSql<WikiSqlDatabase>();
    const page = params.page || 1;
    const limit = params.limit || 50;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    // Fusion `inagle_tactics` (70) + extras `inagle_special_tactics` (~10 wht* de scénario).
    // Volume total ~80 → on lit tout et on pagine en mémoire (pagination serveur non
    // combinable entre deux tables).
    const [tactics, specialRows] = await Promise.all([
      db.selectFrom("inagle_tactics").selectAll().execute(),
      db.selectFrom("inagle_special_tactics").selectAll().execute(),
    ]);
    const knownCodes = new Set(tactics.map(t => t.internal_code).filter(Boolean));
    const extras = specialRows.filter(
      s => s.internal_code && !knownCodes.has(s.internal_code) && !isPlaceholderSpecialTactic(s),
    );

    let merged: any[] = [
      ...tactics.map(t => ({
        itemId: t.internal_code || tacticSlug(t.name),
        internalCode: t.internal_code || "TACTIC",
        names: {
          en: t.name,
          fr: t.name_fr || TACTIC_FR[t.name] || t.name,
          ja: t.name_ja || t.name,
        },
        name_FR: t.name_fr || TACTIC_FR[t.name] || t.name,
        description: t.description_fr,
        description_JA: t.description_ja,
        category: "special_tactics",
        rarity: 3,
        image: resolveAssetUrl(t.image_url) || null,
        price: null,
        location: t.shop,
        stats: {
          effect1: t.effect1,
          effect2: t.effect2,
          effect3: t.effect3,
          duration: t.duration,
          cooldown: t.cooldown,
        },
        shops: t.shop ? [t.shop] : [],
      })),
      ...extras.map(s => specialTacticToListItem(s)),
    ];

    // Recherche texte en mémoire (parité avec l'ancien filtre serveur name/name_fr).
    if (params.q) {
      const q = params.q.toLowerCase();
      merged = merged.filter(it => {
        const en = String(it.names?.en || "").toLowerCase();
        const fr = String(it.name_FR || it.names?.fr || "").toLowerCase();
        return en.includes(q) || fr.includes(q);
      });
    }

    merged.sort((a, b) => String(a.names?.en || "").localeCompare(String(b.names?.en || "")));

    const total = merged.length;
    const pageItems = merged.slice(from, to + 1);

    return {
      data: pageItems as any,
      total,
      page,
      limit,
    };
  },

  async getTeam(_id: string): Promise<Team | undefined> {
    return undefined;
  },

  /** Merge BaseCharacters with same charaId or baseSlug into one entry with multiple variants */
  groupVariants(characters: BaseCharacter[]): BaseCharacter[] {
    const grouped = new Map<string, BaseCharacter>();
    for (const char of characters) {
      const key = char.baseSlug || char.charaId;
      const existing = grouped.get(key);
      if (existing) {
        existing.variants.push(...char.variants);
        existing.isBasara = existing.isBasara || char.isBasara;
        existing.constellation = existing.constellation || char.constellation;
        existing.wikiSections =
          existing.wikiSections && existing.wikiSections.length > 0 ? existing.wikiSections : char.wikiSections;
      } else {
        grouped.set(key, char);
      }
    }

    // Deduplicate and sort variants inside each character by age (youngest first).
    // Clé alignée sur getCharacterForms : poste + élément + rareté + heroType +
    // internalCode + series. Sans series/internalCode, Byron IE et Byron Ares
    // (même MF/Normal) se fusionnaient → comparateur / fiche affichaient la même
    // version pour les deux slugs.
    for (const char of grouped.values()) {
      const seenVariants = new Set<string>();
      const dedupedVariants: typeof char.variants = [];
      const variantKey = (v: (typeof char.variants)[number]) => {
        const vv = v as unknown as {
          internalCode?: string;
          series?: string;
          heroType?: string;
        };
        return `${v.position}|${v.element}|${v.rarity}|${vv.heroType || ""}|${vv.internalCode || ""}|${vv.series || ""}`;
      };
      for (const v of char.variants) {
        const vKey = variantKey(v);
        if (!seenVariants.has(vKey)) {
          seenVariants.add(vKey);
          dedupedVariants.push(v);
        } else {
          const idx = dedupedVariants.findIndex((x: any) => variantKey(x) === vKey);
          if (idx === -1) {
            continue;
          }
          const current = dedupedVariants[idx] as unknown as {
            sheetData?: unknown;
            skills?: unknown[];
          };
          const candidate = v as unknown as { sheetData?: unknown; skills?: unknown[] };
          const currentSkills = Array.isArray(current.skills) ? current.skills.length : 0;
          const candidateSkills = Array.isArray(candidate.skills) ? candidate.skills.length : 0;
          // Préférer la variante avec sheetData, sinon celle avec le plus de skills
          if ((!current.sheetData && candidate.sheetData) || candidateSkills > currentSkills) {
            dedupedVariants[idx] = v;
          }
        }
      }

      // Sort variants by age (youngest first: zukanOrder ASC, charaParamId ASC)
      dedupedVariants.sort((a: any, b: any) => {
        const orderA = a.zukanOrder !== undefined && a.zukanOrder !== null ? a.zukanOrder : 999999;
        const orderB = b.zukanOrder !== undefined && b.zukanOrder !== null ? b.zukanOrder : 999999;
        if (orderA !== orderB) return orderA - orderB;
        const idA = typeof a.charaParamId === "string" ? parseInt(a.charaParamId, 16) : 0;
        const idB = typeof b.charaParamId === "string" ? parseInt(b.charaParamId, 16) : 0;
        return idA - idB;
      });

      char.variants = dedupedVariants;

      // Update representative fields to represent the youngest variant (variants[0])
      const youngest = dedupedVariants[0];
      if (youngest) {
        char.bestRarity = youngest.rarity;
        char.bestRarityCode = youngest.rarityCode;
        char.image = youngest.image || char.image;
        char.zukanHash = youngest.zukanHash || char.zukanHash;
        char.slug = youngest.slug || char.slug;
        char.sheetData = youngest.sheetData || char.sheetData;
      }
    }

    return Array.from(grouped.values());
  },

  mapDbCharacterToBase(row: any): BaseCharacter | undefined {
    if (!row) return undefined;
    const char = row;

    // Stats: source de verite = colonnes scalaires stat_* (lv99).
    // La colonne jsonb `stats` est DEPRECATED (toujours vide, cf db-6) : plus de fallback.
    const statsLv99 = {
      kick: char.stat_frappe || 0,
      control: char.stat_controle || 0,
      technique: char.stat_technique || 0,
      pressure: char.stat_pression || 0,
      physical: char.stat_physique || 0,
      agility: char.stat_agilite || 0,
      intelligence: char.stat_intelligence || 0,
    };

    // Skills: fix reversed mapping (learnLevel=hex skillId, skillId=learnLevel)
    const rawSkills = Array.isArray(char.skills) ? char.skills : [];
    const skills = rawSkills.map((s: any) => {
      const learnLevelRaw = s.learnLevel;
      const skillIdRaw = s.skillId;
      // Detect reversed mapping: if skillId is a small number (< 100 decimal from hex)
      // and learnLevel is a large number, they're swapped
      const skillIdNum = typeof skillIdRaw === "string" ? parseInt(skillIdRaw, 16) : skillIdRaw;
      const learnNum = typeof learnLevelRaw === "number" ? learnLevelRaw : parseInt(learnLevelRaw, 10);
      if (skillIdNum < 1000 && Math.abs(learnNum) > 1000000) {
        // Swapped: learnLevel is actually the skill hash, skillId is the learn level
        const hexSkillId = `0x${(learnNum >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
        return { skillId: hexSkillId, learnLevel: skillIdNum };
      }
      return s;
    });

    // Resolve image URL
    const imageUrl = char.image_url ? resolveAssetUrl(char.image_url) : null;

    // Rarity: use rarity_label (authoritative) to derive numeric code
    const rarityLabelMap: Record<string, number> = {
      Normal: 0,
      "En progression": 1,
      Expérimenté: 2,
      Émérite: 3,
      Légendaire: 5,
      Héros: 10,
      BASARA: 20,
    };
    const rarityCode = rarityLabelMap[char.rarity_label] ?? 0;
    const zukanHash = char.zukan_hash || undefined;

    // For Héros with unique codes, use base character code for face icon fallback
    const originalCode = char.internal_code || char.id;
    const isHero = char.rarity_label === "Héros";
    const faceCode = isHero ? HERO_BASE_CODES[originalCode] || originalCode : originalCode;

    // Stats lv1: colonnes scalaires stat_lv1_* (la colonne jsonb `stats` est DEPRECATED, cf db-6).
    const hasLv1 = char.stat_lv1_frappe != null;
    const statsLv1 = hasLv1
      ? {
          kick: char.stat_lv1_frappe || 0,
          control: char.stat_lv1_controle || 0,
          technique: char.stat_lv1_technique || 0,
          pressure: char.stat_lv1_pression || 0,
          physical: char.stat_lv1_physique || 0,
          agility: char.stat_lv1_agilite || 0,
          intelligence: char.stat_lv1_intelligence || 0,
        }
      : undefined;

    // Paliers Lv30/Lv50 : la colonne jsonb `stats` est DEPRECATED (vide 0/6148, cf db-6).
    // On NE peuple PLUS de zéros (qui s'affichaient comme de fausses stats à 0) : on ne
    // retient ces paliers QUE si le jsonb porte une vraie valeur, sinon `undefined`.
    // Les VRAIS paliers Lv30/Lv50 sont calculés LIVE via lib/wiki/chara-stats.ts
    // (table de croissance gamedata) côté fiche perso (app/chara/[id]).
    const jsonStatsLv30 = (char.stats as any)?.lv30;
    const statsLv30 = jsonStatsLv30?.kick
      ? {
          kick: jsonStatsLv30.kick,
          control: jsonStatsLv30.control || 0,
          technique: jsonStatsLv30.technique || 0,
          pressure: jsonStatsLv30.pressure || 0,
          physical: jsonStatsLv30.physical || 0,
          agility: jsonStatsLv30.agility || 0,
          intelligence: jsonStatsLv30.intelligence || 0,
        }
      : undefined;

    const jsonStatsLv50 = (char.stats as any)?.lv50;
    const statsLv50 = jsonStatsLv50?.kick
      ? {
          kick: jsonStatsLv50.kick,
          control: jsonStatsLv50.control || 0,
          technique: jsonStatsLv50.technique || 0,
          pressure: jsonStatsLv50.pressure || 0,
          physical: jsonStatsLv50.physical || 0,
          agility: jsonStatsLv50.agility || 0,
          intelligence: jsonStatsLv50.intelligence || 0,
        }
      : undefined;

    const variant = {
      charaParamId: char.id,
      position: char.position || "MF",
      subPosition: undefined as string | undefined,
      positionRaw: 0,
      element: char.element || "Void",
      elementRaw: 0,
      rarity: char.rarity_label || "Normal",
      rarityCode,
      stats: { lv99: statsLv99, lv1: statsLv1, lv30: statsLv30, lv50: statsLv50 },
      skills: skills,
      image: imageUrl,
      sheetData: char.sheet_data,
      slug: char.slug,
      zukanHash,
      zukanOrder: char.zukan_order,
      // Nécessaire pour groupVariants : sans ça, IE / GO / Ares (même poste+rareté)
      // se collapsaient en une seule variante (internalCode toujours "").
      internalCode: originalCode,
      series: char.series || undefined,
      heroType: char.hero_type || undefined,
    };

    const isBasara = char.rarity_label === "BASARA";

    const base: BaseCharacter = {
      charaId: char.chara_id || char.internal_code || char.id,
      internalCode: faceCode,
      names: { fr: char.name_fr, en: char.name_en, ja: char.name_ja },
      // 0 = masculin, 1 = féminin, 2 = non-binaire (`gender = 'X'` en base).
      gender: char.gender === "F" ? 1 : char.gender === "X" ? 2 : 0,
      uniformNumber: (char as any).uniform_number ?? undefined,
      variants: [variant as any],
      bestRarity: char.rarity_label || "Normal",
      bestRarityCode: rarityCode,
      isBasara,
      image: imageUrl,
      descriptions: {
        fr: char.description_fr,
        en: char.description_en,
        ja: char.description_ja,
      },
      sheetData: char.sheet_data,
      wikiSections: (char as any).wiki_sections || [],
      slug: char.slug,
      baseSlug: char.base_slug,
      series: char.series || undefined,
      teamId: char.team_id,
      teamName: char.teams?.[0]?.names?.fr || char.teams?.[0]?.names?.en || "",
      zukanHash,
      nickname: char.nickname || undefined,
      ageGroup: char.age_group || undefined,
      schoolYear: char.school_year || undefined,
      // `gameAppearances` retiré : la colonne `game_appearances` est morte (vide 0/6148) →
      // elle n'injectait jamais rien d'utile (la section « Apparitions » reste donc masquée).
      controlType: char.control_type || undefined,
      isControllable: char.is_controllable || undefined,
      constellation: char.constellation
        ? {
            index: char.constellation_index ?? 0,
            names: { fr: char.constellation },
          }
        : undefined,
    } as any;

    return base;
  },

  /**
   * Galerie d'illustrations in-game (`inagle_gallery`, 360 lignes). Chaque entrée
   * porte un `img_path` qui résout vers une illustration live du dump dx11
   * (`menu/220_img/gallery_img2/`, couverture 360/360 vérifiée). Catégorisé par le
   * 2e token du `img_path` (`img_<cat>_…` → story / special / other / chronicle / kizuna).
   */
  async getGalleryList(params: {
    page?: number;
    limit?: number;
    q?: string;
    category?: string;
  }): Promise<ListResult<GalleryItem>> {
    const page = params.page || 1;
    const limit = params.limit || 48;
    const from = (page - 1) * limit;
    const db = createInagleSql<SqlDatabase>();
    let query = db.selectFrom("inagle_gallery");
    let countQuery = db.selectFrom("inagle_gallery");

    // Catégorie = préfixe `img_<category>_` du `img_path` (filtre serveur via LIKE).
    if (params.category && GALLERY_CATEGORIES.some(c => c.value === params.category)) {
      const pattern = `img_${sanitizeFilter(params.category)}_%`;
      query = query.where("img_path", "ilike", pattern);
      countQuery = countQuery.where("img_path", "ilike", pattern);
    }
    if (params.q) {
      const pattern = `%${sanitizeFilter(params.q)}%`;
      query = query.where("img_path", "ilike", pattern);
      countQuery = countQuery.where("img_path", "ilike", pattern);
    }

    try {
      const [data, countRow] = await Promise.all([
        query.selectAll().orderBy("flg_no", "asc").limit(limit).offset(from).execute(),
        countQuery.select(eb => eb.fn.countAll<number>().as("count")).executeTakeFirst(),
      ]);
      const results = data.map(row => galleryRowToItem(row));
      return { data: results, total: Number(countRow?.count ?? 0), page, limit };
    } catch (error) {
      console.error("Error fetching gallery:", error);
      return { data: [], total: 0, page, limit };
    }
  },

  /** Compte les illustrations par catégorie (pour les chips de filtre). */
  async getGalleryCategoryCounts(): Promise<Record<string, number>> {
    const db = createInagleSql<SqlDatabase>();
    const data = await db.selectFrom("inagle_gallery").select("img_path").execute();
    const counts: Record<string, number> = { all: 0 };
    for (const row of data) {
      counts.all += 1;
      const cat = galleryCategoryOf(row.img_path);
      counts[cat] = (counts[cat] || 0) + 1;
    }
    return counts;
  },

  async getTweets(limit: number = 20): Promise<any[]> {
    const db = createInagleSql<WikiSqlDatabase>();
    return db
      .selectFrom("tweets")
      .selectAll()
      .where("author_username", "=", "Azalee_IE")
      .where("is_thread", "=", true)
      .orderBy("created_at", "desc")
      .limit(limit)
      .execute();
  },

  async getTweetById(id: string): Promise<any | null> {
    const db = createInagleSql<WikiSqlDatabase>();
    return (
      (await db
        .selectFrom("tweets")
        .selectAll()
        .where("id", "=", id)
        .where("author_username", "=", "Azalee_IE")
        .executeTakeFirst()) ?? null
    );
  },

  // ── Passifs (projection SQL `inagle_passives`) ──

  /**
   * Liste paginée+filtrée des passifs joueur (1716 instances, textes FR/EN/JA résolus).
   * Les données sont lues depuis la projection SQL `inagle_passives`, alimentée par
   * l'import Inagle ; aucune sortie JSON n'est utilisée comme repli runtime.
   */
  async getPassivesList(params: PassiveListParams = {}): Promise<ListResult<PassiveListItem>> {
    const page = params.page || 1;
    const limit = params.limit || 60;
    const all = await loadPassiveRows();

    const qNorm = params.q ? normalizePassiveText(params.q) : "";
    let filtered = all.filter(p => {
      if (params.element && p.element_name !== params.element) return false;
      if (params.rarity && String(p.rarity) !== String(params.rarity)) return false;
      if (params.category && passiveCategory(p.string_id) !== params.category) return false;
      if (qNorm) {
        const hay = normalizePassiveText(`${p.name.fr ?? ""} ${p.name.en ?? ""} ${p.name.ja ?? ""} ${p.string_id}`);
        if (!hay.includes(qNorm)) return false;
      }
      return true;
    });

    // Tri (par défaut : texte FR alphabétique ; aussi value/string_id)
    const sort = params.sort || "name";
    filtered = [...filtered].sort((a, b) => {
      if (sort === "value") {
        return (b.main_value ?? 0) - (a.main_value ?? 0);
      }
      if (sort === "value_asc") {
        return (a.main_value ?? 0) - (b.main_value ?? 0);
      }
      if (sort === "id") {
        return a.string_id.localeCompare(b.string_id);
      }
      const ta = a.name.fr ?? a.name.en ?? a.name.ja ?? "";
      const tb = b.name.fr ?? b.name.en ?? b.name.ja ?? "";
      return ta.localeCompare(tb, "fr");
    });

    const total = filtered.length;
    const from = (page - 1) * limit;
    const data = filtered.slice(from, from + limit);
    return { data, limit, page, total };
  },

  /**
   * Détail d'un passif joueur par `passive_id` (hex) ou `string_id` (ex: ps10001_03).
   * Renvoie l'instance ciblée + toutes les instances de la même famille (effect_id) pour
   * la courbe d'effets par valeur. Repli `inagle_passives` (miroir) pour `image_url`.
   */
  async getPassive(id: string): Promise<PassiveDetail | undefined> {
    const instances = await loadPassiveRows();
    const inst = instances.find(p => p.passive_id === id || p.string_id === id);
    if (!inst) return undefined;

    // Toutes les instances partageant le même effet (courbe de valeurs).
    const family = instances
      .filter(p => p.effect_id === inst.effect_id)
      .sort((a, b) => (a.main_value ?? 0) - (b.main_value ?? 0));

    let imageUrl: string | null = null;
    try {
      const db = createInagleSql<SqlDatabase>();
      const row = await db
        .selectFrom("inagle_passives")
        .select("image_url")
        .where("id", "=", inst.passive_id)
        .executeTakeFirst();
      if (row?.image_url) {
        imageUrl = resolveAssetUrl(row.image_url);
      }
    } catch {
      // keep null
    }

    return {
      ...inst,
      category: passiveCategory(inst.string_id),
      family,
      imageUrl,
    };
  },

  /** Les 21 passifs d'équipe (soccer_team_passive_config). */
  async getTeamPassives(): Promise<PassiveTeamItem[]> {
    try {
      const db = createInagleSql<WikiSqlDatabase>();
      const data = await db.selectFrom("inagle_manager_passives").selectAll().execute();
      return data.map(row => {
        const raw: any = row.data && typeof row.data === "object" ? row.data : row;
        return {
          team_passive_id: String(raw.team_passive_id ?? raw.id ?? row.id),
          effect_id: String(raw.effect_id ?? raw.effectId ?? ""),
          value_min: Number(raw.value_min ?? raw.valueMin ?? 0),
          value_max: Number(raw.value_max ?? raw.valueMax ?? 0),
          text_id: String(raw.text_id ?? raw.textId ?? ""),
          text: raw.text ?? {
            fr: row.text_fr ?? null,
            en: row.text_en ?? null,
            ja: row.text_ja ?? null,
          },
        };
      });
    } catch {
      return [];
    }
  },

  /** Passive sheets historiques normalisées dans la projection SQL canonique. */
  async getPassiveSheets(): Promise<PassiveSheets> {
    try {
      const db = createInagleSql<SqlDatabase>();
      const data = await db
        .selectFrom("inagle_passive_sheets")
        .select(["kind", "data"])
        .orderBy("kind", "asc")
        .execute();
      const result: PassiveSheets = {
        playerPassives: [],
        customPassives: [],
        coordinatorPassives: [],
      };
      for (const row of data as Array<{ kind?: string; data?: unknown }>) {
        if (row.kind === "player") result.playerPassives.push(row.data as PlayerPassiveSheet);
        if (row.kind === "custom") result.customPassives.push(row.data as CustomPassiveSheet);
        if (row.kind === "coordinator") result.coordinatorPassives.push(row.data as CoordinatorPassiveSheet);
      }
      return result;
    } catch {
      return { playerPassives: [], customPassives: [], coordinatorPassives: [] };
    }
  },

  /** Une famille de passifs par effect_id (toutes les valeurs partageant l'effet). */
  async getPassiveFamily(effectId: string): Promise<PassiveListItem[]> {
    return (await loadPassiveRows())
      .filter(p => p.effect_id === effectId)
      .sort((a, b) => (a.main_value ?? 0) - (b.main_value ?? 0));
  },
};

// ── Passifs : projection SQL `inagle_passives` ──

export interface PassiveListItem {
  passive_id: string;
  string_id: string;
  effect_id: string;
  rarity: number;
  element: number;
  element_name: string;
  buff_icon_type: number | null;
  effect_params: number[];
  main_value: number | null;
  name: { fr: string | null; en: string | null; ja: string | null };
  description: { fr: string | null; en: string | null; ja: string | null };
  text_raw: { fr: string | null; en: string | null; ja: string | null };
}

export interface PassiveTeamItem {
  team_passive_id: string;
  effect_id: string;
  value_min: number;
  value_max: number;
  text_id: string;
  text: { fr: string | null; en: string | null; ja: string | null };
}

export interface PlayerPassiveSheet {
  no: number;
  playstyle: string;
  requirement: string;
  stat: string;
  legendary: { low: string; high: string };
  top: { low: string; high: string };
  advanced: { low: string; high: string };
  growing: { low: string; high: string };
  common: { low: string; high: string };
}

export interface CustomPassiveSheet {
  no: number;
  requirement: string;
  stat: string;
  buff: string;
}

export interface CoordinatorPassiveSheet {
  no: number;
  playstyle: string;
  requirement: string;
  stat: string;
  coordinatorCommon: string;
  coordinatorLegendary: string;
  managerCommon: string;
  managerLegendary: string;
}

export interface PassiveSheets {
  playerPassives: PlayerPassiveSheet[];
  customPassives: CustomPassiveSheet[];
  coordinatorPassives: CoordinatorPassiveSheet[];
}

export interface PassiveDetail extends PassiveListItem {
  category: string;
  family: PassiveListItem[];
  imageUrl: string | null;
}

export interface PassiveListParams {
  page?: number;
  limit?: number;
  q?: string;
  element?: string;
  rarity?: string;
  category?: string;
  sort?: string;
}

let passiveCache: Promise<PassiveListItem[]> | null = null;

function passiveRowToItem(row: any): PassiveListItem {
  const raw = row.data && typeof row.data === "object" ? row.data : {};
  const names = raw.name ?? {
    fr: row.name_fr ?? null,
    en: row.name_en ?? null,
    ja: row.name_ja ?? null,
  };
  const descriptions = raw.description ?? {
    fr: row.description_fr ?? null,
    en: row.description_en ?? null,
    ja: row.description_ja ?? null,
  };
  return {
    passive_id: String(raw.passiveIdStr ?? raw.passive_id ?? row.id),
    string_id: String(raw.stringId ?? raw.string_id ?? raw.passiveIdStr ?? row.id),
    effect_id: String(raw.effectId ?? raw.effect_id ?? row.effect_id ?? ""),
    rarity: Number(raw.rarity ?? row.rarity ?? 0),
    element: Number(raw.element ?? row.element ?? 0),
    element_name: String(raw.element_name ?? raw.elementName ?? ""),
    buff_icon_type: raw.buff_icon_type ?? raw.buffIconType ?? null,
    effect_params: Array.isArray(raw.effect_params)
      ? raw.effect_params
      : Array.isArray(raw.effectParams)
        ? raw.effectParams
        : [],
    main_value: raw.main_value ?? raw.mainValue ?? null,
    name: names,
    description: descriptions,
    text_raw: raw.text_raw ?? raw.textRaw ?? descriptions,
  };
}

async function loadPassiveRows(): Promise<PassiveListItem[]> {
  if (!passiveCache) {
    passiveCache = (async () => {
      try {
        const db = createInagleSql<SqlDatabase>();
        const data = await db.selectFrom("inagle_passives").selectAll().execute();
        return data.map(passiveRowToItem);
      } catch {
        return [];
      }
    })();
  }
  return passiveCache;
}

/** Catégorie d'un passif déduite du préfixe de son string_id (ps/mps/cps/hps/ss/…). */
export function passiveCategory(stringId: string): string {
  if (stringId.startsWith("bmps")) return "team_mixi";
  if (stringId.startsWith("bcps")) return "team_custom";
  if (stringId.startsWith("mps")) return "miximax";
  if (stringId.startsWith("cps")) return "custom";
  if (stringId.startsWith("hps")) return "hero";
  if (stringId.startsWith("ss_ps") || stringId.startsWith("ss")) return "soul";
  if (stringId.startsWith("swap")) return "swap";
  if (stringId.startsWith("ps")) return "player";
  return "other";
}

/** Normalisation de recherche (minuscule, sans accents) — local pour éviter un cycle d'import. */
function normalizePassiveText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}
