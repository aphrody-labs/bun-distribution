import { Migration } from "@mikro-orm/migrations";

export class Migration20260212120216 extends Migration {

  async up() {
    this.addSql('ALTER TABLE "lobby" DROP CONSTRAINT IF EXISTS "lobby_bracket_match_id_unique";');
    this.addSql('DROP INDEX IF EXISTS "lobby_bracket_match_id_unique";');
    this.addSql('DROP INDEX IF EXISTS "lobby_bracket_match_id_index";');

    // 2. Conversion des colonnes vers INTEGER (avec conversion explicite)
    // On traite tournament_participant
    this.addSql('ALTER TABLE "tournament_participant" ALTER COLUMN "bracket_participant_id" TYPE integer USING (bracket_participant_id::integer);');
    this.addSql('ALTER TABLE "tournament_participant" ALTER COLUMN "seed" TYPE integer USING (seed::integer);');

    // On traite lobby
    this.addSql('ALTER TABLE "lobby" ALTER COLUMN "bracket_match_id" TYPE integer USING (bracket_match_id::integer);');

    // 3. On recrée l'index unique partiel
    // C'est la meilleure solution : il garantit l'unicité des IDs de match,
    // mais autorise autant de NULL que tu veux pour les lobbies hors-tournoi.
    this.addSql('CREATE UNIQUE INDEX "lobby_bracket_match_id_unique" ON "lobby" ("bracket_match_id") WHERE bracket_match_id IS NOT NULL;');
  }

  async down() {
// Optionnel : chemin inverse si besoin de rollback
    this.addSql('ALTER TABLE "lobby" DROP INDEX IF EXISTS "lobby_bracket_match_id_unique";');
    this.addSql('ALTER TABLE "tournament_participant" ALTER COLUMN "bracket_participant_id" TYPE varchar(255);');
  }

}
