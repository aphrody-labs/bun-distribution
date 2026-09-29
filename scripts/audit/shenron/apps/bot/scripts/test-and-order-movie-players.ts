import os from "node:os";
import { join } from "node:path";
import postgres from "postgres";

const bxcPath = process.env.BXC_DIR ?? join(os.homedir(), "bxc");
const { VoiranimeScraper } = await import(join(bxcPath, "src/scrapers/voiranime.ts"));

const NEON_URL = process.env.DATABASE_URL;
if (!NEON_URL) {
	console.error("✗ DATABASE_URL (Neon) requis.");
	process.exit(1);
}

const sql = postgres(NEON_URL, { max: 5, prepare: false });

type Player = {
	name: string;
	provider: string;
	embedUrl: string;
	lang?: "vf" | "vostfr";
};

const rows = (await sql`
	SELECT id, title, players FROM bot.db_movies
	WHERE players IS NOT NULL
`) as unknown as { id: number; title: string; players: Player[] }[];

console.log(`Auditing and reordering players for ${rows.length} movies...`);

const va = new VoiranimeScraper();

for (const row of rows) {
	console.log(`\nFilm: ${row.title} (ID: ${row.id})`);
	const players = row.players;

	const classA: Player[] = []; // Working HLS
	const classB: Player[] = []; // Working MP4
	const classC: Player[] = []; // Failed / unverified

	for (const p of players) {
		console.log(`  Scrape/Test: ${p.name} (${p.provider})...`);
		try {
			const s = await va.resolveSource(p);
			if ((s.type === "hls" || s.type === "mp4") && s.url) {
				const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), 4000);
				let testOk = false;
				let testStatus = 0;
				try {
					const testRes = await fetch(s.url, {
						headers: {
							Range: "bytes=0-1024",
							// eslint-disable-next-line unicorn/no-useless-fallback-in-spread
							...(s.headers ?? {}),
						},
						signal: controller.signal,
					});
					testOk = testRes.ok;
					testStatus = testRes.status;
				} catch {
					// Ignoré
				} finally {
					clearTimeout(timeoutId);
				}

				if (testOk) {
					console.log(`    -> VALID (${s.type})`);
					if (s.type === "hls") {
						classA.push(p);
					} else {
						classB.push(p);
					}
				} else {
					console.log(`    -> INVALID / OFFLINE (HTTP ${testStatus})`);
					classC.push(p);
				}
			} else {
				console.log(`    -> FAILED (${s.error ?? "format"})`);
				classC.push(p);
			}
		} catch (err) {
			console.log(`    -> ERROR: ${String(err)}`);
			classC.push(p);
		}
	}

	const reordered = [...classA, ...classB, ...classC];

	await sql`
		UPDATE bot.db_movies
		SET players = ${sql.json(reordered)}
		WHERE id = ${row.id}
	`;
	console.log(
		`  -> Reordered: ${classA.length} HLS, ${classB.length} MP4, ${classC.length} offline.`
	);
}

await va.close();
await sql.end();
console.log("\n✓ All movie players reordered successfully.");
