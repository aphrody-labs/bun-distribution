import { Migration } from "@mikro-orm/migrations";

export class Migration20251109132142 extends Migration {

  async up() {
    this.addSql(`create table "contract" ("id" serial primary key, "created_at" timestamptz not null, "updated_at" timestamptz not null, "name" varchar(255) not null, "type" smallint not null, "termination_date" timestamptz not null, "auto_renewal" boolean not null, "creator_id" int null);`);

    this.addSql(`alter table "contract" add constraint "contract_creator_id_foreign" foreign key ("creator_id") references "clan" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "clan_invite" add column "accepted" boolean not null default false;`);
  }

  async down() {
    this.addSql(`drop table if exists "contract" cascade;`);

    this.addSql(`alter table "clan_invite" drop column "accepted";`);
  }

}
