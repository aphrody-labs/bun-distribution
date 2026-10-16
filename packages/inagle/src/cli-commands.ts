import type { Command } from "commander";
import pc from "picocolors";
import { ITEM_CATEGORY_NAMES } from "./items/categories.js";
import { createInagleService } from "./service.js";

// === STATS COMMAND ===
export function registerStatsCommand(program: Command) {
  program
    .command("stats")
    .description("Show game-data statistics")
    .option("--json", "Print machine-readable source and domain counts")
    .action(async (options: { json?: boolean }) => {
      const service = await createInagleService();
      if (options.json) {
        console.log(
          JSON.stringify({
            source: service.source,
            characters: service.characters.all().length,
            skills: service.skills.all().length,
            items: service.items.allItems().length,
            teams: service.teams.allTeams().length,
          }),
        );
        return;
      }

      console.log(pc.bold("\n📊 Game-data Statistics"));
      console.log(pc.dim("--------------------------------"));

      const chars = service.characters.meta;
      console.log(pc.blue("Characters:"), pc.bold(chars.totalCharacters));
      console.log(pc.dim(`  - With Stats: ${chars.stats.withNameFR}`));

      const skills = service.skills.all();
      console.log(pc.green("Skills:"), pc.bold(skills.length));

      const items = service.items.allItems();
      console.log(pc.yellow("Items:"), pc.bold(items.length));

      const teams = service.teams.allTeams();
      console.log(pc.magenta("Teams:"), pc.bold(teams.length));
    });
}

// === SEARCH COMMAND ===
export function registerSearchCommand(program: Command) {
  program
    .command("search <query>")
    .description("Search across game data")
    .option("-l, --limit <number>", "Limit results", "5")
    .action(async (query, options) => {
      const service = await createInagleService();
      const results = service.search.global(query, { limit: parseInt(options.limit, 10) });

      if (results.length === 0) {
        console.log(pc.red("No results found."));
        return;
      }

      const characters = results.filter(r => r.type === "character");
      const skills = results.filter(r => r.type === "skill");
      const items = results.filter(r => r.type === "item");

      if (characters.length > 0) {
        console.log(pc.bold(pc.blue("\nCharacters")));
        characters.forEach(r => {
          const c = r.data as any;
          console.log(
            `  ${pc.bold(c.names?.fr || c.names?.en || "???")} ${pc.dim(`(${c.rarity})`)} - ${c.position} ${c.element}`,
          );
        });
      }

      if (skills.length > 0) {
        console.log(pc.bold(pc.green("\nSkills")));
        skills.forEach(r => {
          const s = r.data as any;
          // For GlobalSearch result 's', it might be different structure.
          // But usually it matches EnrichedSkill or similar.
          // Let's use generic access or assume it's EnrichedSkill-like.
          const name = s.name_FR || s.displayName || s.names?.fr || "???";
          const cost = s.consumeTp ?? s.stats?.tensionCost ?? "?";
          console.log(`  ${pc.bold(name)} ${pc.dim(`(${cost} TP)`)}`);
        });
      }

      if (items.length > 0) {
        console.log(pc.bold(pc.yellow("\nItems")));
        items.forEach(r => {
          const i = r.data as any;
          console.log(`  ${pc.bold(i.names?.fr || i.names?.en || "???")}`);
        });
      }
    });
}

// === CHARACTER COMMAND ===
export function registerCharacterCommand(program: Command) {
  program
    .command("character <name>")
    .alias("char")
    .description("Find a character by name")
    .action(async name => {
      const service = await createInagleService();
      const results = service.characters.search(name, { limit: 5 });

      if (results.length === 0) {
        console.log(pc.red("Character not found."));
        return;
      }

      results.forEach((char: any) => {
        console.log(pc.dim("--------------------------------"));
        console.log(pc.bold(pc.cyan(char.names.fr || char.names.en || "Unknown Name")));
        console.log(`ID: ${pc.dim(char.charaId)} / ParamID: ${pc.dim(char.charaParamId)}`);
        console.log(`Rarity: ${pc.yellow(char.rarity)} (Code: ${char.rarityCode})`);
        console.log(`Position: ${char.position} / Element: ${char.element}`);

        // Images
        const face = service.images.face(char.charaId);
        if (face) console.log(`Image: ${pc.dim(face)}`);

        if (char.teams && char.teams.length > 0) {
          console.log(`Team: ${char.teams[0].names.fr || "None"}`);
        }

        if (char.stats?.lv99) {
          const s = char.stats.lv99;
          console.log(
            `Stats (Lv99 UR reference): K${s.kick} C${s.control} T${s.technique} P${s.physical} S${s.agility} G${s.intelligence}`,
          );
        }
        if (char.series) console.log(`Series: ${char.series}`);
      });
    });
}

