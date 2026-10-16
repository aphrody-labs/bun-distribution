// Source: packages/shenron/db/src/wiki-registry.ts at 8172f535ce (preserved Git history).
// SPDX-License-Identifier: Apache-2.0
/**
 * Public wiki registry: the 21 categories of the MCP contract mapped to their
 * `bot.*` table. Column names are Drizzle property keys. Every table carries
 * the `visible` column; public reads filter `visible = true` and never expose
 * it. Runtime class: `pure`.
 */
import type { PgTable } from "drizzle-orm/pg-core";
import {
  botArcs,
  botBattles,
  botCharacters,
  botDragons,
  botEpisodes,
  botGames,
  botItems,
  botLocations,
  botMovies,
  botPlanets,
  botPowerLevels,
  botRaces,
  botSagas,
  botSoundtracks,
  botTechniques,
  botTimelineEvents,
  botTools,
  botTournaments,
  botTransformations,
  botVoiceActors,
  botWishes,
} from "./bot-schema";
import { WIKI_CATEGORIES, type WikiCategoryName } from "./constants";

export interface WikiCategorySpec {
  name: WikiCategoryName;
  label: string;
  table: PgTable;
  idColumn: "id";
  slugColumn: string | null;
  searchColumns: readonly string[];
  omitColumns: readonly string[];
}

/** Always hidden: editorial flag. */
const BASE_OMIT: readonly string[] = ["visible"];
/** Resolved stream URLs carry provider headers/tokens: never public. */
const STREAM_OMIT: readonly string[] = [...BASE_OMIT, "streamUrl", "streamHeaders", "streams"];

type SpecInput = Pick<WikiCategorySpec, "table" | "slugColumn" | "searchColumns"> & {
  omitColumns?: readonly string[];
};

const SPECS: Record<WikiCategoryName, SpecInput> = {
  characters: {
    table: botCharacters,
    slugColumn: null,
    searchColumns: ["name", "nameJa", "nameRomaji"],
  },
  planets: { table: botPlanets, slugColumn: null, searchColumns: ["name", "nameJa", "nameRomaji"] },
  races: { table: botRaces, slugColumn: "slug", searchColumns: ["name", "nameJa", "slug"] },
  techniques: {
    table: botTechniques,
    slugColumn: "slug",
    searchColumns: ["name", "nameJa", "nameRomaji", "slug"],
  },
  transformations: { table: botTransformations, slugColumn: null, searchColumns: ["name"] },
  sagas: { table: botSagas, slugColumn: "slug", searchColumns: ["name", "nameJa", "slug"] },
  arcs: { table: botArcs, slugColumn: "slug", searchColumns: ["name", "nameJa", "slug"] },
  episodes: {
    table: botEpisodes,
    slugColumn: null,
    searchColumns: ["title", "titleJa", "titleRomaji"],
    omitColumns: STREAM_OMIT,
  },
  movies: {
    table: botMovies,
    slugColumn: "slug",
    searchColumns: ["title", "titleJa", "titleRomaji", "slug"],
    omitColumns: STREAM_OMIT,
  },
  games: { table: botGames, slugColumn: "slug", searchColumns: ["title", "titleJa", "slug"] },
  tools: { table: botTools, slugColumn: "slug", searchColumns: ["name", "slug", "description"] },
  battles: { table: botBattles, slugColumn: "slug", searchColumns: ["title", "titleJa", "slug"] },
  items: {
    table: botItems,
    slugColumn: "slug",
    searchColumns: ["name", "nameJa", "nameRomaji", "slug"],
  },
  dragons: { table: botDragons, slugColumn: "slug", searchColumns: ["name", "nameJa", "slug"] },
  wishes: {
    table: botWishes,
    slugColumn: null,
    searchColumns: ["wishText", "dragonName", "whisperer"],
  },
  locations: {
    table: botLocations,
    slugColumn: "slug",
    searchColumns: ["name", "nameJa", "nameRomaji", "slug"],
  },
  tournaments: {
    table: botTournaments,
    slugColumn: "slug",
    searchColumns: ["name", "nameJa", "slug"],
  },
  voice_actors: {
    table: botVoiceActors,
    slugColumn: "slug",
    searchColumns: ["name", "nameJa", "slug"],
  },
  soundtracks: {
    table: botSoundtracks,
    slugColumn: "slug",
    searchColumns: ["title", "titleJa", "titleRomaji", "artist", "slug"],
  },
  power_levels: {
    table: botPowerLevels,
    slugColumn: null,
    searchColumns: ["characterName", "form"],
  },
  timeline_events: {
    table: botTimelineEvents,
    slugColumn: null,
    searchColumns: ["title", "titleJa"],
  },
};

export const WIKI_REGISTRY: Readonly<Record<WikiCategoryName, WikiCategorySpec>> = Object.freeze(
  Object.fromEntries(
    WIKI_CATEGORIES.map(({ name, label }) => {
      const spec = SPECS[name];
      const entry: WikiCategorySpec = {
        name,
        label,
        table: spec.table,
        idColumn: "id",
        slugColumn: spec.slugColumn,
        searchColumns: Object.freeze([...spec.searchColumns]),
        omitColumns: Object.freeze([...(spec.omitColumns ?? BASE_OMIT)]),
      };
      return [name, Object.freeze(entry)];
    }),
  ) as Record<WikiCategoryName, WikiCategorySpec>,
);
