import { createImageAPI } from "./core/index.js";
import type { BaseCharacter, CharacterVariant } from "./core/types.js";
import { createGlobalSearch } from "./search/index.js";
import { loadVfsServiceData } from "./core/vfs-service.js";
import { configureGameVfs } from "./core/vfs-data.js";
import type { loadInagleServiceData } from "./sql/service-data.js";
import {
  configuredDataSource,
  localMirrorPath,
  selectDataSource,
  type InagleDataSourceOption,
} from "./core/data-source.js";

// Re-export types for use in components
export type { BaseCharacter, CharacterVariant };

export interface InagleServiceConfig {
  gameDir?: string;
  dataSource?: InagleDataSourceOption;
  baseUrl?: string;
  useRawPaths?: boolean;
}

export async function createInagleService(config?: InagleServiceConfig) {
  if (config?.gameDir) configureGameVfs(config.gameDir);
  const requested = config?.dataSource ?? configuredDataSource();
  const mirror = requested === "vfs" || requested === "postgres" ? undefined : localMirrorPath();
  const source = selectDataSource({
    explicit: requested,
    sqliteAvailable: !!mirror,
    postgresDisabled: process.env.IEVR_CFGBIN_POSTGRES === "0",
  });
  process.env.INAGLE_DATA_SOURCE = source;
  process.env.NIE_DATA_SOURCE = source;
  const sqlData =
    source === "postgres"
      ? await (await import("./sql/service-data.js")).loadInagleServiceData()
      : source === "sqlite"
        ? await (
            await import("./sql/service-data.js")
          ).loadSqliteServiceData(
            mirror ??
              (() => {
                throw new Error("An existing Inagle SQLite mirror is required");
              })(),
          )
        : await loadVfsServiceData();
  if (!sqlData) throw new Error("The selected game data source returned no service data.");

  const basara = createSqlBasaraAPI(sqlData.basara);
  const characters = createSqlCharactersAPI(sqlData.characters);
  const items = createSqlItemsAPI(sqlData.items, sqlData.capsules, sqlData.gallery);
  const skills = createSqlSkillsAPI(sqlData.skills, sqlData.passives, [
    ...sqlData.auras,
    ...(sqlData.keshins ?? []),
    ...(sqlData.souls ?? []),
    ...(sqlData.miximax ?? []),
    ...(sqlData.awakenings ?? []),
    ...(sqlData.modeChanges ?? []),
  ]);
  const teams = createSqlTeamsAPI(
    sqlData.teams,
    sqlData.formations,
    sqlData.uniforms,
    (sqlData as any).series ?? [],
  );
  const drops =
    source === "vfs"
      ? createNativeDropsAPI((sqlData.drops as any).native)
      : createSqlDropsAPI(sqlData.drops);
  const quests = createSqlQuestsAPI(sqlData.quests);

  const images = createImageAPI({
    baseUrl: config?.baseUrl || process.env.NEXT_PUBLIC_ASSET_URL,
    useRawPaths: config?.useRawPaths ?? process.env.NEXT_PUBLIC_USE_RAW_IMAGE_PATHS === "true",
  });

  const search = createGlobalSearch({
    basara: basara.all(),
    skills: skills.all(),
    auras: skills.auraAll(),
    passives: skills.passiveAll(),
    characters: characters.all(),
    items: items.allItems(),
  });

  return {
    source,
    basara,
    characters,
    drops,
    images,
    items,
    quests,
    search,
    skills,
    teams,
  };
}

type SqlData = NonNullable<Awaited<ReturnType<typeof loadInagleServiceData>>>;

type SqlCharacter = Record<string, any>;
type SqlSkill = Record<string, any>;