// === ITEMS COMMAND ===
export function registerItemsCommand(program: Command) {
  const items = program.command("items").description("Explore items database");

  items
    .command("list")
    .description("List items (optional filter by category)")
    .option("-c, --category <category>", "Filter by category (e.g. shoes, consume)")
    .option("-l, --limit <number>", "Limit results", "20")
    .action(async options => {
      const service = await createInagleService();
      let results = service.items.allItems();

      if (options.category) {
        results = service.items.byCategory(options.category as any);
        if (results.length === 0) {
          console.log(pc.red(`Invalid category or no items found for '${options.category}'.`));
          console.log("Valid categories:", Object.keys(ITEM_CATEGORY_NAMES).join(", "));
          return;
        }
      }

      console.log(pc.bold(`\nFound ${results.length} items`));
      const limit = parseInt(options.limit, 10);

      results.slice(0, limit).forEach((item: any) => {
        const name = item.names?.fr || item.names?.en || "???";
        const cat = item.category;
        console.log(`  ${pc.yellow(item.itemId)}: ${pc.bold(name)} ${pc.dim(`(${cat})`)}`);
      });

      if (results.length > limit) {
        console.log(pc.dim(`... and ${results.length - limit} more.`));
      }
    });

  items
    .command("find <query>")
    .description("Search items by name")
    .action(async query => {
      const service = await createInagleService();
      const results = service.items.searchItems(query);

      if (results.length === 0) {
        console.log(pc.red("No items found."));
        return;
      }

      results.forEach((item: any) => {
        const name = item.names?.fr || item.names?.en || "???";
        const desc = item.descriptions?.fr || item.descriptions?.en || "";

        console.log(pc.dim("--------------------------------"));
        console.log(`${pc.bold(pc.yellow(name))} ${pc.dim(`(${item.itemId})`)}`);
        console.log(`Category: ${item.category}`);
        if (desc) console.log(pc.italic(desc));

        const imgId = item.internalCode || item.itemId;
        const img = service.images.item(imgId);
        if (img) console.log(`Image: ${pc.dim(img)}`);
      });
    });
}

// === SKILLS COMMAND ===
export function registerSkillsCommand(program: Command) {
  const skills = program.command("skills").description("Explore skills database");

  skills
    .command("find <query>")
    .description("Search skills by name")
    .action(async query => {
      const service = await createInagleService();
      const results = service.skills.search(query);

      if (results.length === 0) {
        console.log(pc.red("No skills found."));
        return;
      }

      results.forEach((skill: any) => {
        const name = skill.name_FR || skill.displayName || "???";
        console.log(pc.dim("--------------------------------"));
        const code = skill.internalCode || skill.skillIDStr || "???";
        console.log(`${pc.bold(pc.green(name))} ${pc.dim(`(${code})`)}`);

        // Use flat properties from EnrichedSkill (SkillInfo)
        const cost = skill.consumeTp || 0;
        const min = skill.power_min || 0;
        const max = skill.power_max || 0;
        console.log(`Cost: ${cost} TP / Power: ${min}-${max}`);

        // Use elementName object
        console.log(`Element: ${skill.elementName?.fr || skill.elementName?.en || "???"}`);

        if (skill.desc_FR) console.log(pc.italic(skill.desc_FR));

        if (code && code !== "???") {
          const img = service.images.skill(code);
          if (img) console.log(`Image: ${pc.dim(img)}`);
        }
      });
    });
}

// === TEAMS COMMAND ===
export function registerTeamsCommand(program: Command) {
  const teams = program.command("teams").description("Explore teams database");

  teams
    .command("list")
    .description("List all teams")
    .action(async () => {
      const service = await createInagleService();
      const all = service.teams.allTeams();

      console.log(pc.bold(`\nFound ${all.length} teams`));
      all.forEach((team: any) => {
        const name = team.name || team.displayName || "???";
        console.log(`  ${pc.magenta(team.teamIdStr)}: ${pc.bold(name)}`);
      });
    });

  teams
    .command("get <id>")
    .description("Get team details by ID")
    .action(async id => {
      const service = await createInagleService();
      const team = service.teams.getTeam(id);

      if (!team) {
        console.log(pc.red("Team not found."));
        return;
      }

      const name = team.name || team.displayName || "???";
      console.log(pc.bold(`\n${name} (${team.teamIdStr})`));
      const emblemId = "emblemId" in team ? team.emblemId : undefined;
      if (emblemId) {
        const img = service.images.emblem(emblemId.toString());
        if (img) console.log(`Emblem: ${pc.dim(img)}`);
      }
    });
}

