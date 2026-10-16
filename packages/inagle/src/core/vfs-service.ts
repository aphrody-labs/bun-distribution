import { loadBasaraConfigAsync } from "../parsers/basara-config.js";
import { buildCapsuleDatabase } from "../parsers/capsule-config.js";
import { getAllSeries, clearTeamCache } from "../parsers/belong-team.js";
import { gameDataDirectory } from "./vfs-data.js";
import type { NieVfsHandle } from "../ffi/nie.js";
import { gameVfs } from "./vfs-data.js";
import type { loadInagleServiceData } from "../sql/service-data.js";

type NativeRow = Record<string, any>;

/** Adapt native domain DTOs to the existing service API without parsing game files in JS. */
async function loadAnnexes() {
  const path = gameDataDirectory();
  clearTeamCache();
  return {
    basaraConfig: await loadBasaraConfigAsync(path),
    capsuleConfig: await buildCapsuleDatabase(path),
    series: getAllSeries(),
  };
}

export async function loadVfsServiceData(
  vfs: Pick<NieVfsHandle, "query"> = gameVfs(),
  annexes = loadAnnexes,
): Promise<NonNullable<Awaited<ReturnType<typeof loadInagleServiceData>>>> {
  const all = (domain: string): NativeRow[] => {
    const records: NativeRow[] = [];
    for (let offset = 0; ; offset += 50000) {
      const page = vfs.query<NativeRow>({ domain, offset, limit: 50000 });
      records.push(...page.items);
      if (records.length >= page.matched) return records;
      if (!page.items.length) throw new Error(`Native VFS ${domain} pagination ended early.`);
    }
  };
  const element = (value: string): number =>
    ({ wind: 1, vent: 1, forest: 2, forêt: 2, fire: 3, feu: 3, mountain: 4, montagne: 4 })[value.toLowerCase()] ?? 0;
  const characters = all("characters").map(row => ({
    id: row.chara_param_id,
    chara_id: row.chara_base_id,
    internal_code: row.internal_code,
    name_fr: row.name,
    position: row.main_position,
    element_id: element(row.element),
    series: row.series,
    data: {
      ...row,
      element: row.element,
      skills: row.skills,
      stats: {
        lv99: {
          kick: row.stats.kc,
          control: row.stats.cr,
          technique: row.stats.tc,
          pressure: row.stats.pr,
          physical: row.stats.ps,
          agility: row.stats.ag,
          intelligence: row.stats.it,
        },
      },
      statsBasis: { level: 99, rarity: "UR" },
      teams: row.team ? [{ names: { fr: row.team } }] : [],
    },
  }));
  const skills = all("skills").map(row => ({
    id: row.skill_id,
    internal_code: row.skill_id_str,
    name_fr: row.name,
    category_id:
      ({ tir: 1, défense: 2, dribble: 3, arrêt: 4, spécial: 5 } as Record<string, number>)[
        row.category.toLowerCase()
      ] ?? 0,
    element_id: element(row.element),
    power_min: row.power_min,
    power_max: row.power_max,
    data: { ...row, consumeTp: row.consume_tp, displayName: row.name },
  }));
  const items = all("items").map(row => ({
    ...row,
    itemId: row.item_id,
    internalCode: row.internal_code,
    names: { fr: row.name },
    descriptions: { fr: row.description },
    shops: { en: [], fr: [] },
  }));
  const teams = all("teams").map(row => ({
    ...row,
    teamId: row.team_id,
    teamIdStr: row.team_id,
    name: row.name,
    displayName: row.name,
    name_FR: row.name,
    names: { fr: row.name },
    emblems: { v: row.emblem_id_v },
    kits: { v: row.kit_id_v },
    uniforms: [],
  }));
  const auras = all("auras").map(row => ({
    id: row.aura_id,
    name_fr: row.name,
    element_id: element(row.element),
    sub_type: row.sub_type,
    data: row,
  }));
  const passives = all("passives").map(row => ({
    id: row.passive_id,
    name_fr: row.name,
    data: row,
  }));
  const quests = all("quests").map(row => ({
    ...row,
    questId: row.quest_id,
    type: row.quest_type,
    titles: { fr: row.title },
  }));
  const formations = all("formations").map(row => ({
    ...row,
    formId: row.form_id,
    formIdStr: row.form_id,
    placements: row.positions,
    powerOffense: row.power_offense,
    powerDefense: row.power_defense,
  }));
  const gallery = all("gallery").map(row => ({
    ...row,
    galleryId: row.gallery_id,
    imgPath: row.img_path,
    thumbPath: row.thumb_path,
  }));
  const uniforms = all("uniforms");
  const drops = all("drops");
  const { basaraConfig, capsuleConfig, series } = await annexes();
  const characterById = new Map(characters.map(row => [row.id, row]));
  const basara = (basaraConfig?.buildInfos ?? []).map(build => {
    const character = characterById.get(build.charaId);
    return {
      character_id: build.charaId,
      name_localised: character?.name_fr,
      position: character?.position,
      element: character?.data.element,
      builds: build.buildTypeIndices.map(index => basaraConfig!.buildTypes[index]).filter(Boolean),
      ...character?.data.stats.lv99,
    };
  });
  const capsules = capsuleConfig.prizes.map(prize => ({
    ...prize,
    capsuleId: prize.id,
    capsuleIdStr: prize.id,
    rawVariables: prize.vars,
  }));
  return {
    basara,
    characters,
    skills,
    items,
    teams,
    formations,
    passives,
    quests,
    capsules,
    gallery,
    uniforms,
    drops: { native: drops },
    auras,
    series,
  } as unknown as NonNullable<Awaited<ReturnType<typeof loadInagleServiceData>>>;
}
