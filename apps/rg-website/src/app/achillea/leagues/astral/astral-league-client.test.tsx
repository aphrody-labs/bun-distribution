import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { LeagueSeasonPayload } from "@rosegriffon/achillea-types/domain/league";

const season: LeagueSeasonPayload = {
  meta: {
    id: "astral-s1",
    name: "Astral League",
    season: "Saison 1",
    format: "league",
    description: "Saison test",
    champion: "GKO",
    teamCount: 2,
    matchdays: 1,
    aliases: [],
  },
  format: {},
  teams: [
    { tag: "GKO", name: "GKO" },
    { tag: "OMP", name: "OMP" },
  ],
  pointsConfig: {},
  standings: [
    {
      teamId: "GKO",
      rank: 1,
      played: 7,
      wins: 5,
      draws: 0,
      losses: 0,
      winsOt: 1,
      lossesOt: 1,
      points: 17,
      mapDiff: 9,
      mapsFor: 14,
      mapsAgainst: 5,
    },
  ],
  results: [],
  playoffs: [
    {
      round: "grand_final",
      label: "Grande finale",
      homeId: "GKO",
      awayId: "OMP",
      homeScore: 3,
      awayScore: 0,
    },
  ],
};

mock.module("@/lib/achillea", () => ({
  createAchilleaClient: () => ({
    leagues: { astral: async () => ({ ok: true, value: season }) },
  }),
}));

const { default: AstralLeagueClient } = await import("./astral-league-client");

afterEach(() => cleanup());

describe("AstralLeagueClient", () => {
  test("affiche les bilans de prolongation et les résultats réels des play-offs", async () => {
    render(<AstralLeagueClient initialSeason={season} />);

    const gkoRow = await screen.findByRole("row", { name: /GKO/ });
    expect(screen.getByRole("columnheader", { name: "V.P." })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "D.P." })).toBeTruthy();
    expect(
      within(gkoRow)
        .getAllByRole("cell")
        .map(cell => cell.textContent?.trim()),
    ).toEqual(["1", "GKOGKO", "7", "5", "1", "0", "1", "14", "5", "+9", "17 pts"]);

    fireEvent.click(screen.getByRole("button", { name: "Play-offs (Final Four)" }));
    expect(await screen.findByText("Champion de la saison : GKO")).toBeTruthy();
    expect(screen.getByText("Grande finale")).toBeTruthy();
    expect(screen.getByText("3 - 0")).toBeTruthy();
  });
});
