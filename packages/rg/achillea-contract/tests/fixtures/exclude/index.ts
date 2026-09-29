export type MatchResult = "win" | "loss" | "draw" | "forfeit";

export type RankedResult = Exclude<MatchResult, "draw">;
