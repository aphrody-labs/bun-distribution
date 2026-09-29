#!/usr/bin/env bun
/**
 * Audit structurel de la spécification de refonte.
 *
 * Cet audit est volontairement sans accès réseau ni base : il vérifie que chaque
 * itération conserve les contrats écrits dans le document d'architecture. Il est
 * donc sûr à relancer en CI ou depuis la boucle A2A.
 */

const DOC = "docs/architecture-refonte-wiki-dragon-ball.md";
const text = await Bun.file(DOC).text();
const jsonOut =
	process.argv.indexOf("--json-out") >= 0
		? process.argv[process.argv.indexOf("--json-out") + 1]
		: undefined;

type Check = { id: string; ok: boolean; detail: string };

const checks: Check[] = [];
const requireText = (id: string, needle: string, detail: string) => {
	checks.push({ id, ok: text.includes(needle), detail });
};

for (const phase of [
	"## Phase 1 — schéma de données et ontologie",
	"## Phase 2 — architecture de l’information et UX",
	"## Phase 3 — recherche et facettes",
	"## Phase 4 — cas limites et audit de rupture",
	"## Phase 5 — plan d’exécution et critères de validation",
]) {
	requireText(`phase:${phase.slice(9, 20)}`, phase, `Section présente : ${phase}`);
}

for (const [index, contract] of [
	"create table if not exists bot.media_works",
	"create table if not exists bot.media_page_refs",
	"create table if not exists bot.narrative_events",
	"create table if not exists bot.contributors",
	"media_page_refs",
	"visible = false",
	"status_code=301",
	"GET /api/wiki/events",
	"GET /api/wiki/timelines",
	"GET /api/wiki/contributors",
	"PG_SOURCES",
	"media_works: renduMediaWorks",
	"narrative_timelines: renduNarrativeTimelines",
	"rag-build.ts",
	"rollback",
	"shenron-observability/v1",
	"siteHealth",
	"optionalServices",
	"shenron_refonte_copy_",
	"second passage sans erreur",
	"pg_dump | pg_restore",
	"11 tables restaurées",
	"git rev-list --count origin/main..HEAD",
	"le dépôt est synchronisé",
	"SITE_AUDIT_MAX_PAGES",
	"pagesDiscovered",
	"assetsDiscovered",
	"Recall@5",
	"172/172 sources présentes",
	"0 vecteur orphelin",
	"59 995 chunks",
	"/api/wiki/media",
	"bot.db_media_publications",
	"public.url_redirects",
	"UnifiedVolumeReader",
	"Registre historique de validation — relevés datés du 2026-09-19",
	"Suite complète — limites constatées",
	"catalogue DB/DBFC/DBS",
	"REFONTE_AUDIT_RUNTIME",
	"REFONTE_AUDIT_API",
	"apiExitCode",
	"runtime.json",
	"failureStreak",
	"ADMIN_REQUIRED",
	"REFONTE_AUDIT_FULL",
	"fullSuiteExitCode",
	"REFONTE_AUDIT_ONCE",
	"REFONTE_AUDIT_SERIAL",
	"serialValidation",
	"REFONTE_AUDIT_HISTORY",
	"journal JSONL",
	"Boucle de travail continue (itération contrôlée)",
	"Critères d’arrêt global",
].entries()) {
	requireText(`contract:${index + 1}`, contract, `Contrat présent : ${contract}`);
}

for (const artifact of [
	"apps/site/src/db/migrations/0017_wiki_media_publications.sql",
	"apps/bot/src/db/migrations/0017_refonte_media_publications.sql",
	"apps/site/src/db/migrations/0018_media_works_and_editions.sql",
	"apps/bot/src/db/migrations/0018_refonte_media_works_editions.sql",
	"apps/site/src/db/migrations/0019_narrative_graph_and_contributors.sql",
	"apps/bot/src/db/migrations/0019_refonte_narrative_contributors.sql",
	"apps/site/src/components/manga/UnifiedVolumeReader.tsx",
	"apps/site/tests/databook-features.test.ts",
	"apps/site/tests/manga-integration.test.ts",
	"apps/site/src/app/wiki/staff/page.tsx",
	"apps/site/tests/page-banners-wiring.test.ts",
	"apps/site/src/app/api/wiki/media/route.ts",
	"apps/site/tests/wiki-media-api.test.ts",
	"apps/site/src/app/api/wiki/timelines/route.ts",
	"apps/site/tests/wiki-timelines-api.test.ts",
	"apps/site/src/app/api/wiki/contributors/route.ts",
	"apps/site/tests/wiki-contributors-api.test.ts",
	"apps/site/src/app/api/wiki/events/route.ts",
	"apps/site/tests/wiki-events-api.test.ts",
	"packages/pipeline/scripts/_rag-sources-pg.ts",
	"apps/site/tests/rag-refonte-sources.test.ts",
	"apps/site/tests/refonte-migrations.test.ts",
	"scripts/ops/build-site-external.ts",
	"scripts/ops/package-site-artifact.ts",
	"scripts/ops/observability-snapshot.ts",
	"scripts/ops/audit-refonte-api-latency.ts",
	"scripts/ops/audit-live-site-assets.ts",
	"packages/pipeline/scripts/rag-resync-entites.ts",
	".github/workflows/site-artifact.yml",
	"docs/architecture-refonte-runtime-report.schema.json",
]) {
	checks.push({
		id: `artifact:${artifact.split("/").at(-1)}`,
		ok: await Bun.file(artifact).exists(),
		detail: `Artefact d’implémentation présent : ${artifact}`,
	});
}

