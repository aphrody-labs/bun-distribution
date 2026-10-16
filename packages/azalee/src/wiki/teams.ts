/**
 * Accès données SECTION ÉQUIPES (`/equipe`).
 *
 * Lit les projections PostgreSQL `inagle_*` via le client SQL canonique.
 * Le miroir SQLite n'est utilisé qu'en mode offline.
 *
 * Tables sources (vérité terrain miroir) :
 *   - `inagle_teams`    (208) : nom multi-langue, emblèmes (CRC/série), kits (CRC/série),
 *                               emblem_url (icône résolue), data.seasons (apparitions jeux),
 *                               data.binderTeamOrderType (ordre naturel d'affichage).
 *   - `inagle_uniforms` (384) : keyés par `name_id` (= CRC référencé dans team.kits).
 *                               `models` = liste {typeId 0=domicile / 1=extérieur}
 *                               avec les CRC modèle joueur/gardien.
 *   - `inagle_emblems`  (2)   : table template (default + em010001), pas un index complet.
 *
 * Roster : `inagle_characters.team_id` pointe vers `inagle_teams.id`. Les personnages
 * sont dédupliqués par `chara_id` (la table contient plusieurs lignes par perso).
 *
 * AUCUNE donnée inventée : tout dérive des colonnes réelles ci-dessus.
 */

import { createInagleSql } from "@rosegriffon/db/inagle-sql";
import { createClient, hasDatabaseProvider } from "../db/provider";
import { TEAM_EMBLEM_MAP } from "../game/team-emblem-map";
import { getCharacterFaceUrl, getEmblemImageUrl, resolveLegacyMenuAsset } from "../images";
import {
  SERIES_LABELS,
  type TeamDetail,
  type TeamEmblem,
  type TeamKit,
  type TeamKitModel,
  type TeamListItem,
  type TeamRosterMember,
} from "./teams-shared";

// Ré-export des types + constantes depuis le module client-safe (compat imports existants).
export {
  SEASON_LABELS,
  SERIES_LABELS,
  type TeamDetail,
  type TeamEmblem,
  type TeamKit,
  type TeamKitModel,
  type TeamListItem,
  type TeamRosterMember,
} from "./teams-shared";

interface RawTeamRow {
  id: string;
  name_fr: string | null;
  name_en: string | null;
  name_ja: string | null;
  emblem_url: string | null;
  emblems: string | null;
  kits: string | null;
  data: string | null;
  description_fr?: string | null;
  description_en?: string | null;
}

interface RawUniformRow {
  name_id: string;
  models: string | null;
  data?: string | null;
}

interface RawCharaRow {
  chara_id: string;
  name_fr: string | null;
  name_ja: string | null;
  base_slug: string | null;
  slug: string | null;
  internal_code: string | null;
  position: string | null;
  element: string | null;
  rarity: string | null;
}

interface TeamsDatabase {
  inagle_teams: RawTeamRow;
  inagle_uniforms: RawUniformRow;
  inagle_characters: RawCharaRow & { team_id: string | null };
}

const sql = createInagleSql<TeamsDatabase>();

/**
 * Le provider reste un point d'injection de santé pour les hôtes historiques.
 * Les données durables sont toujours lues par Kysely ; l'appel préalable
 * permet toutefois au mode local de détecter immédiatement un client injecté
 * hors ligne et d'activer son repli HTTP.
 */
async function verifyInjectedProvider(): Promise<void> {
  if (hasDatabaseProvider()) await createClient();
}

/** Parse JSON-or-object en sécurité (les colonnes TEXT peuvent déjà être désérialisées). */
function parseJson<T>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value === "object") return value as T;
  if (typeof value !== "string" || value === "") return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function teamSeasons(dataRaw: string | null): Record<string, number> {
  const data = parseJson<{ seasons?: Record<string, number> }>(dataRaw);
  return data?.seasons ?? {};
}

function teamOrder(dataRaw: string | null): number {
  const data = parseJson<{ binderTeamOrderType?: number }>(dataRaw);
  const v = data?.binderTeamOrderType;
  return typeof v === "number" ? v : 9999;
}

function resolveTeamEmblem(row: RawTeamRow): string | null {
  // 1) Vrai emblème : l'identifiant d'équipe → `emNNNNNN` (manifeste extrait des
  // CPK) → URL CDN servie. C'est la seule correspondance réelle connue.
  const emblemCode = TEAM_EMBLEM_MAP[row.id];
  if (emblemCode) {
    const url = getEmblemImageUrl(emblemCode);
    if (url) return url;
  }
  // 2) `emblem_url` en base : chemin legacy du bucket `menu` disparu
  // (`…/01_icon_emblem/0x<CRC>.webp`, CRC de l'équipe et non d'un fichier). On ne
  // le renvoie que s'il se résout vers un vrai fichier ; sinon `null` → l'UI
  // affiche son repli au lieu d'une image en 404.
  return resolveLegacyMenuAsset(row.emblem_url);
}

/**
 * Liste complète des équipes triée par ordre naturel du jeu (binder order).
 * 208 lignes — chargées d'un coup, filtrage/recherche côté client.
 */
