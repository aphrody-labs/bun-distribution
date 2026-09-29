/**
 * i18n audit — counts user-facing strings written in the source instead of
 * `messages/*.json`, per file, and writes the backlog to docs/i18n-backlog.md.
 *
 *   bun apps/shenron/site/scripts/i18n-audit.ts            # report
 *   bun apps/shenron/site/scripts/i18n-audit.ts --json     # machine-readable
 *
 * Heuristics, on purpose simple and explicit: JSX text nodes with a French
 * word (accented letter or a common French word), and string props that carry
 * copy (`title`, `description`, `label`, `placeholder`, `aria-label`,
 * `standfirst`, `kicker`, `hint`, `blurb`). Code comments are skipped.
 */
import { Glob } from "bun";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const SRC = path.join(ROOT, "src");
const FRENCH = /[àâçéèêëîïôûùüÿœ]|\b(le|la|les|des|une|est|sont|pour|avec|dans|sur|pas|plus|tous|toutes|aucun|aucune|voir|lire|ouvrir)\b/i;
const JSX_TEXT = />([^<>{}\n]*[\p{L}][^<>{}\n]*)</gu;
const PROP = /\b(title|description|standfirst|kicker|label|placeholder|aria-label|hint|blurb|quoi|lede|eyebrow|subtitle)=\s*"([^"]{3,})"/g;

const json = process.argv.includes("--json");
const glob = new Glob("**/*.{tsx,ts}");
const rows: { file: string; count: number; samples: string[] }[] = [];
for await (const rel of glob.scan({ cwd: SRC })) {
	if (rel.includes("/admin/") || rel.endsWith(".test.ts") || rel.includes("/i18n/")) continue;
	const text = (await Bun.file(path.join(SRC, rel)).text()).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
	const found = new Set<string>();
	for (const m of text.matchAll(JSX_TEXT)) if (FRENCH.test(m[1]!)) found.add(m[1]!.trim());
	for (const m of text.matchAll(PROP)) if (FRENCH.test(m[2]!)) found.add(m[2]!.trim());
	if (found.size) rows.push({ file: rel, count: found.size, samples: [...found].slice(0, 3) });
}
rows.sort((a, b) => b.count - a.count);
const total = rows.reduce((n, r) => n + r.count, 0);
if (json) {
	console.log(JSON.stringify({ total, files: rows.length, rows }, null, 2));
} else {
	const lines = [
		"# i18n — textes d'interface encore écrits en dur (hors /admin)",
		"",
		`Mesuré par \`bun apps/shenron/site/scripts/i18n-audit.ts\`. Total : ${total} chaînes dans ${rows.length} fichiers.`,
		"",
		"| Fichier | Chaînes | Exemples |",
		"|---|---:|---|",
		...rows.map((r) => `| \`${r.file}\` | ${r.count} | ${r.samples.map((s) => s.replace(/\|/g, "\\|")).join(" · ")} |`),
		"",
	];
	await Bun.write(path.join(ROOT, "../../docs/i18n-backlog.md"), lines.join("\n"));
	console.log(`${total} chaînes dans ${rows.length} fichiers → docs/i18n-backlog.md`);
}