let runtimeSchemaValid = false;
try {
	const schema = JSON.parse(
		await Bun.file("docs/architecture-refonte-runtime-report.schema.json").text()
	) as {
		required?: unknown;
		properties?: Record<string, unknown>;
	};
	const required = Array.isArray(schema.required) ? schema.required : [];
	runtimeSchemaValid = [
		"generatedAt",
		"structuralExitCode",
		"runtimeExitCode",
		"apiExitCode",
		"fullSuiteExitCode",
		"serialValidation",
		"status",
		"failureStreak",
		"escalation",
	].every((key) => required.includes(key) && schema.properties?.[key]);
} catch {
	runtimeSchemaValid = false;
}
checks.push({
	id: "schema:runtime-report",
	ok: runtimeSchemaValid,
	detail: "JSON Schema du rapport runtime lisible et complet",
});

const siteMigration = await Bun.file(
	"apps/site/src/db/migrations/0017_wiki_media_publications.sql"
).text();
for (const [index, clause] of [
	"CREATE TABLE IF NOT EXISTS bot.db_media_publications",
	"CREATE TABLE IF NOT EXISTS public.url_redirects",
	"ON CONFLICT (legacy_databook_id)",
	"UPDATE bot.db_databooks SET visible = false",
	"status_code, visible",
].entries()) {
	checks.push({
		id: `migration:site-${index + 1}`,
		ok: siteMigration.includes(clause),
		detail: `Clause SQL présente : ${clause}`,
	});
}

const assetTable =
	text.match(/create table if not exists bot\.media_page_assets \(([\s\S]*?)\n\);/i)?.[1] ?? "";
const pageRefTable =
	text.match(/create table if not exists bot\.media_page_refs \(([\s\S]*?)\n\);/i)?.[1] ?? "";
checks.push({
	id: "schema:asset-reference-separation",
	ok:
		Boolean(assetTable) &&
		Boolean(pageRefTable) &&
		!/chapter_id\s+bigint/i.test(assetTable) &&
		/asset_id\s+bigint/i.test(pageRefTable),
	detail: "media_page_assets physique séparé de media_page_refs ordonnée",
});

for (const [index, migrationPath] of [
	"apps/site/src/db/migrations/0018_media_works_and_editions.sql",
	"apps/bot/src/db/migrations/0018_refonte_media_works_editions.sql",
	"apps/site/src/db/migrations/0019_narrative_graph_and_contributors.sql",
	"apps/bot/src/db/migrations/0019_refonte_narrative_contributors.sql",
].entries()) {
	const migration = await Bun.file(migrationPath).text();
	const hasIdempotentCreates =
		/CREATE TABLE IF NOT EXISTS/i.test(migration) &&
		/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS/i.test(migration);
	const hasPhysicalDelete = /\bDELETE\s+FROM\b/i.test(migration);
	checks.push({
		id: `migration:refonte-${index + 1}`,
		ok: hasIdempotentCreates && !hasPhysicalDelete,
		detail: `${migrationPath} : tables/index idempotents et aucune suppression physique`,
	});
}

// Les blocs SQL sont les seuls endroits où une suppression physique serait exécutable.
const sqlBlocks = [...text.matchAll(/```sql\n([\s\S]*?)```/g)].map((match) => match[1] ?? "");
const physicalDelete = sqlBlocks.some((block) => /\bdelete\s+from\b/i.test(block));
checks.push({
	id: "safety:no-physical-delete",
	ok: !physicalDelete,
	detail: physicalDelete
		? "DELETE FROM détecté dans un bloc SQL"
		: "Aucun DELETE FROM dans les blocs SQL",
});

const passed = checks.filter((check) => check.ok).length;
const failed = checks.length - passed;
const report = {
	artifact: DOC,
	generatedAt: new Date().toISOString(),
	status: failed === 0 ? "FAIT" : "INCOMPLET",
	checks: { total: checks.length, passed, failed },
	results: checks,
};

if (jsonOut && !jsonOut.startsWith("-")) {
	await Bun.write(jsonOut, `${JSON.stringify(report, null, 2)}\n`);
	console.log(`\nRapport JSON écrit : ${jsonOut}`);
}

console.log(JSON.stringify(report, null, 2));
console.log(`\n### Audit architecture — ${report.status}`);
console.log(`\n- Artefact : \`${DOC}\``);
console.log(`- Contrôles : ${passed}/${checks.length} réussis`);
for (const check of checks)
	console.log(`- ${check.ok ? "[x]" : "[ ]"} ${check.id} — ${check.detail}`);

if (failed > 0) process.exit(1);
