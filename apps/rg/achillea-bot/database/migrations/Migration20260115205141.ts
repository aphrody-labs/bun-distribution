import { Migration } from "@mikro-orm/migrations";

export class Migration20260115205141 extends Migration {

  async up() {
    this.addSql(`alter table "event" drop constraint if exists "event_tournament_type_check";`);
    this.addSql(`alter table "event" drop constraint if exists "event_group_stage_type_check";`);

    this.addSql(`alter table "event" add constraint "event_tournament_type_check" check("tournament_type" in ('round_robin', 'single_elimination', 'double_elimination'));`);
    this.addSql(`alter table "event" add constraint "event_group_stage_type_check" check("group_stage_type" in ('round_robin', 'single_elimination', 'double_elimination'));`);
  }

  async down() {
    this.addSql(`alter table "event" drop constraint if exists "event_tournament_type_check";`);
    this.addSql(`alter table "event" drop constraint if exists "event_group_stage_type_check";`);

    this.addSql(`alter table "event" add constraint "event_tournament_type_check" check("tournament_type" in ('double elimination', 'round robin', 'single elimination'));`);
    this.addSql(`alter table "event" add constraint "event_group_stage_type_check" check("group_stage_type" in ('double elimination', 'round robin', 'single elimination'));`);
  }

}
