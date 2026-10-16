import { expect, test } from "bun:test";
import { loadVfsServiceData } from "../src/core/vfs-service";
import type { NieVfsHandle } from "../src/ffi/nie";

test("native domain DTOs retain identities and actual UR99 stats without SQL or dumps", async () => {
  const domains: Record<string, any[]> = {
    characters: [
      {
        chara_param_id: "0x100",
        chara_base_id: "0x200",
        internal_code: "c010",
        name: "Fixture",
        main_position: "GK",
        element: "Montagne",
        stats: { kc: 1, cr: 2, tc: 3, pr: 4, ps: 5, ag: 6, it: 7 },
        skills: [],
      },
    ],
    skills: [
      {
        skill_id: "0x300",
        skill_id_str: "whs010",
        name: "Fixture skill",
        element: "Feu",
        category: "Tir",
        power_min: 10,
        power_max: 20,
        consume_tp: 15,
      },
    ],
    items: [{ item_id: "0x400", name: "Fixture item", category: "Shoes" }],
    teams: [{ team_id: "0x500", name: "Fixture team" }],
  };
  const requests: string[] = [];
  const fake = {
    query: (request: { domain: string; limit: number; offset: number }) => {
      expect(request.limit).toBe(50000);
      requests.push(request.domain);
      const items = domains[request.domain] ?? [];
      return {
        source: "vfs",
        domain: request.domain,
        total: items.length,
        matched: items.length,
        offset: request.offset,
        items,
      };
    },
  } as unknown as Pick<NieVfsHandle, "query">;
  const data = await loadVfsServiceData(fake, async () => ({
    basaraConfig: { buildInfos: [], buildTypes: [] },
    capsuleConfig: {
      weaponColorTables: [],
      prizes: [],
      prizeTables: [],
      lotRankRates: [],
      configs: [],
    },
    series: [],
  }));
  expect(requests).toEqual([
    "characters",
    "skills",
    "items",
    "teams",
    "auras",
    "passives",
    "quests",
    "formations",
    "gallery",
    "uniforms",
    "drops",
  ]);
  expect(data.characters[0].data).toMatchObject({
    stats: {
      lv99: {
        kick: 1,
        control: 2,
        technique: 3,
        pressure: 4,
        physical: 5,
        agility: 6,
        intelligence: 7,
      },
    },
    statsBasis: { level: 99, rarity: "UR" },
  });
  expect(data.skills[0]).toMatchObject({ id: "0x300", category_id: 1, element_id: 3 });
  expect(data.items[0]).toMatchObject({ itemId: "0x400", names: { fr: "Fixture item" } });
  expect(data.teams[0]).toMatchObject({ teamId: "0x500", name_FR: "Fixture team" });
});
