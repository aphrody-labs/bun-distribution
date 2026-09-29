import { Migration } from "@mikro-orm/migrations";

/**
 * Refonte des paliers ranked Achillea (remplace le barème Valorant anglais).
 *
 * 1. Re-seed `rank` avec les 11 paliers FR (Fer → Légendaire, Rubis inclus),
 *    seuils décidés produit + gradients 5 couleurs (source : « code gradients »).
 *    Les keys FR matchent les images `apps/achillea-web/public/ranks/{fer,bronze,argent,
 *    or,platine,diamant,emeraude,rubis,divin,supernova,legendaire}.webp`.
 * 2. Reset complet de la ladder : tout le monde repart de 0 (elo + stats),
 *    cohérent avec le passage de baseRating 1000 → 0.
 * 3. Aligne le baseRating des saisons existantes sur 0.
 */
export class Migration20260609000000 extends Migration {
	async up() {
		// 1. Paliers FR (DELETE plutôt que TRUNCATE RESTART IDENTITY : le rôle
		// applicatif Supabase n'est pas owner de la séquence rank_id_seq, et l'id
		// n'est référencé nulle part — les tiers sont dérivés de l'elo).
		this.addSql(`DELETE FROM rank;`);
		this.addSql(`
			INSERT INTO rank (key, min_elo, max_elo, emoji_id, emoji_key, gradient) VALUES
				('Fer',        0,    49,   '', '', '{"#959595","#919191","#D4D4D4","#494949","#797979"}'),
				('Bronze',     50,   199,  '', '', '{"#B17253","#8C4A34","#CB8254","#6D483D","#8C503C"}'),
				('Argent',     200,  399,  '', '', '{"#7FACB8","#546B71","#90AEB6","#6E8389","#CBE0E6"}'),
				('Or',         400,  599,  '', '', '{"#C2AD88","#76685B","#7D735D","#554F42","#898063"}'),
				('Platine',    600,  799,  '', '', '{"#897E8B","#8A8297","#5B5663","#898195","#C5B4C9"}'),
				('Diamant',    800,  999,  '', '', '{"#88F6FF","#547E8E","#5DB0D0","#C3FBFF","#5CD2DC"}'),
				('Émeraude',   1000, 1199, '', '', '{"#2D925C","#23574A","#3F9C85","#54D38F","#25896F"}'),
				('Rubis',      1200, 1399, '', '', '{"#FF5648","#F5232A","#FF8485","#A6181E","#D0313A"}'),
				('Divin',      1400, 1699, '', '', '{"#7EDCB5","#B4FFE7","#4BC2B1","#368464","#3F9E9D"}'),
				('Supernova',  1700, 2099, '', '', '{"#F010FF","#F66AFF","#D700AF","#930E9C","#C731B2"}'),
				('Légendaire', 2100, 99999,'', '', '{"#FFA910","#E18204","#FFE150","#A15B0E","#DAB338"}');
		`);

		// 2. Reset complet de la ladder (tout le monde à 0)
		this.addSql(`
			UPDATE user_elo
			SET elo = 0, peak_rating = 0, games_played = 0, wins = 0, losses = 0, updated_at = now();
		`);

		// 3. baseRating des saisons → 0
		this.addSql(`
			UPDATE season
			SET config = jsonb_set(config, '{baseRating}', '0'::jsonb)
			WHERE config IS NOT NULL;
		`);
	}

	async down() {
		// Restaure l'ancien barème Valorant anglais (le reset de user_elo est irréversible).
		this.addSql(`DELETE FROM rank;`);
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
