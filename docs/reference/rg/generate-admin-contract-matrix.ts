/** Source inventory only: `bun docs/generate-admin-contract-matrix.ts`. Never reads data or env. */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = join(import.meta.dir, "..");
const adminApi = join(root, "apps/website/src/app/api/admin");
const adminPages = join(root, "apps/website/src/app/admin");
const dbTypes = join(root, "packages/db/src/types.gen.ts");
const achilleaTypes = join(root, "packages/db/src/schema/achillea.ts");

async function files(dir: string): Promise<string[]> {
	const result: string[] = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) result.push(...await files(full));
		else result.push(full);
	}
	return result;
}

const csv = (cells: string[]) => cells.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",");
const repoPath = (path: string) => relative(root, path).replaceAll("\\", "/");
const pageFiles = (await files(adminPages)).filter((path) => path.endsWith("page.tsx"));
const apiFiles = (await files(adminApi)).filter((path) => path.endsWith("route.ts"));
const pageSources = await Promise.all(pageFiles.map(async (path) => ({ path, source: await readFile(path, "utf8") })));

const apiRows = [csv(["route", "methods", "guard_source", "linked_admin_page", "contract_imports", "source_file"])];
for (const file of apiFiles.toSorted()) {
	const source = await readFile(file, "utf8");
	const route = `/api/admin/${relative(adminApi, file).replaceAll("\\", "/").replace(/\/route\.ts$/, "")}`;
	const methods = [...source.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)].map((match) => match[1]!);
	const guard = ["requireApiPatreonCreator", "requirePatreonCreator", "requireApiAdmin", "requireAdmin", "CLAUDE_API_KEY", "ADMIN_API_KEY"]
		.filter((name) => source.includes(name)).join("+") || "manual_review";
	const page = pageSources.filter(({ source: pageSource }) => pageSource.includes(route) || pageSource.includes(route.replace("/api/admin", "")))
		.map(({ path }) => repoPath(path)).join(";");
	const imports = [...source.matchAll(/from ["'](@rosegriffon\/[^"']+)["']/g)].map((match) => match[1]!).toSorted().join(";");
	apiRows.push(csv([route, methods.join("+"), guard, page || "unmapped", imports, repoPath(file)]));
}
await writeFile(join(import.meta.dir, "admin-api-matrix.csv"), apiRows.join("\n") + "\n");

const generated = await readFile(dbTypes, "utf8");
const tableBlock = generated.split("    Tables: {")[1]?.split("    Views: {")[0];
if (!tableBlock) throw new Error("public Tables block not found in types.gen.ts");
const tableNames = [...tableBlock.matchAll(/^      ([a-z_][a-z_0-9]*): \{$/gm)].map((match) => match[1]!);
const dbRows = [csv(["schema", "table", "admin_pages_referencing_table", "editor_reference", "type_source"])];
for (const name of tableNames) {
	const pages = pageSources.filter(({ source }) => source.includes(`.from("${name}")`) || source.includes(`.from('${name}')`))
		.map(({ path }) => repoPath(path));
	const editor = (await readFile(join(adminPages, "database/actions.ts"), "utf8")).includes(`"${name}"`)
		? "database/actions.ts allowlist" : "unmapped";
	dbRows.push(csv(["public", name, pages.join(";") || "unmapped", editor, repoPath(dbTypes)]));
}
const achilleaSource = await readFile(achilleaTypes, "utf8");
const achilleaBlock = achilleaSource.split("export interface AchilleaTables {")[1]?.split("\n}")[0];
if (!achilleaBlock) throw new Error("AchilleaTables block not found");
const achilleaNames = [...achilleaBlock.matchAll(/^\s*([a-z_][a-z_0-9]*): [A-Za-z]+Table;/gm)].map((match) => match[1]!);
for (const name of achilleaNames) {
	const pages = pageSources.filter(({ source }) => source.includes(`achillea.${name}`) || source.includes(`"${name}"`))
		.map(({ path }) => repoPath(path));
	dbRows.push(csv(["achillea", name, pages.join(";") || "unmapped", "unmapped", repoPath(achilleaTypes)]));
}
await writeFile(join(import.meta.dir, "admin-db-matrix.csv"), dbRows.join("\n") + "\n");
console.log(`Wrote ${apiFiles.length} API routes, ${tableNames.length} public and ${achilleaNames.length} Achillea typed tables; source references only.`);
