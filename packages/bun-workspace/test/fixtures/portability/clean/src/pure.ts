// Mentions in comments never count: process.env.X, Bun.env, import "node:fs", require("bun:ffi").
import type { Stat } from "./types";
import { helper } from "./helper";

/* dlopen("lib") in a block comment is ignored too */
export const label = "server-only and @aphrody/x inside a string are not imports";
export const pattern = /process\.env|window\.name/;
export function describe(stat: Stat): string {
  return `${helper(stat.size)} ${"window.location"}`;
}
