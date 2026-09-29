import { Migration } from "@mikro-orm/migrations";

export class Migration20251121155212 extends Migration {

	async up() {
		this.addSql(`
      alter table "clan_invite"
        add column "last_notified_at" timestamptz not null default now();
    `)
	}

	async down() {
		this.addSql(`alter table "clan_invite" drop column "last_notified_at";`)
	}

}
