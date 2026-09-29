/**
 * enrich-sagas.ts — Donne une image à chaque saga (db_sagas.image était 0/29).
 *
 * Stratégie license-safe et sans réseau : chaque saga pointe vers l'image (déjà
 * self-hostée dans ./assets/dbz/characters/) de son personnage/antagoniste
 * emblématique. Idempotent : ne touche que les sagas dont image IS NULL.
 *
 * Usage : bun apps/bot/scripts/enrich-sagas.ts
 * Après : sudo systemctl restart shenron (vide le cache wiki) puis
 *         sudo systemctl start shenron-neon-sync.service (resync Neon).
 */
import { Database } from "bun:sqlite";

// saga.id → db_characters.id du perso emblématique de l'arc
const SAGA_TO_CHARACTER: Record<number, number> = {
	1: 1, // Pilaf → Goku (enfant)
	2: 17, // 22e Tenkaichi → Master Roshi
	3: 1, // Red Ribbon → Goku
	4: 1, // Uranai Baba → Goku
	5: 12, // 22e Tournoi → Tenshinhan
	6: 3, // Piccolo Daimaô → Piccolo
	7: 1, // 23e Tenkaichi → Goku
	8: 2, // Saiyans → Vegeta
	9: 5, // Namek / Freezer → Freezer
	10: 16, // Garlic Jr / Trunks → Trunks
	11: 22, // Cyborgs → Android 17
	12: 9, // Cell → Cellula
	13: 10, // Great Saiyaman → Gohan
	14: 32, // Majin Boo → Majin Buu
	15: 1, // Black Star DB (GT) → Goku
	16: 2, // Baby (GT) → Vegeta
	17: 22, // Super C-17 (GT) → Android 17
	18: 1, // Dragons Maléfiques (GT) → Goku
	19: 33, // Battle of Gods → Bills
	20: 5, // Résurrection F → Freezer
	21: 2, // Univers 6 → Vegeta
	22: 16, // Trunks du Futur → Trunks
	23: 38, // Tournoi du Pouvoir → Jiren
	24: 68, // Broly (film) → Broly
	25: 1, // Moro → Goku
	26: 2, // Granolah → Vegeta
	27: 10, // Super Hero → Gohan
	28: 5, // Black Frieza → Freezer
	29: 1, // Daima → Goku
};

if (!Bun.env.ALLOW_SQLITE_WIKI_WRITE) {
	console.error(
		"Wiki migre sur Neon (source de verite) -- ecriture SQLite ecrasee par le reverse-sync. Edite via le site, ou ALLOW_SQLITE_WIKI_WRITE=1 pour forcer."
	);
	process.exit(1);
}
const db = new Database("apps/bot/data/bot.db");
db.exec("PRAGMA busy_timeout = 5000;");

const charImg = new Map<number, string>();
for (const r of db
	.query("SELECT id, image FROM db_characters WHERE image IS NOT NULL")
	.all() as Array<{ id: number; image: string }>) {
	charImg.set(r.id, r.image);
}

let updated = 0;
let skipped = 0;
const missing: number[] = [];

const tx = db.transaction(() => {
	const sagas = db.query("SELECT id, name, image FROM db_sagas ORDER BY id").all() as Array<{
		id: number;
		name: string;
		image: string | null;
	}>;
	for (const s of sagas) {
		if (s.image) {
			skipped++;
			continue;
		}
		const charId = SAGA_TO_CHARACTER[s.id];
		const img = charId != null ? charImg.get(charId) : undefined;
		if (!img) {
			missing.push(s.id);
			continue;
		}
		db.query("UPDATE db_sagas SET image = ? WHERE id = ?").run(img, s.id);
		updated++;
		console.log(`  saga#${s.id} «${s.name}» → ${img}`);
	}
});
tx();

console.log(
	`\n✓ sagas mises à jour : ${updated} · déjà avec image : ${skipped}` +
		(missing.length ? ` · sans mapping : ${missing.join(", ")}` : "")
);
db.close();
