import { Elysia } from "elysia";
import { LeagueModel } from "./model";
import { LeagueService } from "./service";

export const leagueController = new Elysia({ prefix: "/leagues" })
  .get(
    "/",
    () => {
      const season = LeagueService.getAstralSeason();
      return {
        items: [
          {
            id: season.meta.id,
            name: season.meta.name,
            season: season.meta.season,
            format: season.meta.format,
            description: season.meta.description,
            champion: season.meta.champion,
            teamCount: season.meta.teamCount,
            matchdays: season.meta.matchdays,
            aliases: season.meta.aliases,
          },
        ],
      };
    },
    { response: { 200: LeagueModel.list } },
  )
  .get("/astral", () => LeagueService.getAstralSeason(), { response: { 200: LeagueModel.season } })
  .get("/astral-s1", () => LeagueService.getAstralSeason(), { response: { 200: LeagueModel.season } })
  .get("/asytral", () => LeagueService.getAstralSeason(), { response: { 200: LeagueModel.season } })
  .get("/asytral-s1", () => LeagueService.getAstralSeason(), { response: { 200: LeagueModel.season } });
