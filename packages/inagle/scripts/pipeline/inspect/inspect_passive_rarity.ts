/* eslint-disable no-console */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "../../../src/core/index.ts";

const path = join(PATHS.skill, "passive_skill_rarity_table_config_0.00.00.cfg.bin.json");

try {
  const data = JSON.parse(readFileSync(path, "utf-8"));
  console.log(
    JSON.stringify(
      data,
      (key, value) => {
        if (key === "entries" && Array.isArray(value)) return value.slice(0, 2); // Only first 2 entries
        if (key === "children" && Array.isArray(value)) return value.slice(0, 2);
        return value;
      },
      2,
    ),
  );
} catch (e) {
  console.error(e);
}
