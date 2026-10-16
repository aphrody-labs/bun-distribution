/** `azalee dialogue` — recherche SQL dans les dialogues narratifs et de chronique. */

import type { Command } from "commander";
import { createInagleSql } from "@rosegriffon/db/inagle-sql";
import type { Database } from "@rosegriffon/db/schema";

import {
  colors,
  errorMessage,
  getOrReadInput,
  reportError,
  restoreLogs,
  suppressLogs,
} from "../context";
import type { DialogueOptions } from "../types";

/** Réplique retenue, telle qu'affichée / sérialisée. */
interface DialogueMatch {
  eventId: string;
  dialogueId: string;
  speaker?: string;
  text: { fr?: string; en?: string; ja?: string } | undefined;
}

export function registerDialogueCommand(program: Command): void {
  program
    .command("dialogue [query]")
    .description("Recherche dans les dialogues narratifs et de chronique du jeu")
    .option("-s, --speaker <speaker>", "Filtre par locuteur/personnage")
    .option("-j, --json", "Format de sortie en JSON brute")
    .option("-l, --limit <limit>", "Nombre de résultats max", "10")
    .action(async (query: string | undefined, options: DialogueOptions) => {
      suppressLogs(!!options.json);
      try {
        const inputQuery = await getOrReadInput(query);
        const speakerQuery = options.speaker;
        const limitVal = parseInt(options.limit, 10) || 10;

        const matches: DialogueMatch[] = [];

        const textQ = inputQuery.toLowerCase().trim();
        const speakerQ = speakerQuery?.toLowerCase().trim();
        const db = createInagleSql<Database>();
        const dialogueRows = await db
          .selectFrom("inagle_game_text")
          .select(["hash_id", "locale", "category", "value"])
          .where((eb) =>
            eb.or([
              eb("category", "ilike", "%dialog%"),
              eb("category", "ilike", "%event%"),
              eb("category", "ilike", "%story%"),
              eb("category", "ilike", "%map%"),
              eb("category", "ilike", "%phase%"),
            ]),
          )
          .$if(Boolean(textQ), (qb) => qb.where("value", "ilike", `%${textQ}%`))
          .$if(Boolean(speakerQ), (qb) => qb.where("value", "ilike", `%${speakerQ}%`))
          .orderBy("hash_id", "asc")
          .limit(Math.max(limitVal * 3, 3))
          .execute();

        const grouped = new Map<string, DialogueMatch>();
        for (const row of dialogueRows) {
          const current: DialogueMatch = grouped.get(row.hash_id) ?? {
            eventId: row.category,
            dialogueId: row.hash_id,
            text: {},
          };
          if (row.locale === "fr" || row.locale === "en" || row.locale === "ja")
            current.text = { ...current.text, [row.locale]: row.value };
          current.speaker ??= speakerQ;
          grouped.set(row.hash_id, current);
        }
        matches.push(...grouped.values());
        matches.splice(limitVal);

        restoreLogs(!!options.json);
        if (options.json) {
          console.log(JSON.stringify(matches, null, 2));
        } else {
          console.log(
            `${colors.cyan}Recherche de dialogues pour : "${textQ}"${speakerQ ? ` (par ${speakerQ})` : ""}...${colors.reset}\n`,
          );
          if (matches.length === 0) {
            console.log(`${colors.yellow}Aucun dialogue trouvé.${colors.reset}`);
            return;
          }

          for (const m of matches) {
            console.log(
              `[${colors.bold}${colors.green}${m.speaker}${colors.reset}] (${colors.yellow}${m.eventId}${colors.reset} | ${colors.yellow}${m.dialogueId}${colors.reset})`,
            );
            if (m.text?.fr) console.log(`  FR: ${m.text.fr}`);
            if (m.text?.en) console.log(`  EN: ${m.text.en}`);
            if (m.text?.ja) console.log(`  JA: ${m.text.ja}`);
            console.log("─".repeat(80));
          }
        }
      } catch (e) {
        reportError(
          options.json,
          errorMessage(e),
          `${colors.red}Erreur dialogue : ${errorMessage(e)}${colors.reset}`,
        );
      }
    });
}
