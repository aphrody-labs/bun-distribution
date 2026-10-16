/* eslint-disable no-console */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "../../../src/core/index.ts";

const path = join(PATHS.skill, "passive_skill_effect_config.cfg.bin.json");

try {
  const data = JSON.parse(readFileSync(path, "utf-8"));
  console.log(
    JSON.stringify(
      data,
      (key, value) => {
        if (key === "entries" && Array.isArray(value)) return value.slice(0, 2);
        if (key === "children" && Array.isArray(value)) return value.slice(0, 2);
        return value;
      },
      2,
    ),
  );
} catch (e) {
  console.error(e);
}
