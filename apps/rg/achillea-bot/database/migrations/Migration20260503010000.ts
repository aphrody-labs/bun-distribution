import { Migration } from "@mikro-orm/migrations";

/**
 * Re-seed table `rank` avec des keys anglaises qui matchent les images
 * frontend (`apps/achillea-web/public/ranks/{bronze,silver,gold,diamond,
 * emerald,immortal,radiant,unranked}.webp`).
 *
 * Avant : keys FR (Fer, Argent, Or, Platine, Diamant, Émeraude, Rubis,
 * Divin, Supernova, Légendaire) → frontend cherche `fer.webp` etc. qui
 * n'existent pas → fallback HTML SPA → image cassée.
 */
export class Migration20260503010000 extends Migration {
	async up() {
		this.addSql(`TRUNCATE TABLE rank RESTART IDENTITY CASCADE;`);
		this.addSql(`
			INSERT INTO rank (key, min_elo, max_elo, emoji_id, emoji_key, gradient) VALUES
				('Unranked', 0,    49,   '', '', '{"#959595","#cccccc"}'),
				('Bronze',   50,   199,  '', '', '{"#B17253","#d4936d"}'),
				('Silver',   200,  399,  '', '', '{"#959595","#c0c0c0"}'),
				('Gold',     400,  699,  '', '', '{"#FFC107","#FFE082"}'),
				('Diamond',  700,  999,  '', '', '{"#88F6FF","#B3E5FC"}'),
				('Emerald',  1000, 1399, '', '', '{"#2D925C","#66BB6A"}'),
				('Immortal', 1400, 1899, '', '', '{"#FF5648","#E91E63"}'),
				('Radiant',  1900, 9999, '', '', '{"#FFA910","#FFD700"}');
		`);
	}
}
