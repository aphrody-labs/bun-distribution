import { Migration } from "@mikro-orm/migrations";

export class Migration20251217234848 extends Migration {

  async up() {
    this.addSql(`alter table "organization_manager" drop constraint "organization_manager_organization_id_foreign";`);

    this.addSql(`alter table "organization_manager" add constraint "organization_manager_organization_id_foreign" foreign key ("organization_id") references "organization" ("id") on update cascade;`);
  }

  async down() {
    this.addSql(`alter table "organization_manager" drop constraint "organization_manager_organization_id_foreign";`);

    this.addSql(`alter table "organization_manager" add constraint "organization_manager_organization_id_foreign" foreign key ("organization_id") references "clan" ("id") on update cascade;`);
  }

}