function createSqlBasaraAPI(rows: SqlData["basara"]): any {
  const all: Record<string, any>[] = rows.map((row, index) => {
    const element =
      ({ Wind: 1, Forest: 2, Fire: 3, Mountain: 4 } as Record<string, number>)[row.element ?? ""] ??
      1;
    const position =
      ({ GK: 1, FW: 2, MF: 3, DF: 4 } as Record<string, number>)[row.position ?? ""] ?? 1;
    const stats = {
      kick: row.kick ?? 0,
      control: row.control ?? 0,
      technique: row.technique ?? 0,
      pressure: row.pressure ?? 0,
      physical: row.physical ?? 0,
      agility: row.agility ?? 0,
      intelligence: row.intelligence ?? 0,
    };
    return {
      index: index + 1,
      charaParamId: row.character_id,
      charaId: row.character_id,
      internalCode: row.character_id,
      names: {
        fr: row.name_localised ?? undefined,
        en: row.name_romaji ?? undefined,
        ja: undefined,
      },
      position: row.position ?? "",
      positionRaw: position,
      element: row.element ?? "",
      elementRaw: element,
      rarity: "BASARA",
      rarityCode: 20,
      gender: row.gender ?? "",
      growthPattern: 0,
      builds: (row as any).builds ?? [],
      skills: [],
      heroVariants: { hasFire: false, hasBlack: false, hasPink: false },
      stats: { lv99: stats },
      displayName: row.name_localised ?? row.name_romaji ?? row.character_id,
      elementName: {},
      positionName: {},
      totalStatsLv99: Object.values(stats).reduce((sum, value) => sum + value, 0),
      heroVariantCount: 0,
    };
  });
  const byParam = new Map(all.map((row) => [row.charaParamId, row]));
  const byChar = new Map(all.map((row) => [row.charaId, row]));
  const byCode = new Map(all.map((row) => [row.internalCode, row]));
  const byElement = (element: number) => all.filter((row) => row.elementRaw === element);
  const byPosition = (position: number) => all.filter((row) => row.positionRaw === position);
  return {
    meta: {
      generatedAt: new Date().toISOString(),
      totalCount: all.length,
      buildsPerCharacter: 6,
      totalBuilds: all.length * 6,
    },
    all: () => all,
    get: (id: string) => byParam.get(id),
    getByCharaId: (id: string) => byChar.get(id),
    getByCode: (id: string) => byCode.get(id),
    byElement,
    byPosition,
    search: (query: string, options?: { limit?: number }) =>
      all
        .filter((row) =>
          Object.values(row.names).some((name) =>
            String(name ?? "")
              .toLowerCase()
              .includes(query.toLowerCase()),
          ),
        )
        .slice(0, options?.limit ?? 20),
    goalkeepers: () => byPosition(1),
    forwards: () => byPosition(2),
    midfielders: () => byPosition(3),
    defenders: () => byPosition(4),
    fire: () => byElement(3),
    wood: () => byElement(2),
    wind: () => byElement(1),
    mountain: () => byElement(4),
    withHeroVariants: () => [],
    topByStats: (limit = 10) =>
      [...all].sort((a, b) => b.totalStatsLv99 - a.totalStatsLv99).slice(0, limit),
    topByStat: (stat: string, limit = 10) =>
      [...all].sort((a, b) => b.stats.lv99[stat] - a.stats.lv99[stat]).slice(0, limit),
    withVariant: () => [],
    elements: {},
    positions: {},
  } as any;
}

/** SQL read model adapter. It deliberately exposes the historical API shape
 * so callers can migrate without reintroducing filesystem JSON reads. */
