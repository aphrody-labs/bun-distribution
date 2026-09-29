/**
 * Garde d'écriture du wiki éditorial dans le SQLite LOCAL.
 *
 * Neon `bot.*` est la SOURCE DE VÉRITÉ du wiki éditorial ; le SQLite du bot est
 * un replica de lecture rafraîchi par le reverse-sync (`sync-neon-to-sqlite.ts`,
 * timer toutes les 15 min). Tout seed/ingest qui écrit l'éditorial ICI serait
 * SILENCIEUSEMENT ÉCRASÉ au prochain pull → travail perdu + faux succès.
 *
 * Importer pour le side-effect EN TÊTE de tout script qui écrit les tables
 * éditoriales du SQLite : `import "~/db/wiki-write-guard";` (scripts) ou
 * `import "./wiki-write-guard";` (src/db).
 *
 * IMPORTANT — exemption runtime : le bot (`src/index.ts`) importe dynamiquement
 * `runWikiSeed` pour l'auto-seed self-healing au boot (DB vide après perte de
 * bot.db). On ne doit JAMAIS `process.exit(1)` dans ce cas (le top-level échappe
 * au try/catch de l'auto-seed → crash-loop). La garde ne s'enforce donc que
 * quand l'ENTRY POINT est un script de seed/ingest lancé directement, jamais
 * quand c'est le runtime du bot.
 *
 * Override (risqué, perdu au prochain pull) : `ALLOW_SQLITE_WIKI_WRITE=1`.
 * Le seed/ingest éditorial doit désormais cibler Neon, pas ce replica.
 */
const entry = Bun.main ?? process.argv[1] ?? "";
// Runtime du bot = .../src/index.ts → exempté (auto-seed légitime, idempotent).
const isBotRuntime = /(?:^|\/)(?:src\/)?index\.ts$/.test(entry);

if (!isBotRuntime && !Bun.env.ALLOW_SQLITE_WIKI_WRITE) {
	console.error(
		"✗ Wiki migré sur Neon (source de vérité). Ce script écrit le SQLite local,\n" +
			"  écrasé par le reverse-sync Neon→SQLite. Seed/ingest éditorial doit cibler Neon.\n" +
			"  Override (risqué, perdu au prochain pull) : ALLOW_SQLITE_WIKI_WRITE=1."
	);
	process.exit(1);
}