export async function getTeamsList(): Promise<TeamListItem[]> {
  await verifyInjectedProvider();
  const rows = await sql
    .selectFrom("inagle_teams")
    .select(["id", "name_fr", "name_en", "name_ja", "emblem_url", "emblems", "kits", "data"])
    .execute();

  // Compte roster (personnages distincts) par team_id en une passe.
  const charaRaw = await sql
    .selectFrom("inagle_characters")
    .select(["chara_id", "team_id"])
    .execute();
  const rosterByTeam = new Map<string, Set<string>>();
  for (const c of charaRaw) {
    if (!c.team_id) continue;
    let set = rosterByTeam.get(c.team_id);
    if (!set) {
      set = new Set();
      rosterByTeam.set(c.team_id, set);
    }
    if (c.chara_id) set.add(c.chara_id);
  }

  const list: TeamListItem[] = rows.map((row) => {
    const kits = parseJson<Record<string, string>>(row.kits) ?? {};
    return {
      id: row.id,
      name: row.name_fr || row.name_en || row.name_ja || row.id,
      nameJa: row.name_ja || null,
      nameEn: row.name_en || null,
      emblemUrl: resolveTeamEmblem(row),
      seasons: teamSeasons(row.data),
      seriesKeys: Object.keys(kits),
      rosterCount: rosterByTeam.get(row.id)?.size ?? 0,
      order: teamOrder(row.data),
    };
  });

  list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "fr"));
  return list;
}

function mapUniformModels(modelsRaw: string | null): TeamKitModel[] {
  const models = parseJson<
    Array<{
      typeId?: number;
      uniformFielderModelIdCrc?: string;
      uniformKeeperModelIdCrc?: string;
      shoesFielderModelIdCrc?: string;
      gloveModelIdCrc?: string;
    }>
  >(modelsRaw);
  if (!Array.isArray(models)) return [];
  return models.map((m) => ({
    typeId: typeof m.typeId === "number" ? m.typeId : 0,
    uniformFielderModelIdCrc: m.uniformFielderModelIdCrc ?? "0x00000000",
    uniformKeeperModelIdCrc: m.uniformKeeperModelIdCrc ?? "0x00000000",
    shoesFielderModelIdCrc: m.shoesFielderModelIdCrc ?? "0x00000000",
    gloveModelIdCrc: m.gloveModelIdCrc ?? "0x00000000",
  }));
}

/** Détail d'une équipe : emblèmes, kits (uniformes résolus), roster lié. */
export async function getTeamDetail(id: string): Promise<TeamDetail | null> {
  await verifyInjectedProvider();
  const row = await sql
    .selectFrom("inagle_teams")
    .select([
      "id",
      "name_fr",
      "name_en",
      "name_ja",
      "emblem_url",
      "emblems",
      "kits",
      "data",
      "description_fr",
      "description_en",
    ])
    .where("id", "=", id)
    .executeTakeFirst();

  if (!row) return null;
  const team = row;

  const emblemsObj = parseJson<Record<string, string>>(team.emblems) ?? {};
  const emblems: TeamEmblem[] = Object.entries(emblemsObj).map(([series, crc]) => ({
    series,
    seriesLabel: SERIES_LABELS[series] ?? series,
    crc,
  }));

  const kitsObj = parseJson<Record<string, string>>(team.kits) ?? {};
  const kitNameIds = Object.values(kitsObj).filter(Boolean);

  // Résout les uniformes référencés par les CRC de kit.
  const uniformsById = new Map<string, RawUniformRow>();
  if (kitNameIds.length > 0) {
    const uniformsRaw = await sql
      .selectFrom("inagle_uniforms")
      .select(["name_id", "models"])
      .where("name_id", "in", kitNameIds)
      .execute();
    for (const u of uniformsRaw) {
      uniformsById.set(u.name_id, u);
    }
  }

  const kits: TeamKit[] = Object.entries(kitsObj)
    .filter(([, nameId]) => Boolean(nameId))
    .map(([series, nameId]) => ({
      series,
      seriesLabel: SERIES_LABELS[series] ?? series,
      nameId,
      models: mapUniformModels(uniformsById.get(nameId)?.models ?? null),
    }));

  // Roster : personnages liés (dédup par chara_id, image via internal_code).
  const charaRaw = await sql
    .selectFrom("inagle_characters")
    .select([
      "chara_id",
      "name_fr",
      "name_ja",
      "base_slug",
      "slug",
      "internal_code",
      "position",
      "element",
      "rarity",
    ])
    .where("team_id", "=", id)
    .execute();

  const seen = new Set<string>();
  const roster: TeamRosterMember[] = [];
  for (const c of charaRaw) {
    if (!c.chara_id || seen.has(c.chara_id)) continue;
    seen.add(c.chara_id);
    roster.push({
      charaId: c.chara_id,
      name: c.name_fr || c.name_ja || c.chara_id,
      nameJa: c.name_ja || null,
      slug: c.base_slug || c.slug || null,
      position: c.position || null,
      element: c.element || null,
      rarity: c.rarity || null,
      imageUrl: getCharacterFaceUrl(c.internal_code || c.chara_id),
    });
  }
  roster.sort((a, b) => a.name.localeCompare(b.name, "fr"));

  return {
    id: team.id,
    name: team.name_fr || team.name_en || team.name_ja || team.id,
    nameEn: team.name_en || null,
    nameJa: team.name_ja || null,
    descriptionFr: team.description_fr || null,
    descriptionEn: team.description_en || null,
    emblemUrl: resolveTeamEmblem(team),
    emblems,
    kits,
    seasons: teamSeasons(team.data),
    roster,
  };
}

/** IDs de toutes les équipes (pour `generateStaticParams`). */
export async function getAllTeamIds(): Promise<string[]> {
  await verifyInjectedProvider();
  const rows = await sql.selectFrom("inagle_teams").select("id").execute();
  return rows.map((r) => r.id).filter(Boolean);
}
