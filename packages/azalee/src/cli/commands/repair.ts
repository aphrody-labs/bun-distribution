/**
 * `azalee repair` — remet la base locale en état d'être lue par le CLI :
 * désactive RLS et redonne les privilèges sur les tables `inagle_*`.
 */

import type { Command } from "commander";
import { getInagleDatabaseURL } from "@rosegriffon/db/pg";

import { colors, createPgClient, errorMessage } from "../context";

export function registerRepairCommand(program: Command): void {
  program
    .command("repair")
    .description("Diagnostique et répare la base de données locale (RLS, privilèges)")
    .action(async () => {
      console.log(`${colors.cyan}Diagnostics et réparation de la base de données...${colors.reset}`);
      let dbUrl: string;
      try {
        dbUrl = getInagleDatabaseURL();
      } catch {
        console.error(`${colors.red}INAGLE_DATABASE_URL is required for the local database repair.${colors.reset}`);
        return;
      }
      if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(dbUrl).hostname)) {
        console.error(
          "Database repair is restricted to a loopback PostgreSQL host; managed database privileges are owned by deployment migrations.",
        );
        return;
      }

      console.log("Connecting to the explicitly configured local gameplay database.");
      const client = createPgClient(dbUrl);
      try {
        await client.connect();

        const { rows: tables } = await client.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables
					 WHERE table_schema = 'public' AND table_name LIKE 'inagle_%'`,
        );

        console.log(`  Trouvé ${tables.length} tables Inagle. Désactivation RLS et attribution des droits...`);

        for (const t of tables) {
          const tableName = t.table_name;
          try {
            await client.query(`ALTER TABLE "${tableName}" DISABLE ROW LEVEL SECURITY;`);
            await client.query(`GRANT ALL PRIVILEGES ON TABLE "${tableName}" TO ubuntu;`);
            console.log(`  ✓ Table "${tableName}" réparée.`);
          } catch (e) {
            throw new Error(`Unable to repair gameplay table ${tableName}: ${errorMessage(e)}`);
          }
        }

        console.log(`\n${colors.bold}${colors.green}Base de données locale réparée avec succès !${colors.reset}`);
      } catch (e) {
        console.error(`${colors.red}Erreur de connexion / privilèges : ${errorMessage(e)}${colors.reset}`);
      } finally {
        await client.end();
      }
    });
}
