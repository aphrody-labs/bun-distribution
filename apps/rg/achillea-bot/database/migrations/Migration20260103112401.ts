import { Migration } from "@mikro-orm/migrations";

export class Migration20260103112401 extends Migration {

  async up() {
    this.addSql(`create table "lobby_match" ("id" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "lobby_id" int not null, "game_number" int not null, "score_team1" int not null default 0, "score_team2" int not null default 0, "map_name" varchar(255) null);`);

    this.addSql(`alter table "lobby_match" add constraint "lobby_match_lobby_id_foreign" foreign key ("lobby_id") references "lobby" ("id") on update cascade;`);
  }

  async down() {
    this.addSql(`drop table if exists "lobby_match" cascade;`);
  }

}