// === COMPARE COMMAND ===
export function registerCompareCommand(program: Command) {
  program
    .command("compare <chara1> <chara2>")
    .description("Compare two characters side-by-side (stats and attributes)")
    .option("-l, --level <number>", "Level to compare (1-99)", "99")
    .action(async (chara1: string, chara2: string, options: { level: string }) => {
      const service = await createInagleService();
      const level = Math.max(1, Math.min(99, parseInt(options.level, 10) || 99));
      if (service.source === "vfs" && level !== 99)
        throw new Error("Native VFS comparison currently exposes level 99 UR reference stats; select --level 99.");

      const findOne = (q: string) => {
        const found = service.characters.search(q, { limit: 1 });
        return found.length > 0 ? found[0] : null;
      };

      const c1 = findOne(chara1);
      const c2 = findOne(chara2);

      if (!c1) {
        console.log(pc.red(`Character not found: ${chara1}`));
        return;
      }
      if (!c2) {
        console.log(pc.red(`Character not found: ${chara2}`));
        return;
      }

      const name1 = c1.names?.fr || c1.names?.en || c1.charaId;
      const name2 = c2.names?.fr || c2.names?.en || c2.charaId;

      console.log(pc.bold(pc.cyan(`\n⚡ Character Comparison (Level ${level})`)));
      console.log(pc.dim("------------------------------------------------------------"));
      console.log(`${pc.bold(pc.blue(name1))} vs ${pc.bold(pc.green(name2))}`);
      console.log(
        `Position: ${c1.position || "?"} vs ${c2.position || "?"} | Element: ${c1.element || "?"} vs ${c2.element || "?"}`,
      );
      console.log(`Rarity:   ${c1.rarity || "?"} vs ${c2.rarity || "?"} | ID: ${c1.charaId} vs ${c2.charaId}`);

      const s1 = c1.stats?.lv99 ?? c1.stats?.lv1;
      const s2 = c2.stats?.lv99 ?? c2.stats?.lv1;

      if (s1 && s2) {
        console.log(pc.bold("\n📈 Stats (Lv 99):"));
        const statsKeys: Array<{ key: keyof typeof s1; label: string }> = [
          { key: "kick", label: "Kick" },
          { key: "control", label: "Control" },
          { key: "technique", label: "Technique" },
          { key: "physical", label: "Physical" },
          { key: "agility", label: "Agility" },
          { key: "intelligence", label: "Intelligence" },
        ];

        for (const stat of statsKeys) {
          const v1 = Number(s1[stat.key]) || 0;
          const v2 = Number(s2[stat.key]) || 0;
          const diff = v1 - v2;
          const diffStr = diff > 0 ? pc.green(` (+${diff})`) : diff < 0 ? pc.red(` (${diff})`) : pc.dim(" (=)");
          console.log(`  ${stat.label.padEnd(14)}: ${String(v1).padStart(4)} vs ${String(v2).padEnd(4)}${diffStr}`);
        }
      }
    });
}

