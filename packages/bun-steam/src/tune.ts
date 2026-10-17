// SPDX-License-Identifier: Apache-2.0
/**
 * `bun-steam tune`: applies the audit recommendations that live in Steam's own files
 * (`config/config.vdf`, `steam_dev.cfg`). System, network and driver settings are only reported.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditReport, Recommendation } from "./audit.js";
import {
  type ChangePlan,
  clientConfigPath,
  isSteamRunning,
  readVdf,
  writeVdf,
} from "./config.js";
import { norm } from "./paths.js";
import { kvEnsure, kvKey } from "./vdf.js";

const STORE = ["InstallConfigStore", "Software", "Valve", "Steam"];

function setDevCfg(file: string, key: string, value: string | null): void {
  const lines = existsSync(file)
    ? readFileSync(file, "utf8").split(/\r?\n/)
    : [];
  const at = lines.findIndex((l) => l.trim().split(/\s+/)[0] === key);
  if (value === null) {
    if (at >= 0) lines.splice(at, 1);
  } else if (at >= 0) lines[at] = `${key} ${value}`;
  else lines.push(`${key} ${value}`);
  const tmp = `${file}.bun-steam-${process.pid}`;
  writeFileSync(tmp, `${lines.filter(Boolean).join("\n")}\n`);
  renameSync(tmp, file);
}

/**
 * Plans (and with `apply`, writes) every applicable recommendation of `report`. `config.vdf`
 * changes need Steam closed (it rewrites the file on exit); `steam_dev.cfg` is read at start.
 */
export function tune(
  report: AuditReport,
  opts: { apply?: boolean; force?: boolean; only?: string[] } = {},
): { plans: ChangePlan[]; manual: Recommendation[] } {
  const steamRoot = report.steamRoot;
  const recs = report.recommendations.filter(
    (r) => !opts.only || opts.only.includes(r.id),
  );
  const manual = recs.filter((r) => !r.apply);
  const configPath = clientConfigPath(steamRoot);
  const devPath = norm(join(steamRoot, "steam_dev.cfg"));
  const doc = readVdf(configPath);
  const store = doc ? kvEnsure(doc, ...STORE) : null;
  const devText = existsSync(devPath) ? readFileSync(devPath, "utf8") : "";
  const plans: ChangePlan[] = [];
  const planned: Recommendation[] = [];
  for (const r of recs) {
    if (!r.apply || (r.apply.file === "config.vdf" && !store)) continue;
    planned.push(r);
    const { file, key, value } = r.apply;
    let from: string | null = null;
    if (file === "config.vdf" && store) {
      const v = store[kvKey(store, key) ?? key];
      from = typeof v === "string" ? v : null;
    } else if (file === "steam_dev.cfg") {
      from =
        devText
          .split(/\r?\n/)
          .map((l) => l.trim().split(/\s+/))
          .find(([k]) => k === key)?.[1] ?? null;
    }
    plans.push({
      file: file === "config.vdf" ? configPath : devPath,
      changes: [{ key, from, to: value ?? "(removed)" }],
      applied: false,
    });
  }
  if (!opts.apply) return { plans, manual };
  const touchesConfig = plans.some((p) => p.file === configPath);
  if (touchesConfig && !opts.force && isSteamRunning())
    throw new Error(
      "Steam is running and rewrites config.vdf on exit; close it, then run bun-steam tune --apply",
    );
  for (const [i, r] of planned.entries()) {
    const { file, key, value } = r.apply!;
    if (file === "config.vdf" && store) {
      const k = kvKey(store, key) ?? key;
      if (value === null) delete store[k];
      else store[k] = value;
    } else if (file === "steam_dev.cfg") setDevCfg(devPath, key, value);
    plans[i]!.applied = true;
  }
  if (touchesConfig && doc) writeVdf(configPath, doc);
  return { plans, manual };
}