function createSqlCharactersAPI(rows: SqlData["characters"]): any {
  const characters: SqlCharacter[] = rows.map((row) => ({
    ...(row.data && typeof row.data === "object" && !Array.isArray(row.data) ? row.data : {}),
    charaId: row.chara_id ?? row.id,
    charaParamId: row.id,
    internalCode: row.internal_code ?? undefined,
    name_FR: row.name_fr ?? undefined,
    name_EN: row.name_en ?? undefined,
    name_JA: row.name_ja ?? undefined,
    names: {
      fr: row.name_fr ?? undefined,
      en: row.name_en ?? undefined,
      ja: row.name_ja ?? undefined,
    },
    rarityCode: row.rarity_code ?? 0,
    position: row.position ?? "",
    elementRaw: row.element_id ?? 0,
    series: row.series ?? undefined,
    icons: row.image_url ? { face: row.image_url } : undefined,
  }));
  const by = (key: string) => new Map(characters.map((row) => [row[key], row]));
  const byId = by("charaId"),
    byParam = by("charaParamId"),
    byCode = by("internalCode");
  const search = (query: string, options?: { lang?: "fr" | "en" | "ja"; limit?: number }) => {
    const q = query.toLowerCase();
    return characters
      .filter((row) =>
        ["fr", "en", "ja"].some(
          (lang) =>
            (!options?.lang || options.lang === lang) &&
            String(row.names?.[lang] ?? "")
              .toLowerCase()
              .includes(q),
        ),
      )
      .slice(0, options?.limit ?? 50);
  };
  return {
    meta: {
      generatedAt: new Date().toISOString(),
      totalCharacters: characters.length,
      stats: { withNameFR: characters.filter((row) => row.name_FR).length },
    },
    all: () => characters,
    baseCharacters: () => characters,
    getBaseCharacter: (id: string) => byId.get(id),
    get: (id: string) => byId.get(id),
    getByParamId: (id: string) => byParam.get(id),
    getByCode: (id: string) => byCode.get(id),
    search,
    byPosition: (position: string) => characters.filter((row) => row.position === position),
    byElement: (element: number | string) =>
      characters.filter(
        (row) =>
          row.elementRaw ===
          (typeof element === "number"
            ? element
            : (({ Wind: 1, Forest: 2, Fire: 3, Mountain: 4 } as Record<string, number>)[element] ??
              0)),
      ),
    bySeries: (series: string) =>
      characters.filter((row) => String(row.series ?? "").toLowerCase() === series.toLowerCase()),
    byRarity: (rarity: number) => characters.filter((row) => row.rarityCode === rarity),
    byPersonality: () => [],
    goalkeepers: () => characters.filter((row) => row.position === "GK"),
    forwards: () => characters.filter((row) => row.position === "FW"),
    midfielders: () => characters.filter((row) => row.position === "MF"),
    defenders: () => characters.filter((row) => row.position === "DF"),
    windCharacters: () => characters.filter((row) => row.elementRaw === 1),
    forestCharacters: () => characters.filter((row) => row.elementRaw === 2),
    fireCharacters: () => characters.filter((row) => row.elementRaw === 3),
    mountainCharacters: () => characters.filter((row) => row.elementRaw === 4),
    gentle: () => [],
    cool: () => [],
    hot: () => [],
    withRarity: () => characters.filter((row) => row.rarityCode > 0),
    rarityNames: {},
    personalityNames: {},
  } as any;
}

