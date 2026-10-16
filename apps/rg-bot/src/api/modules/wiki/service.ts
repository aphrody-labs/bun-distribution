import { inagleDb } from "../../plugins/db";
import { WikiSqlRepository } from "./repository";

const sqlWiki = new WikiSqlRepository(inagleDb);

export abstract class WikiService {
  public static async getCharacters(params: Record<string, unknown>) {
    return (
      (await sqlWiki.characters(
        String(params.q ?? "") || undefined,
        Number(params.limit ?? 24),
        Number(params.page ?? 1),
      )) ?? {
        data: [],
        count: 0,
        page: Number(params.page ?? 1),
        limit: Number(params.limit ?? 24),
        source: "postgres" as const,
      }
    );
  }

  public static async getCharacter(idOrSlug: string) {
    return await sqlWiki.character(idOrSlug);
  }

  public static async getSkills(params: Record<string, unknown>) {
    return (
      (await sqlWiki.skills(
        String(params.q ?? "") || undefined,
        Number(params.limit ?? 24),
        Number(params.page ?? 1),
      )) ?? {
        data: [],
        count: 0,
        page: Number(params.page ?? 1),
        limit: Number(params.limit ?? 24),
        source: "postgres" as const,
      }
    );
  }

  public static async getItems(params: Record<string, unknown>) {
    return (
      (await sqlWiki.items(
        String(params.q ?? "") || undefined,
        Number(params.limit ?? 24),
        Number(params.page ?? 1),
      )) ?? {
        data: [],
        count: 0,
        page: Number(params.page ?? 1),
        limit: Number(params.limit ?? 24),
        source: "postgres" as const,
      }
    );
  }

  public static async getItem(id: string) {
    return await sqlWiki.item(id);
  }

  public static async getQuests(params: Record<string, unknown>) {
    return (
      (await sqlWiki.quests(
        String(params.q ?? "") || undefined,
        Number(params.limit ?? 24),
        Number(params.page ?? 1),
      )) ?? {
        data: [],
        count: 0,
        page: Number(params.page ?? 1),
        limit: Number(params.limit ?? 24),
        source: "postgres" as const,
      }
    );
  }

  public static async getQuest(id: string) {
    return await sqlWiki.quest(id);
  }

  public static async getPassives(params: Record<string, unknown>) {
    return (
      (await sqlWiki.passives(
        String(params.q ?? "") || undefined,
        Number(params.limit ?? 24),
        Number(params.page ?? 1),
      )) ?? {
        data: [],
        count: 0,
        page: Number(params.page ?? 1),
        limit: Number(params.limit ?? 24),
        source: "postgres" as const,
      }
    );
  }

  public static async getPassive(id: string) {
    return await sqlWiki.passive(id);
  }

  public static async getSkill(id: string) {
    return await sqlWiki.skill(id);
  }

  public static async getTeams() {
    return (await sqlWiki.teams()) ?? [];
  }

  public static async getTeam(id: string) {
    return await sqlWiki.team(id);
  }

  public static async getDrops() {
    return (await sqlWiki.drops()) ?? [];
  }

  public static async getCrossCatalog(params: Record<string, unknown>) {
    return (
      (await sqlWiki.crossCatalog(
        String(params.q ?? "") || undefined,
        String(params.type ?? "") || undefined,
        Number(params.limit ?? 50),
        Number(params.page ?? 1),
      )) ?? {
        data: [],
        count: 0,
        page: Number(params.page ?? 1),
        limit: Number(params.limit ?? 50),
        source: "postgres" as const,
      }
    );
  }

  public static async getCrossAsset(guid: string) {
    return await sqlWiki.crossAsset(guid);
  }

  public static async getAuxiliary(table: string, orderBy = "id") {
    return (await sqlWiki.auxiliary(table, orderBy)) ?? [];
  }

  public static async getAuxiliaryOne(table: string, id: string) {
    return await sqlWiki.auxiliaryOne(table, id);
  }

  public static async searchText(q: string, locale = "fr", limit = 50) {
    return {
      data: await sqlWiki.gameTextSearch(q, locale as "fr" | "en" | "ja", limit),
      query: q,
      locale,
      limit,
      source: "postgres" as const,
    };
  }

  public static async resolveText(hash: string) {
    const rows = await sqlWiki.gameText(hash);
    if (rows.length === 0) return null;
    const first = rows[0];
    const out: Record<string, unknown> = { hashId: first?.hash_id, category: first?.category };
    for (const row of rows)
      if (row.locale === "fr" || row.locale === "en" || row.locale === "ja") out[row.locale] = row.value;
    return out;
  }

  public static async textStats() {
    return await sqlWiki.gameTextStats();
  }

  public static async listCpk(path = "", limit = 200, offset = 0) {
    return await sqlWiki.cpkList(path, limit, offset);
  }

  public static async searchCpk(q: string, limit = 200) {
    return await sqlWiki.cpkSearch(q, limit);
  }

  public static async getCpkFile(path: string) {
    return await sqlWiki.cpkFile(path);
  }
}
