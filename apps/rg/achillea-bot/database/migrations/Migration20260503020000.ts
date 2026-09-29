import { Migration } from "@mikro-orm/migrations";

/**
 * Re-seed table `rank` avec des keys FR (label affiché).
 * Les fichiers webp côté frontend restent en EN — mapping FR→EN dans
 * `apps/achillea-web/src/app/core/helpers/misc.ts:getEloImagePath`.
 */
export class Migration20260503020000 extends Migration {
	async up() {
		this.addSql(`TRUNCATE TABLE rank RESTART IDENTITY CASCADE;`);
		this.addSql(`
			INSERT INTO rank (key, min_elo, max_elo, emoji_id, emoji_key, gradient) VALUES
				('Non classé', 0,    49,   '', '', '{"#959595","#cccccc"}'),
				('Bronze',     50,   199,  '', '', '{"#B17253","#d4936d"}'),
				('Argent',     200,  399,  '', '', '{"#959595","#c0c0c0"}'),
				('Or',         400,  699,  '', '', '{"#FFC107","#FFE082"}'),
				('Diamant',    700,  999,  '', '', '{"#88F6FF","#B3E5FC"}'),
				('Émeraude',   1000, 1399, '', '', '{"#2D925C","#66BB6A"}'),
				('Immortel',   1400, 1899, '', '', '{"#FF5648","#E91E63"}'),
				('Radieux',    1900, 9999, '', '', '{"#FFA910","#FFD700"}');
		`);
	}
}