function createSqlSkillsAPI(
  skillRows: SqlData["skills"],
  passiveRows: SqlData["passives"],
  auraRows: Record<string, unknown>[] = [],
): any {
  const skills: SqlSkill[] = skillRows.map((row) => ({
    ...(row.data && typeof row.data === "object" && !Array.isArray(row.data) ? row.data : {}),
    id: row.id,
    internalCode: row.internal_code ?? undefined,
    name_FR: row.name_fr ?? undefined,
    name_EN: row.name_en ?? undefined,
    name_JA: row.name_ja ?? undefined,
    category: row.category_id ?? 0,
    element: row.element_id ?? 0,
    power_min: row.power_min ?? 0,
    power_max: row.power_max ?? 0,
    partnerCount: row.partner_count ?? 0,
    hasPartner: (row.partner_count ?? 0) > 0,
  }));
  const passives: SqlSkill[] = passiveRows.map((row) => ({
    ...(row.data && typeof row.data === "object" && !Array.isArray(row.data) ? row.data : {}),
    passiveId: row.id,
    passiveIdStr: row.id,
    name_FR: row.name_fr ?? undefined,
    name_EN: row.name_en ?? undefined,
    name_JA: row.name_ja ?? undefined,
  }));
  const auras: SqlSkill[] = auraRows.map((row) => {
    const data =
      row.data && typeof row.data === "object" && !Array.isArray(row.data)
        ? (row.data as Record<string, unknown>)
        : {};
    return {
      ...data,
      id: row.id,
      auraId: row.id,
      auraIdStr: row.id,
      name_FR: row.name_fr ?? data.name_FR,
      name_EN: row.name_en ?? data.name_EN,
      name_JA: row.name_ja ?? data.name_JA,
      element: row.element_id ?? data.element ?? 0,
      type: row.sub_type ?? data.type,
    };
  });
  const byId = new Map(skills.map((row) => [row.id, row]));
  const search = (query: string, options?: { lang?: "en" | "ja" | "fr"; limit?: number }) =>
    skills
      .filter((row) =>
        [row.name_EN, row.name_JA, row.name_FR].some((name) =>
          String(name ?? "")
            .toLowerCase()
            .includes(query.toLowerCase()),
        ),
      )
      .slice(0, options?.limit ?? 50);
  return {
    meta: {
      generatedAt: new Date().toISOString(),
      totalSkills: skills.length,
      totalAura: auras.length,
      totalPassive: passives.length,
      stats: {},
    },
    all: () => skills,
    moves: () => skills,
    get: (id: string) => byId.get(id),
    search,
    byElement: (element: number | string) => skills.filter((row) => row.element === element),
    byCategory: (category: number | string) => skills.filter((row) => row.category === category),
    shoots: () => skills.filter((row) => row.category === 1),
    dribbles: () => skills.filter((row) => row.category === 3),
    blocks: () => skills.filter((row) => row.category === 2),
    catches: () => skills.filter((row) => row.category === 4),
    specials: () => skills.filter((row) => row.category === 5),
    talents: () => skills.filter((row) => row.category === 6),
    fire: () => skills.filter((row) => row.element === 1),
    forest: () => skills.filter((row) => row.element === 2),
    wind: () => skills.filter((row) => row.element === 3),
    mountain: () => skills.filter((row) => row.element === 4),
    strongest: (limit = 20) =>
      [...skills].sort((a, b) => b.power_max - a.power_max).slice(0, limit),
    partnerSkills: () => skills.filter((row) => row.hasPartner),
    oldorado: () => [],
    auraAll: () => auras,
    auraGet: (id: string) => auras.find((row) => row.auraId === id || row.id === id),
    auraByElement: (element: number | string) => auras.filter((row) => row.element === element),
    auraSearch: (query: string) =>
      auras.filter((row) =>
        [row.name_FR, row.name_EN, row.name_JA].some((name) =>
          String(name ?? "")
            .toLowerCase()
            .includes(query.toLowerCase()),
        ),
      ),
    auraByType: (type: string) => auras.filter((row) => row.type === type),
    keshins: () => auras.filter((row) => row.type === "Keshin"),
    souls: () => auras.filter((row) => row.type === "Soul"),
    awakenings: () => auras.filter((row) => row.type === "Awakening"),
    modeChanges: () => auras.filter((row) => row.type === "ModeChange"),
    passiveAll: () => passives,
    passiveGet: (id: string) => passives.find((row) => row.passiveId === id),
    passiveByRarity: () => [],
    passiveByEffect: () => [],
    passiveTeam: () => [],
    passivePlayer: () => [],
    passiveEnemy: () => [],
    passiveByScope: () => [],
    passiveBreach: () => [],
    passiveJustice: () => [],
    passiveConfrontation: () => [],
    passiveAttack: () => [],
    passiveDefense: () => [],
    passiveShoot: () => [],
    passiveDribble: () => [],
    passiveBlock: () => [],
    passiveCatch: () => [],
    passiveSpeed: () => [],
    passiveStamina: () => [],
    passiveTension: () => [],
    passiveMixed: () => [],
    passiveSpecial: () => [],
    passiveByBoostType: () => [],
    passiveSearch: (query: string) =>
      passives.filter((row) =>
        String(row.name_FR ?? row.name_EN ?? "")
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    teamPassives: () => [],
    getTeamPassive: () => undefined,
    elements: {},
    categories: {},
    passiveScopes: {},
    passiveBoostTypes: {},
    raw: undefined,
  } as any;
}

function createSqlItemsAPI(
  rows: SqlData["items"],
  capsules: SqlData["capsules"],
  gallery: SqlData["gallery"],
): any {
  const byId = new Map(rows.map((item) => [item.itemId, item]));
  const searchItems = (query: string, options?: { lang?: "en" | "ja" | "fr"; limit?: number }) => {
    const q = query.toLowerCase();
    const lang = options?.lang;
    return rows
      .filter((item) => {
        const names = item.names as Record<string, string | undefined>;
        return (
          ((!lang || lang === "en") && names.en?.toLowerCase().includes(q)) ||
          ((!lang || lang === "fr") && names.fr?.toLowerCase().includes(q)) ||
          ((!lang || lang === "ja") && names.ja?.includes(query))
        );
      })
      .slice(0, options?.limit ?? 50);
  };
  return {
    meta: {
      generatedAt: new Date().toISOString(),
      stats: {
        totalItems: rows.length,
        totalCapsules: capsules.length,
        totalGallery: gallery.length,
        byCategory: {},
        byRarity: {},
      },
    },
    allItems: () => rows,
    getItem: (id: string) => byId.get(id),
    byCategory: (category: string) => rows.filter((item) => item.category === category),
    equipment: () =>
      rows.filter((item) => ["shoes", "misanga", "accessory"].includes(item.category)),
    cosmetics: () => rows.filter((item) => ["fashion", "costume"].includes(item.category)),
    badges: () => rows.filter((item) => ["emblem", "title", "name_plate"].includes(item.category)),
    consumables: () => rows.filter((item) => item.category === "consume"),
    keyItems: () => rows.filter((item) => item.category === "important"),
    searchItems,
    allCapsules: () => capsules,
    getCapsule: (id: string) => capsules.find((capsule) => capsule.capsuleId === id),
    capsulesByRarity: (rarity: number) => capsules.filter((capsule) => capsule.rarity === rarity),
    allGallery: () => gallery,
    getGalleryItem: (id: string) => gallery.find((item) => item.galleryId === id),
    galleryByCategory: (category: number) => gallery.filter((item) => item.categoryId === category),
    categoryNames: {},
  } as any;
}

function createSqlTeamsAPI(
  teams: SqlData["teams"],
  formations: SqlData["formations"],
  uniforms: SqlData["uniforms"],
  series: Record<string, any>[],
): any {
  const teamMap = new Map(teams.map((team) => [team.teamId, team]));
  const formationMap = new Map(formations.map((formation) => [formation.formId, formation]));
  return {
    stats: () => ({
      totalTeams: teams.length,
      totalFormations: formations.length,
      totalUniforms: uniforms.length,
      totalSeries: series.length,
      formationsByBalance: {},
    }),
    allTeams: () => teams,
    getTeam: (id: string) => teamMap.get(id),
    searchTeams: (query: string) =>
      teams.filter((team) =>
        [team.name, team.name_EN, team.name_JA].some((name) =>
          name?.toLowerCase().includes(query.toLowerCase()),
        ),
      ),
    allSeries: () => series,
    getSeries: (id: string) => series.find((row) => row.seriesId === id),
    allFormations: () => formations,
    getFormation: (id: string) => formationMap.get(id),
    offensiveFormations: () =>
      formations.filter((row: any) => Number(row.powerOffense) > Number(row.powerDefense)),
    defensiveFormations: () =>
      formations.filter((row: any) => Number(row.powerDefense) > Number(row.powerOffense)),
    balancedFormations: () =>
      formations.filter((row: any) => Number(row.powerDefense) === Number(row.powerOffense)),
    allUniforms: () => uniforms,
    getUniform: (id: string) => uniforms.find((row) => row.name_id === id),
  } as any;
}

function createSqlQuestsAPI(rows: SqlData["quests"]): any {
  const quests = rows.map((quest) => ({
    ...quest,
    id: quest.questId,
    displayText: quest.titles?.en ?? quest.titles?.fr ?? quest.titles?.ja,
  }));
  const byId = new Map(quests.map((quest) => [quest.id, quest]));
  return {
    all: () => quests,
    get: (id: string) => byId.get(id),
    byPhase: (phase: number) => quests.filter((quest) => quest.phase === phase),
    search: (query: string) =>
      quests.filter((quest) =>
        Object.values(quest.titles ?? {}).some((title) =>
          String(title).toLowerCase().includes(query.toLowerCase()),
        ),
      ),
    meta: {
      totalQuests: quests.length,
      stats: {
        withTitleEN: quests.filter((q) => q.titles?.en).length,
        withTitleJA: quests.filter((q) => q.titles?.ja).length,
        withTitleFR: quests.filter((q) => q.titles?.fr).length,
      },
    },
  } as any;
}

/** Native spirit-drop records retain their own meaning, without fabricated item/battle joins. */
function createNativeDropsAPI(rows: Record<string, any>[]) {
  return {
    all: () => rows,
    getSources: (id: string) => rows.filter((row) => row.chara_id === id),
    getTable: () => rows,
    getAllTables: () => new Map([["spirit_table_data", rows]]),
    getBattleDrops: (condition: string) => rows.filter((row) => row.run_cond === condition),
    getAllBattles: () => new Map(rows.map((row) => [row.run_cond, row])),
  };
}

function createSqlDropsAPI(data: SqlData["drops"]): any {
  const tables = new Map(data.tables.map((row) => [row.table_id, row.entries]));
  const battles = new Map(data.battles.map((row) => [Number(row.battle_group_id), row]));
  const tableIdFor = (value: unknown) => {
    if (typeof value === "string" && tables.has(value)) return value;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? `0x${numeric.toString(16).toUpperCase()}` : String(value);
  };
  const itemMatches = (entry: any, requested: string | number) => {
    const raw = entry?.itemId ?? entry?.item_id ?? entry?.id;
    if (String(raw) === String(requested)) return true;
    const numeric = typeof raw === "number" ? raw : Number.parseInt(String(raw), 16);
    const wanted = typeof requested === "number" ? requested : Number.parseInt(requested, 16);
    return Number.isFinite(numeric) && Number.isFinite(wanted) && numeric === wanted;
  };
  return {
    getTable: (id: string) => tables.get(id) ?? [],
    getSources: (id: string | number) => {
      const sources: Array<{
        type: "battle" | "treasure";
        id: string;
        mapId?: string;
        pos?: any;
        probability?: number;
      }> = [];
      for (const [tableId, entries] of tables) {
        if (![...(entries as any[])].some((entry) => itemMatches(entry, id))) continue;
        for (const [battleId, battle] of battles)
          if (tableIdFor(battle.item_table_id) === tableId)
            sources.push({ type: "battle", id: `0x${battleId.toString(16).toUpperCase()}` });
      }
      for (const treasure of data.treasures as any[])
        if ((treasure.items as any[]).some((entry) => itemMatches(entry, id)))
          sources.push({
            type: "treasure",
            id: String(treasure.id),
            mapId: treasure.map_id ?? undefined,
            pos: treasure.pos,
            probability: 100,
          });
      return sources;
    },
    getBattleDrops: (id: number) => {
      const row = battles.get(id);
      return row?.item_table_id ? [{ items: tables.get(tableIdFor(row.item_table_id)) ?? [] }] : [];
    },
    getAllTables: () => tables,
    getAllBattles: () => battles,
    getAllTreasures: () => data.treasures,
  };
}

export type InagleService = Awaited<ReturnType<typeof createInagleService>>;
