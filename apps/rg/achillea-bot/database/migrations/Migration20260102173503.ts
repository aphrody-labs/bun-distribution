import { Migration } from "@mikro-orm/migrations";

export class Migration20260102173503 extends Migration {

  async up() {
    this.addSql(`create table "tournament_participant" ("id" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "tournament_id" int not null, "user_id" varchar(255) not null, "challonge_participant_id" varchar(255) null, "seed" int null, "has_checked_in" boolean not null default false);`);
    this.addSql(`alter table "tournament_participant" add constraint "tournament_participant_challonge_participant_id_unique" unique ("challonge_participant_id");`);

    this.addSql(`alter table "tournament_participant" add constraint "tournament_participant_tournament_id_foreign" foreign key ("tournament_id") references "event" ("id") on update cascade;`);
    this.addSql(`alter table "tournament_participant" add constraint "tournament_participant_user_id_foreign" foreign key ("user_id") references "user" ("id") on update cascade;`);
  }

  async down() {
    this.addSql(`drop table if exists "tournament_participant" cascade;`);
  }

}
