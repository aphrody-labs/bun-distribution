import { Migration } from "@mikro-orm/migrations";

export class Migration20251217234217 extends Migration {

  async up() {
    this.addSql(`alter table "organization_validation" drop constraint "organization_validation_organization_id_foreign";`);

    this.addSql(`alter table "organization" alter column "id" type int using ("id"::int);`);
    this.addSql(`create sequence if not exists "organization_id_seq";`);
    this.addSql(`select setval('organization_id_seq', (select max("id") from "organization"));`);
    this.addSql(`alter table "organization" alter column "id" set default nextval('organization_id_seq');`);

    this.addSql(`alter table "organization_validation" alter column "organization_id" type int using ("organization_id"::int);`);
    this.addSql(`alter table "organization_validation" add constraint "organization_validation_organization_id_foreign" foreign key ("organization_id") references "organization" ("id") on update cascade on delete cascade;`);
  }

  async down() {
    this.addSql(`alter table "organization_validation" drop constraint "organization_validation_organization_id_foreign";`);

    this.addSql(`alter table "organization" alter column "id" type varchar(255) using ("id"::varchar(255));`);
    this.addSql(`alter table "organization" alter column "id" drop default;`);

    this.addSql(`alter table "organization_validation" alter column "organization_id" type varchar(255) using ("organization_id"::varchar(255));`);
    this.addSql(`alter table "organization_validation" add constraint "organization_validation_organization_id_foreign" foreign key ("organization_id") references "organization" ("id") on update cascade on delete cascade;`);
  }

}