// === DIALOGUE COMMAND ===
export function registerDialogueCommand(program: Command) {
  program
    .command("dialogue [query]")
    .description("Search in game dialogues and chronicles")
    .option("-s, --speaker <speaker>", "Filter by speaker name")
    .option("-l, --limit <number>", "Limit results", "10")
    .action(async (query?: string, options?: { speaker?: string; limit?: string }) => {
      const limit = parseInt(options?.limit ?? "10", 10) || 10;
      const q = query?.trim() ?? "";
      console.log(pc.cyan(`Searching dialogues for "${q}"...`));

      try {
        const { searchText } = await import("./game-text/index.js");
        const results = await searchText(q, "fr", limit);
        if (results.length === 0) {
          console.log(pc.yellow("No game texts found matching query in the selected source."));
          return;
        }

        console.log(pc.bold(`\nFound ${results.length} dialogue entries:`));
        for (const r of results) {
          console.log(pc.dim("--------------------------------"));
          console.log(`${pc.magenta(r.category || "dialogue")} [${pc.dim(r.hashId)}]:`);
          console.log(`  ${pc.white(r.value)}`);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(pc.dim(`Game text query failed: ${message}`));
        console.log(pc.yellow("Select the game installation with --game-dir or NIE_GAME_DIR."));
      }
    });
}

// === RANDOM TEAM COMMAND ===
export function registerRandomTeamCommand(program: Command) {
  program
    .command("random-team")
    .description("Generate a randomized 16-player squad")
    .option("-f, --formation <formation>", "Tactical layout (e.g. 4-4-2, 4-3-3, 3-5-2)", "4-4-2")
    .option("-e, --element <element>", "Filter players by element (Fire, Forest, Mountain, Wind)")
    .action(async (options: { formation?: string; element?: string }) => {
      const service = await createInagleService();
      let pool = service.characters.baseCharacters();

      if (options.element) {
        const el = options.element.toLowerCase();
        pool = pool.filter((c: any) => c.element?.toLowerCase() === el);
      }

      if (pool.length < 16) {
        console.log(pc.red(`Not enough characters in pool (${pool.length}) to form a full team.`));
        return;
      }

      // Shuffle pool
      const shuffled = [...pool].sort(() => Math.random() - 0.5);

      const gks = shuffled.filter((c: any) => c.position === "GK");
      const dfs = shuffled.filter((c: any) => c.position === "DF");
      const mfs = shuffled.filter((c: any) => c.position === "MF");
      const fws = shuffled.filter((c: any) => c.position === "FW");

      const pick = (arr: any[], count: number) => arr.slice(0, count);

      const starterGK = pick(gks, 1);
      const starterDF = pick(dfs, 4);
      const starterMF = pick(mfs, 4);
      const starterFW = pick(fws, 2);

      const starters = [...starterGK, ...starterDF, ...starterMF, ...starterFW];
      const usedIds = new Set(starters.map(c => c.charaId));
      const bench = shuffled.filter(c => !usedIds.has(c.charaId)).slice(0, 5);

      console.log(pc.bold(pc.cyan(`\n⚽ Random Team Selection (${options.formation ?? "4-4-2"})`)));
      console.log(pc.dim("============================================================"));
      console.log(pc.bold(pc.yellow("Starting XI:")));
      starters.forEach((c, idx) => {
        const name = c.names?.fr || c.names?.en || c.charaId;
        console.log(
          `  ${pc.dim(String(idx + 1).padStart(2, "0"))}. [${pc.green(c.position.padEnd(2))}] ${pc.bold(name)} ${pc.dim(`(${c.element}, ${c.rarity})`)}`,
        );
      });

      console.log(pc.bold(pc.yellow("\nSubstitutes:")));
      bench.forEach((c, idx) => {
        const name = c.names?.fr || c.names?.en || c.charaId;
        console.log(
          `  ${pc.dim(String(idx + 12).padStart(2, "0"))}. [${pc.dim(c.position.padEnd(2))}] ${name} ${pc.dim(`(${c.element})`)}`,
        );
      });
    });
}

// === TEAM BUILDER COMMAND ===
export function registerTeamBuilderCommand(program: Command) {
  const tb = program.command("team-builder").description("Team builder utilities (encode/decode codes)");

  tb.command("decode <code>")
    .description("Decode a shareable team code")
    .action(async (code: string) => {
      const { decodeTeamCode } = await import("./game/team-code.js");
      const decoded = decodeTeamCode(code);
      console.log(pc.bold(pc.cyan("\nDecoded Team Code:")));
      console.log(`Formation ID: ${pc.bold(decoded.formationId)}`);
      console.log(`Total Slots:  ${pc.bold(decoded.slots.length)}`);
      for (const slot of decoded.slots) {
        console.log(`  ${pc.blue(slot.slot)}: ${pc.yellow(slot.charaId)}`);
      }
    });

  tb.command("encode <formationId> [playerSlots...]")
    .description("Encode a squad into a shareable team code (format: slot:charaId ...)")
    .action(async (formationId: string, playerSlots: string[]) => {
      const { encodeTeamCode } = await import("./game/team-code.js");
      const slots = playerSlots.map(ps => {
        const [slot, charaId] = ps.split(":");
        return { slot: slot || "field-0", charaId: charaId || "" };
      });
      const code = encodeTeamCode(formationId, slots);
      console.log(pc.bold(pc.cyan("\nGenerated Team Code:")));
      console.log(pc.green(code));
    });
}
