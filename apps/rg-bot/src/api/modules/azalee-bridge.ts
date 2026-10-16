import { Elysia } from "elysia";
import { getCrossCatalogStats, getCrossTables } from "@rosegriffon/azalee/cross";
import { WikiService } from "./wiki/service";

/**
 * Compatibility mount for the former Azalée headless API.
 *
 * All routes are dispatched through the unified SQL/data modules. The former
 * `:8807` server remains available as an independent compatibility process.
 */
async function forwardAzalee(request: Request, suffix: string) {
  const url = new URL(request.url);
  const query = Object.fromEntries(url.searchParams.entries());
  const parts = suffix.split("/").filter(Boolean);
  if (parts[0] === "api") parts.shift();
  const [resource, id, detail] = parts;
  if (resource === "health") return Response.json({ ok: true, service: "azalee", source: "unified" });
  if (resource === "cpk") {
    if (id === "search") return Response.json(await WikiService.searchCpk(query.q ?? "", Number(query.limit ?? 200)));
    if (id === "file") {
      const data = await WikiService.getCpkFile(query.path ?? "");
      return Response.json(data ?? { error: "not_found" }, { status: data ? 200 : 404 });
    }
    return Response.json(
      await WikiService.listCpk(query.path ?? "", Number(query.limit ?? 200), Number(query.offset ?? 0)),
    );
  }
  if (resource === "text") {
    if (id === "stats") return Response.json(await WikiService.textStats());
    if (id) {
      const data = await WikiService.resolveText(id);
      return Response.json(data ?? { error: "not_found" }, { status: data ? 200 : 404 });
    }
    return Response.json(await WikiService.searchText(query.q ?? "", query.locale ?? "fr", Number(query.limit ?? 50)));
  }
  if (resource === "characters") {
    if (!id) return Response.json(await WikiService.getCharacters(query));
    const data = await WikiService.getCharacter(id);
    return Response.json(data ?? { error: "not_found" }, { status: data ? 200 : 404 });
  }
  if (resource === "skills") {
    if (!id) return Response.json(await WikiService.getSkills(query));
    const data = await WikiService.getSkill(id);
    return Response.json(data ?? { error: "not_found" }, { status: data ? 200 : 404 });
  }
  if (resource === "items") {
    if (!id) return Response.json(await WikiService.getItems(query));
    const data = await WikiService.getItem(id);
    return Response.json(data ?? { error: "not_found" }, { status: data ? 200 : 404 });
  }
  if (resource === "quests") {
    if (!id) return Response.json(await WikiService.getQuests(query));
    const data = await WikiService.getQuest(id);
    return Response.json(data ?? { error: "not_found" }, { status: data ? 200 : 404 });
  }
  if (resource === "passives") {
    if (!id) return Response.json(await WikiService.getPassives(query));
    const data = await WikiService.getPassive(id);
    return Response.json(data ?? { error: "not_found" }, { status: data ? 200 : 404 });
  }
  if (resource === "teams") {
    if (!id) return Response.json(await WikiService.getTeams());
    const data = await WikiService.getTeam(id);
    return Response.json(data ?? { error: "not_found" }, { status: data ? 200 : 404 });
  }
  if (resource === "drops" && !id) return Response.json(await WikiService.getDrops());
  if (resource === "search") {
    const q = query.q ?? "";
    const [characters, skills, items] = await Promise.all([
      WikiService.getCharacters({ q, limit: query.limit ?? "10", page: "1" }),
      WikiService.getSkills({ q, limit: query.limit ?? "10", page: "1" }),
      WikiService.getItems({ q, limit: query.limit ?? "10", page: "1" }),
    ]);
    return Response.json({ q, characters: characters.data, skills: skills.data, items: items.data });
  }
  if (resource === "cross") {
    if (id === "catalog") return Response.json(await WikiService.getCrossCatalog(query));
    if (id === "asset") {
      const data = detail ? await WikiService.getCrossAsset(detail) : null;
      return Response.json(data ?? { error: "not_found" }, { status: data ? 200 : 404 });
    }
    if (id === "stats") return Response.json(getCrossCatalogStats());
    if (id === "tables") return Response.json(getCrossTables(query.q));
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const auxiliaryTables: Record<string, string> = {
    shops: "inagle_shops",
    capsules: "inagle_capsules",
    costumes: "inagle_costumes",
    stadiums: "inagle_stadiums",
    trophies: "inagle_trophies",
    invocation: "inagle_constellations",
    coaches: "inagle_coordinators",
    coordinators: "inagle_coordinators",
    gallery: "inagle_gallery",
    auras: "inagle_auras",
    tactics: "inagle_tactics",
  };
  let table = auxiliaryTables[resource];
  let lookupId = id;
  if (resource === "auras") {
    const auraTables: Record<string, string> = {
      "esprits-guerriers": "inagle_keshins",
      "totems": "inagle_souls",
      miximax: "inagle_miximax",
      autres: "inagle_auras",
    };
    table = auraTables[id ?? ""];
    lookupId = detail;
  }
  if (table) {
    if (!lookupId) return Response.json(await WikiService.getAuxiliary(table));
    const data = await WikiService.getAuxiliaryOne(table, lookupId);
    return Response.json(data ?? { error: "not_found" }, { status: data ? 200 : 404 });
  }
  return Response.json({ error: "not_found" }, { status: 404 });
}

export const azaleeBridgeModule = new Elysia({ prefix: "/azalee" })
  .get("/health", ({ request }) => forwardAzalee(request, "health"))
  .get("/api/*", ({ request, params }) => forwardAzalee(request, `api/${params["*"] ?? ""}`));
