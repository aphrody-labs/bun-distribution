/**
 * Vérifie que tous les @Slash / @SlashOption / @SlashChoice / @SlashGroup
 * du repo respectent les contraintes Discord :
 *
 *   • name        : 1-32   (a-z 0-9 _ -)
 *   • description : 1-100
 *   • choices.name: 1-100
 *
 * Échec → exit code 1 (deploy-shenron.sh refuse de redémarrer).
 *
 * Évite le crash boot vu le 2026-04-30 sur `/bingo` (description 138 chars).
 *
 * Stratégie : parse les fichiers `src/commands/**` à coups de regex pas-trop-fragiles.
 * Pas un AST parser complet — on cible les usages canoniques. Faux positifs ok,
 * faux négatifs interdits (= validation laxiste plutôt que builder cassé).
 */
import { Glob } from "bun";

const NAME_MAX = 32;
const DESC_MAX = 100;
const CHOICE_NAME_MAX = 100;

interface Issue {
	file: string;
	line: number;
	rule: string;
	message: string;
}

const issues: Issue[] = [];

function lineNumber(src: string, idx: number): number {
	let line = 1;
	for (let i = 0; i < idx && i < src.length; i++) {
		if (src[i] === "\n") line++;
	}
	return line;
}

/**
 * Extrait la valeur d'un literal (template ou string) dans un objet.
 * Ne supporte pas l'eval d'expressions runtime — substitue les variables
 * `${ZENI_*}`, `${MAX_*}` etc. avec un placeholder de 5 caractères pour
 * approximer la longueur. Si une interpolation est plus longue, on signalera
 * un faux positif inoffensif (mieux que false negative).
 */
function approxStringLength(literal: string): number {
	// `${...}` → on remplace par "00000" (5 chars conservateur)
	const stripped = literal.replace(/\$\{[^}]*\}/g, "00000");
	return stripped.length;
}

function extractStringLiteral(raw: string): string | null {
	// Garde 1 niveau de simple quote / double quote / backtick
	const trimmed = raw.trim();
	const first = trimmed[0];
	if (first !== '"' && first !== "'" && first !== "`") return null;
	const last = trimmed[trimmed.length - 1];
	if (last !== first) return null;
	return trimmed.slice(1, -1);
}

function checkObjectFields(file: string, src: string, decoratorName: string) {
	// Match `@Decorator({ ... })` (multiline, jusqu'au `})` fermant superficiel)
	const decoratorRegex = new RegExp(`@${decoratorName}\\s*\\(\\s*\\{`, "g");
	let m: RegExpExecArray | null;
	while ((m = decoratorRegex.exec(src)) !== null) {
		const startIdx = m.index;
		const objStart = src.indexOf("{", startIdx) + 1;
		// Trouve le `}` fermant en équilibrant les accolades (gère les nested objects)
		let depth = 1;
		let i = objStart;
		while (i < src.length && depth > 0) {
			const c = src[i];
			if (c === "{") depth++;
			else if (c === "}") depth--;
			i++;
		}
		const objBody = src.slice(objStart, i - 1);

		// Extrait name / description (premier match — naïf mais ok pour nos usages)
		const nameMatch = objBody.match(/\bname\s*:\s*([^,\n}]+)/);
		const descMatch = objBody.match(/\bdescription\s*:\s*([^,\n}]+)/);

		if (nameMatch) {
			const lit = extractStringLiteral(nameMatch[1]!);
			if (lit !== null) {
				const len = approxStringLength(lit);
				if (len > NAME_MAX) {
					issues.push({
						file,
						line: lineNumber(src, startIdx),
						rule: `${decoratorName}.name`,
						message: `name "${lit}" = ${len} chars (max ${NAME_MAX})`,
					});
				}
				if (
					decoratorName === "Slash" ||
					decoratorName === "SlashOption" ||
					decoratorName === "SlashGroup"
				) {
					if (!/^[\w-]+$/.test(lit)) {
						issues.push({
							file,
							line: lineNumber(src, startIdx),
							rule: `${decoratorName}.name`,
							message: `name "${lit}" doit être [a-zA-Z0-9_-]+`,
						});
					}
				}
			}
		}
		if (descMatch) {
			const lit = extractStringLiteral(descMatch[1]!);
			if (lit !== null) {
				const len = approxStringLength(lit);
				const max = decoratorName === "SlashChoice" ? CHOICE_NAME_MAX : DESC_MAX;
				if (len > max) {
					issues.push({
						file,
						line: lineNumber(src, startIdx),
						rule: `${decoratorName}.description`,
						message: `description = ${len} chars (max ${max}) — "${lit.slice(0, 60)}..."`,
					});
				}
			}
		}
	}
}

const root = `${process.cwd()}/src`;
const glob = new Glob("commands/**/*.ts");

let scanned = 0;
for await (const file of glob.scan({ cwd: root })) {
	const path = `${root}/${file}`;
	const src = await Bun.file(path).text();
	scanned++;
	for (const dec of ["Slash", "SlashOption", "SlashChoice", "SlashGroup"]) {
		checkObjectFields(path, src, dec);
	}
}

if (issues.length === 0) {
	console.log(`✓ check-slash-lengths — ${scanned} fichier(s) scanné(s), aucun problème.`);
	process.exit(0);
}

console.error(`✗ check-slash-lengths — ${issues.length} problème(s) :`);
for (const i of issues) {
	console.error(`  ${i.file}:${i.line}  [${i.rule}]  ${i.message}`);
}
console.error("\nDiscord refusera ces commandes au boot du bot. Fix puis relance.");
process.exit(1);
