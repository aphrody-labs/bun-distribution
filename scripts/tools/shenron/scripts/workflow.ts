#!/usr/bin/env bun
/**
 * Campagne multi-agents Dragon Ball strictement locale et factuelle.
 *
 * Ordre fixe : inventaire -> databooks -> manga -> base -> contre-vérification
 * -> propositions wiki -> revue Shenron. Les agents sont éphémères, en lecture
 * seule, sans web, et leurs sorties restent sous var/ (gitignoré). Ce workflow
 * ne dépose rien : les propositions acceptées passent ensuite par les scripts
 * Shenron versionnés et leur simulation explicite.
 *
 * Usage :
 *   bun scripts/workflow.ts --dry-run
 *   bun scripts/workflow.ts --concurrency 4
 *   bun scripts/workflow.ts --concurrency 4 --apply
 *   bun scripts/workflow.ts --run-id <id> --resume
 *   bun scripts/workflow.ts --only inventory --limit 1
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { classerDefaut } from "../../../../apps/shenron/site/src/lib/databooks-defauts";

const ROOT = resolve(import.meta.dir, "..");
const MODEL = "gpt-5.6-luna";
const REASONING_EFFORT = "low";
const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 8;
const RUNTIME_ROOT = join(ROOT, "var", "dragon-ball-workflow");
const COORD_DIR = join(ROOT, ".coord");

type StageId =
	| "inventory"
	| "databooks"
	| "databook-review"
	| "manga"
	| "database"
	| "crosscheck"
	| "wiki"
	| "shenron-review";

interface Task {
	id: string;
	mission: string;
	images?: string[];
}

interface Stage {
	id: StageId;
	label: string;
	tasks: Task[];
}

const shards = (prefix: string, count: number, mission: (index: number) => string): Task[] =>
	Array.from({ length: count }, (_, index) => ({
		id: `${prefix}-${String(index + 1).padStart(2, "0")}`,
		mission: mission(index),
	}));

const STAGES: Stage[] = [
	{
		id: "inventory",
		label: "Inventaire local",
		tasks: [
			{
				id: "inventory-databooks",
				mission:
					"Inventorie le corpus local de databooks, ses manifestes, ses transcriptions et ses files de relecture. Mesure les volumes et signale les trous; ne juge aucun fait Dragon Ball à cette étape.",
			},
			{
				id: "inventory-manga",
				mission:
					"Inventorie les pages et métadonnées manga locales, leurs identifiants stables, leur couverture par tome/chapitre et les textes réellement interrogeables. Utilise apps/bot/data/manga-visual-map.json pour l'association image/OCR et apps/bot/data/bot.db pour les compteurs; signale leur absence au lieu de conclure que le corpus est vide.",
			},
			{
				id: "inventory-database",
				mission:
					"Inventorie en lecture seule les tables Dragon Ball, leurs champs éditoriaux, les révisions et les gardes de synchronisation. Distingue PostgreSQL source de vérité et SQLite réplica.",
			},
			{
				id: "inventory-wiki",
				mission:
					"Inventorie les catégories et champs du wiki, les sections existantes et les lacunes mesurables. Le wiki est une cible à auditer, jamais une preuve autonome.",
			},
		],
	},
	{
		id: "databooks",
		label: "Preuves databooks",
		tasks: shards(
			"databooks",
			8,
			(index) =>
				`Analyse le shard ${index + 1}/8 des databooks locaux (partition stable par identifiant de databook modulo 8). Extrais seulement des faits explicitement lisibles dans les transcriptions, avec ouvrage et numéro de planche. Marque les OCR ambigus et les caractères illisibles; ne complète rien.`
		),
	},
	{
		id: "databook-review",
		label: "Relecture visuelle des OCR douteux",
		tasks: [],
	},
	{
		id: "manga",
		label: "Preuves manga",
		tasks: [],
	},
	{
		id: "database",
		label: "Audit de la base",
		tasks: [
			{
				id: "database-characters",
				mission:
					"Mesure les champs vides, incohérences de forme et cibles éditoriales pour les personnages et leurs variantes. Ne crée aucun fait.",
			},
			{
				id: "database-world",
				mission:
					"Mesure les lacunes des planètes, races, sagas et arcs. Relie seulement les cibles aux preuves déjà extraites.",
			},
			{
				id: "database-techniques",
				mission:
					"Mesure les lacunes des techniques et transformations, notamment les graphies japonaises. Rejette toute déduction phonétique non attestée.",
			},
			{
				id: "database-media",
				mission:
					"Mesure les lacunes des épisodes, films, jeux et databooks sans mélanger leurs niveaux de canon avec le manga.",
			},
			{
				id: "database-sections",
				mission:
					"Audite les sections wiki et leurs sources; repère les textes sans provenance et les champs proposés mais non rendus.",
			},
			{
				id: "database-revisions",
				mission:
					"Audite les garde-fous de révision, de synchronisation et de dépôt. Identifie la forme exacte d'une proposition réversible sans exécuter d'écriture.",
			},
		],
	},
	{
		id: "crosscheck",
		label: "Contre-vérification",
		tasks: shards(
			"crosscheck",
			8,
			(index) =>
				`Contre-vérifie le shard ${index + 1}/8 des preuves produites aux étapes databooks et manga. Rouvre les références locales citées, rejette les références introuvables, sépare les divergences et classe uniquement comme vérifié ce que la source montre réellement.`
		),
	},
	{
		id: "wiki",
		label: "Propositions wiki",
		tasks: shards(
			"wiki",
			8,
			(index) =>
				`Prépare le shard ${index + 1}/8 de propositions wiki à partir des preuves contre-vérifiées et des lacunes de base. Chaque valeur doit citer ses références manga/databook locales. Si la preuve est insuffisante, propose explicitement leave_empty. N'écris ni fichier éditorial ni base.`
		),
	},
	{
		id: "shenron-review",
		label: "Revue finale Shenron",
		tasks: shards(
			"shenron-review",
			4,
			(index) =>
				`Joue le validateur indépendant Shenron ${index + 1}/4. Relis toutes les propositions wiki, rouvre chaque référence primaire locale, puis recopie exactement chaque proposition avec decision=accept ou reject. N'accepte rien sur la seule foi des autres agents. Le dépôt n'est autorisé ensuite que par consensus exact d'au moins 3 validateurs sur 4.`
		),
	},
];

const RESULT_SCHEMA = {
	$schema: "http://json-schema.org/draft-07/schema#",
	type: "object",
	additionalProperties: false,
	required: [
		"status",
		"stage",
		"task_id",
		"summary",
		"metrics",
		"evidence",
		"findings",
		"proposals",
		"blocked_reasons",
		"next_tasks",
	],
	properties: {
		status: { type: "string", enum: ["ok", "partial", "blocked"] },
		stage: { type: "string" },
		task_id: { type: "string" },
		summary: { type: "string", maxLength: 1_000 },
		metrics: {
			type: "array",
			maxItems: 20,
			items: {
				type: "object",
				additionalProperties: false,
				required: ["name", "value"],
				properties: { name: { type: "string" }, value: { type: "string" } },
			},
		},
		evidence: {
			type: "array",
			maxItems: 30,
			items: {
				type: "object",
				additionalProperties: false,
				required: ["claim", "source_kind", "source_ref", "excerpt", "verified"],
				properties: {
					claim: { type: "string", maxLength: 600 },
					source_kind: { type: "string", enum: ["manga", "databook", "local_db", "wiki_target"] },
					source_ref: { type: "string" },
					excerpt: { type: "string", maxLength: 240 },
					verified: { type: "boolean" },
				},
			},
		},
		findings: {
			type: "array",
			maxItems: 30,
			items: {
				type: "object",
				additionalProperties: false,
				required: ["severity", "target", "observation", "source_refs"],
				properties: {
					severity: { type: "string", enum: ["info", "warning", "error"] },
					target: { type: "string" },
					observation: { type: "string" },
					source_refs: { type: "array", items: { type: "string" } },
				},
			},
		},
		proposals: {
			type: "array",
			maxItems: 100,
			items: {
				type: "object",
				additionalProperties: false,
				required: [
					"target",
					"field",
					"value",
					"source_refs",
					"decision",
					"operation",
					"section_label",
				],
				properties: {
					target: { type: "string" },
					field: { type: "string" },
					value: { type: "string", maxLength: 40_000 },
					source_refs: {
						type: "array",
						maxItems: 12,
						items: { type: "string", maxLength: 400 },
					},
					decision: {
						type: "string",
						enum: ["propose", "accept", "leave_empty", "reject"],
					},
					operation: {
						type: "string",
						enum: ["fill_empty", "correct_existing"],
					},
					section_label: { type: "string" },
				},
			},
		},
		blocked_reasons: { type: "array", maxItems: 20, items: { type: "string" } },
		next_tasks: { type: "array", maxItems: 20, items: { type: "string" } },
	},
} as const;

function option(name: string): string | undefined {
	const index = Bun.argv.indexOf(`--${name}`);
	return index >= 0 ? Bun.argv[index + 1] : undefined;
}

function flag(name: string): boolean {
	return Bun.argv.includes(`--${name}`);
}

function positiveInteger(
	value: string | undefined,
	fallback: number,
	max = Number.MAX_SAFE_INTEGER
): number {
	const parsed = Number(value ?? fallback);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
		throw new Error(`valeur invalide: ${value ?? ""} (entier 1..${max} attendu)`);
	}
	return parsed;
}

const timestamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const runId = option("run-id") ?? timestamp();
if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(runId)) {
	throw new Error("--run-id invalide (1 à 80 caractères sûrs, sans chemin)");
}
const runDir = join(RUNTIME_ROOT, runId);
const schemaPath = join(runDir, "result.schema.json");
const concurrency = positiveInteger(option("concurrency"), DEFAULT_CONCURRENCY, MAX_CONCURRENCY);
const taskLimit = option("limit") ? positiveInteger(option("limit"), 1) : Number.MAX_SAFE_INTEGER;
const only = option("only") as StageId | undefined;
const from = option("from") as StageId | undefined;
const until = option("until") as StageId | undefined;
const stageIds = new Set<StageId>(STAGES.map((stage) => stage.id));
for (const [name, value] of [
	["only", only],
	["from", from],
	["until", until],
] as const) {
	if (value && !stageIds.has(value)) throw new Error(`--${name} inconnu: ${value}`);
}
const dryRun = flag("dry-run");
const resume = flag("resume");
const noA2a = flag("no-a2a");
const apply = flag("apply");

interface OcrReviewPage {
	databaseId: number;
	page: number;
	image: string;
	defect: string;
	current: string;
}

interface MangaVisualPage {
	planche: number;
	image: string;
	text: string;
	lineCount: number;
}

interface MangaVisualTome {
	series: string;
	tome: string;
	pages: MangaVisualPage[];
}

async function mangaTasks(): Promise<Task[]> {
	const mapPath = join(ROOT, "apps", "bot", "data", "manga-visual-map.json");
	if (!existsSync(mapPath)) return [];
	const map = JSON.parse(await readFile(mapPath, "utf8")) as { tomes?: MangaVisualTome[] };
	const tomes = map.tomes ?? [];
	return Array.from({ length: 8 }, (_, shardIndex) => {
		const shardTomes = tomes.filter((_, index) => index % 8 === shardIndex);
		const selected: { tome: MangaVisualTome; page: MangaVisualPage; image: string }[] = [];
		for (const tome of shardTomes) {
			const candidates = tome.pages.filter((page) => {
				const image = join(ROOT, "apps", "bot", ...page.image.split("/"));
				return page.text.trim().length >= 80 && page.lineCount >= 5 && existsSync(image);
			});
			if (candidates.length === 0) continue;
			const page = candidates[Math.floor(candidates.length / 2)]!;
			selected.push({
				tome,
				page,
				image: join(ROOT, "apps", "bot", ...page.image.split("/")),
			});
			if (selected.length === 3) break;
		}
		const details = selected
			.map(
				({ tome, page, image }, index) =>
					`- image jointe ${index + 1}: ${tome.series}/${tome.tome}/planche ${page.planche} · ${relativePath(image)} · OCR indicatif non probant: ${JSON.stringify(page.text.slice(0, 500))}`
			)
			.join("\n");
		return {
			id: `manga-${String(shardIndex + 1).padStart(2, "0")}`,
			images: selected.map(({ image }) => image),
			mission: `Analyse le shard ${shardIndex + 1}/8 du manga local, partition stable sur l'ordre des tomes de apps/bot/data/manga-visual-map.json modulo 8. Les ${selected.length} planches attachées sont les seules preuves primaires de cette tâche: ouvre-les réellement via leur pièce jointe visuelle et compare chaque bloc retenu à l'OCR indicatif. Ne formule aucun fait que l'image ne confirme pas lisiblement. Cite série+tome+planche; ajoute le chapitre seulement si la planche l'atteste explicitement. Si une image ou un texte reste ambigu, marque-le non vérifié au lieu de compléter de mémoire.\n${details}`,
		};
	});
}

async function databookReviewTasks(): Promise<Task[]> {
	const source = join(ROOT, "data", "sj-ocr");
	if (!existsSync(source)) return [];
	const pages: OcrReviewPage[] = [];
	const lots = (await readdir(source, { withFileTypes: true }))
		.filter((entry) => entry.isDirectory() && /^lot-\d+$/.test(entry.name))
		.map((entry) => entry.name)
		.toSorted();
	for (const lot of lots) {
		const lotDir = join(source, lot);
		const manifestPath = join(lotDir, "manifeste.json");
		const resultsPath = join(lotDir, "resultats.jsonl");
		if (!existsSync(manifestPath) || !existsSync(resultsPath)) continue;
		const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
			entrees?: { databookId?: number; page?: number; image?: string }[];
		};
		const entries = new Map(
			(manifest.entrees ?? []).map((entry) => [basename(entry.image ?? "").toLowerCase(), entry])
		);
		const unique = new Map<
			string,
			{ image?: string; text?: { kind?: string; markdown?: string } }
		>();
		for (const line of (await readFile(resultsPath, "utf8")).split(/\r?\n/)) {
			if (!line.trim()) continue;
			try {
				const parsed = JSON.parse(line) as {
					image?: string;
					text?: { kind?: string; markdown?: string };
				};
				const key = basename(parsed.image ?? "").toLowerCase();
				if (key) unique.set(key, parsed);
			} catch {
				// La ligne illisible restera un échec de l'action OCR; pas de preuve exploitable ici.
			}
		}
		for (const [key, result] of unique) {
			const entry = entries.get(key);
			const current = result.text?.kind === "text" ? (result.text.markdown ?? "").trim() : "";
			const defect = current ? classerDefaut(current) : "vide";
			if (defect === null || !entry?.databookId || !entry.page) continue;
			const image = join(lotDir, "images", basename(result.image ?? key));
			if (!existsSync(image)) continue;
			pages.push({
				databaseId: Number(entry.databookId),
				page: Number(entry.page),
				image,
				defect,
				current,
			});
		}
	}

	const tasks: Task[] = [];
	// Trois scans gardent la requête sous le seuil tarifaire de 272K jetons
	// observé avec quatre pages haute définition, sans sacrifier leur résolution.
	for (let index = 0; index < pages.length; index += 3) {
		const group = pages.slice(index, index + 3);
		const details = group
			.map(
				(page) =>
					`- db_databooks#${page.databaseId} pages#${page.page} · scan ${relativePath(page.image)} · défaut ${page.defect} · OCR actuel: ${JSON.stringify(page.current.slice(0, 500))}`
			)
			.join("\n");
		tasks.push({
			id: `databook-review-${String(tasks.length + 1).padStart(4, "0")}`,
			images: group.map((page) => page.image),
			mission: `Ouvre visuellement les ${group.length} scan(s) attaché(s), un par un, à taille lisible. Relis dans l'ordre japonais et compare à l'OCR actuel. Une proposition remplacera la transcription ENTIÈRE de la planche: elle doit donc être exhaustive, pas un résumé ni une sélection de blocs. Produis exactement une proposition par scan: target=db_databooks#<id>, field=pages#<page>, value=markdown japonais intégral corrigé, source_refs=[chemin exact du scan], decision=propose, operation=correct_existing si l'OCR actuel est non vide sinon fill_empty, section_label="". Si le moindre texte imprimé reste illisible, trop petit ou omis, decision=reject; n'invente aucun glyphe et ne propose jamais une transcription partielle. Si la planche est réellement sans texte, decision=leave_empty et value="".\n${details}`,
		});
	}
	return tasks;
}

const reviewStage = STAGES.find((stage) => stage.id === "databook-review");
if (reviewStage) reviewStage.tasks = await databookReviewTasks();
const mangaStage = STAGES.find((stage) => stage.id === "manga");
if (mangaStage) mangaStage.tasks = await mangaTasks();

function stageIndex(id: StageId | undefined, fallback: number): number {
	if (!id) return fallback;
	const index = STAGES.findIndex((stage) => stage.id === id);
	if (index < 0) throw new Error(`étape inconnue: ${id}`);
	return index;
}

const selectedStages = only
	? [STAGES[stageIndex(only, 0)]!]
	: STAGES.slice(stageIndex(from, 0), stageIndex(until, STAGES.length - 1) + 1);

function relativePath(path: string): string {
	return relative(ROOT, path).replaceAll("\\", "/");
}

async function priorOutputs(stage: Stage, task: Task): Promise<string[]> {
	const dependencyMap: Record<StageId, StageId[]> = {
		inventory: [],
		databooks: ["inventory"],
		"databook-review": [],
		manga: ["inventory"],
		database: ["inventory"],
		crosscheck: ["databooks", "manga"],
		wiki: ["database", "crosscheck"],
		"shenron-review": ["wiki"],
	};
	const dependencies = new Set(dependencyMap[stage.id]);
	const shard = /-(\d+)$/.exec(task.id)?.[1];
	const paths: string[] = [];
	for (const prior of STAGES.filter((candidate) => dependencies.has(candidate.id))) {
		for (const priorTask of prior.tasks) {
			const priorShard = /-(\d+)$/.exec(priorTask.id)?.[1];
			const shardedDependency = ["databooks", "manga", "crosscheck"].includes(prior.id);
			if (shardedDependency && shard && priorShard !== shard) continue;
			const path = join(runDir, prior.id, `${priorTask.id}.json`);
			if (existsSync(path)) paths.push(relativePath(path));
		}
	}
	return paths;
}

function promptFor(stage: Stage, task: Task, inputs: string[]): string {
	const inputBlock = inputs.length
		? `\nSorties validables des étapes antérieures (lis uniquement celles utiles):\n${inputs.map((path) => `- ${path}`).join("\n")}`
		: "";
	const reviewRule =
		stage.id === "shenron-review"
			? "\nRègle de revue: recopie sans reformulation target, field, value, source_refs, operation et section_label; remplace seulement decision par accept ou reject. Une acceptation exige une référence primaire locale rouverte et une cible exacte."
			: stage.id === "wiki"
				? '\nFormat des cibles wiki: target=db_<table>#<id> avec field parmi description, article, synopsis ou name_ja et section_label=""; ou target=section:<type>:<id>:<clé> avec field=body et section_label exact. operation=fill_empty ne vise qu\'un champ vide; correct_existing exige une contradiction primaire explicite.'
				: "";
	const localCorpus = [
		"inventory",
		"manga",
		"database",
		"crosscheck",
		"wiki",
		"shenron-review",
	].includes(stage.id)
		? `
Ressources locales vérifiées disponibles:
- apps/bot/data/bot.db: réplica SQLite cohérent de production, à ouvrir en lecture seule avec bun:sqlite;
- apps/bot/data/manga-visual-map.json: association série/tome/planche entre OCR et image manga;
- apps/bot/assets/manga: images primaires à rouvrir visuellement avant d'attester un texte.`
		: "";
	const doctrines = ["docs/wiki-editorial.md"];
	if (["databooks", "databook-review", "crosscheck"].includes(stage.id)) {
		doctrines.push(
			"docs/japonais.md",
			"docs/databooks-doctrine.md",
			"docs/databooks-transcription.md"
		);
	}
	return `Tu es le sous-agent ${task.id} de la campagne Shenron. Modèle imposé: ${MODEL}, reasoning effort ${REASONING_EFFORT}.

Avant l'analyse, lis entièrement uniquement ces doctrines locales et applique-les:
${doctrines.map((path) => `- ${path}`).join("\n")}

Politique de sources non négociable:
1. Travaille hors ligne. Aucun web, Fandom, Wikipédia, AniList, Jikan, moteur de recherche, API publique distante ou mémoire du modèle comme preuve.
2. Sources factuelles autorisées: manga local auto-hébergé et scans/transcriptions locales de databooks. La base locale sert à localiser et auditer; le wiki existant est une cible, pas une preuve autonome.
3. Toute affirmation porte une référence vérifiable (ouvrage+tome/chapitre+planche ou databook+planche). Une référence absente ou ambiguë donne verified=false.
4. Ne complète jamais un OCR illisible. Ne traduis pas une graphie Dragon Ball au son. Signale les divergences au lieu de choisir silencieusement.
5. Lecture seule absolue: ne modifie aucun fichier, ne lance aucune migration, ne dépose rien dans PostgreSQL/SQLite/wiki et ne crée aucun commit.
6. Réponds uniquement avec l'objet JSON conforme au schéma. Les extraits doivent rester brefs et servir seulement à identifier la preuve. Toute proposition contient operation=fill_empty ou correct_existing et section_label (chaîne vide hors section).
7. Budget strict: au plus 6 commandes locales, chacune bornée à 200 lignes ou 100 Ko de sortie. Ne lis jamais en bloc un JSONL OCR, une base, un dump, un asset binaire ou tout le dépôt; utilise les commandes de synthèse Shenron puis ouvre uniquement les références ponctuelles nécessaires. Arrête dès que la mission est couverte.

Étape: ${stage.id} — ${stage.label}${reviewRule}${localCorpus}
Mission: ${task.mission}${inputBlock}`;
}

async function a2aTick(
	iteration: number,
	kind: "fact" | "error",
	subject: string,
	body: string
): Promise<void> {
	if (noA2a || dryRun) return;
	await mkdir(COORD_DIR, { recursive: true });
	const proc = Bun.spawn(
		[
			"aphrody",
			"a2a",
			"tick",
			"--iteration",
			String(iteration),
			"--side",
			"shenron",
			"--peer",
			"aphrody",
			"--kind",
			kind,
			"--subject",
			subject,
			"--body",
			body.slice(0, 60_000),
		],
		{
			cwd: ROOT,
			env: { ...Bun.env, APHRODY_COORD_DIR: COORD_DIR },
			stdout: "pipe",
			stderr: "pipe",
		}
	);
	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	await writeFile(
		join(runDir, `a2a-${String(iteration).padStart(2, "0")}.log`),
		`${stdout}${stderr}`,
		"utf8"
	);
	if (exitCode !== 0)
		console.warn(`A2A iteration ${iteration} en échec (${exitCode}): ${stderr.trim()}`);
}

async function validCompletedOutput(path: string): Promise<boolean> {
	if (!existsSync(path)) return false;
	try {
		const parsed = JSON.parse(await readFile(path, "utf8")) as { status?: unknown };
		return ["ok", "partial", "blocked"].includes(String(parsed.status));
	} catch {
		return false;
	}
}

async function runTask(
	stage: Stage,
	task: Task,
	inputs: string[]
): Promise<{ task: string; exitCode: number; skipped: boolean }> {
	const stageDir = join(runDir, stage.id);
	await mkdir(stageDir, { recursive: true });
	const outputPath = join(stageDir, `${task.id}.json`);
	if (resume && (await validCompletedOutput(outputPath))) {
		console.log(`  ↪ ${task.id} déjà terminé`);
		return { task: task.id, exitCode: 0, skipped: true };
	}

	const prompt = promptFor(stage, task, inputs);
	await writeFile(join(stageDir, `${task.id}.prompt.txt`), prompt, "utf8");
	if (dryRun) {
		console.log(`  · ${task.id} (simulation)`);
		return { task: task.id, exitCode: 0, skipped: false };
	}

	console.log(`  ▶ ${task.id}`);
	const proc = Bun.spawn(
		[
			"codex",
			"exec",
			"--ignore-user-config",
			"--strict-config",
			"-c",
			'web_search="disabled"',
			"-c",
			`model_reasoning_effort="${REASONING_EFFORT}"`,
			"-m",
			MODEL,
			"--approve-for-me",
			"--ephemeral",
			"--json",
			"--output-schema",
			schemaPath,
			"--output-last-message",
			outputPath,
			...(task.images ?? []).flatMap((image) => ["-i", image]),
			"-",
		],
		{ cwd: ROOT, stdin: "pipe", stdout: "pipe", stderr: "pipe" }
	);
	proc.stdin.write(prompt);
	proc.stdin.end();

	const eventsPath = join(stageDir, `${task.id}.events.jsonl`);
	const errorsPath = join(stageDir, `${task.id}.stderr.log`);
	const [exitCode, events, errors] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	await Promise.all([writeFile(eventsPath, events, "utf8"), writeFile(errorsPath, errors, "utf8")]);
	console.log(`${exitCode === 0 ? "  ✓" : "  ✗"} ${task.id} (code ${exitCode})`);
	return { task: task.id, exitCode, skipped: false };
}

async function runAction(action: "ocr" | "manga" | "wiki"): Promise<number> {
	if (dryRun) return 0;
	console.log(`  ◆ action déterministe ${action}${apply ? " (application)" : " (simulation)"}`);
	const proc = Bun.spawn(
		[
			"bun",
			"scripts/workflow-actions.ts",
			action,
			"--run-dir",
			runDir,
			...(apply ? ["--apply"] : []),
		],
		{ cwd: ROOT, stdout: "pipe", stderr: "pipe" }
	);
	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	await writeFile(join(runDir, `action-${action}.log`), `${stdout}${stderr}`, "utf8");
	if (stdout.trim()) console.log(stdout.trim());
	if (exitCode !== 0 && stderr.trim()) console.error(stderr.trim());
	return exitCode;
}

async function pool<T, R>(
	items: T[],
	limit: number,
	operation: (item: T) => Promise<R>
): Promise<R[]> {
	const results = Array.from<R>({ length: items.length });
	let cursor = 0;
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			while (cursor < items.length) {
				const index = cursor++;
				results[index] = await operation(items[index]!);
			}
		})
	);
	return results;
}

await mkdir(runDir, { recursive: true });
await writeFile(schemaPath, `${JSON.stringify(RESULT_SCHEMA, null, 2)}\n`, "utf8");
await writeFile(
	join(runDir, "run.json"),
	`${JSON.stringify(
		{
			run_id: runId,
			started_at: new Date().toISOString(),
			model: MODEL,
			reasoning_effort: REASONING_EFFORT,
			concurrency,
			dry_run: dryRun,
			apply,
			stages: selectedStages.map((stage) => stage.id),
			source_policy: "local manga + local databook scans/transcriptions only",
		},
		null,
		2
	)}\n`,
	"utf8"
);

console.log(`Campagne ${runId}`);
console.log(`Modèle ${MODEL} · effort ${REASONING_EFFORT} · concurrence ${concurrency}`);
console.log(`Sorties ${relativePath(runDir)}`);
await a2aTick(
	1,
	"fact",
	`Shenron workflow ${runId} démarré`,
	`INCOMPLET — étapes prévues: ${selectedStages.map((stage) => stage.id).join(", ")}. Sources locales uniquement.`
);

let failures = 0;
let iteration = 2;
for (const stage of selectedStages) {
	const tasks = stage.tasks.slice(0, taskLimit);
	console.log(`\n[${stage.id}] ${stage.label} — ${tasks.length} agent(s)`);
	const results = await pool(tasks, concurrency, async (task) =>
		runTask(stage, task, await priorOutputs(stage, task))
	);
	const failed = results.filter((result) => result.exitCode !== 0);
	failures += failed.length;
	await writeFile(
		join(runDir, stage.id, "stage.json"),
		`${JSON.stringify({ stage: stage.id, tasks: results, failed: failed.map((result) => result.task) }, null, 2)}\n`,
		"utf8"
	);
	await a2aTick(
		iteration++,
		failed.length ? "error" : "fact",
		`Shenron ${runId}: ${stage.id}`,
		`${failed.length ? "INCOMPLET" : "FAIT"} — ${results.length - failed.length}/${results.length} sous-agents terminés. Échecs: ${failed.map((result) => result.task).join(", ") || "aucun"}.`
	);
	if (failed.length) break;
	const action =
		stage.id === "databooks"
			? "ocr"
			: stage.id === "manga"
				? "manga"
				: stage.id === "shenron-review"
					? "wiki"
					: null;
	if (action) {
		const actionExit = await runAction(action);
		if (actionExit !== 0) {
			failures++;
			await a2aTick(
				iteration++,
				"error",
				`Shenron ${runId}: action ${action}`,
				`INCOMPLET — l'action ${action} a échoué avec le code ${actionExit}. Voir ${relativePath(join(runDir, `action-${action}.log`))}.`
			);
			break;
		}
		await a2aTick(
			iteration++,
			"fact",
			`Shenron ${runId}: action ${action}`,
			`FAIT — action ${action} ${apply ? "appliquée après sauvegarde" : "simulée"}.`
		);
	}
}

async function closureReport(): Promise<{
	unresolved: number;
	details: { kind: string; count: number; detail: string }[];
}> {
	const details: { kind: string; count: number; detail: string }[] = [];
	const ocrPath = join(runDir, "actions", "ocr-prepare.json");
	if (existsSync(ocrPath)) {
		const ocr = JSON.parse(await readFile(ocrPath, "utf8")) as {
			incompleteLots?: number;
			prepared?: { rejected?: number }[];
		};
		const incomplete = Number(ocr.incompleteLots ?? 0);
		const rejected = (ocr.prepared ?? []).reduce((sum, lot) => sum + Number(lot.rejected ?? 0), 0);
		if (incomplete > 0)
			details.push({
				kind: "ocr_incomplete_lots",
				count: incomplete,
				detail: "lots OCR encore en cours ou incomplets",
			});
		if (rejected > 0)
			details.push({
				kind: "ocr_rejected_pages",
				count: rejected,
				detail: "pages exclues par le filtre anti-hallucination et encore à relire",
			});
	}

	const wikiPath = join(runDir, "actions", "wiki-consensus.json");
	if (existsSync(wikiPath)) {
		const wiki = JSON.parse(await readFile(wikiPath, "utf8")) as {
			rejected?: unknown[];
			blocked_precondition?: unknown[];
		};
		if ((wiki.rejected?.length ?? 0) > 0)
			details.push({
				kind: "wiki_without_consensus",
				count: wiki.rejected!.length,
				detail: "propositions sans consensus exact 3/4 ou invalides",
			});
		if ((wiki.blocked_precondition?.length ?? 0) > 0)
			details.push({
				kind: "wiki_precondition_changed",
				count: wiki.blocked_precondition!.length,
				detail: "cibles dont l'état ne correspond plus à l'opération revue",
			});
	}

	if (!dryRun) {
		let missingOutputs = 0;
		let nonOkAgents = 0;
		let blockedReasons = 0;
		let nextTasks = 0;
		let errorFindings = 0;
		let rejectedVisualPages = 0;
		let invalidVisualProposals = 0;
		for (const stage of selectedStages) {
			for (const task of stage.tasks.slice(0, taskLimit)) {
				const path = join(runDir, stage.id, `${task.id}.json`);
				if (!existsSync(path)) {
					missingOutputs++;
					continue;
				}
				try {
					const result = JSON.parse(await readFile(path, "utf8")) as {
						status?: string;
						blocked_reasons?: unknown[];
						next_tasks?: unknown[];
						findings?: { severity?: string }[];
						proposals?: { decision?: string; value?: string }[];
					};
					if (result.status !== "ok") nonOkAgents++;
					blockedReasons += result.blocked_reasons?.length ?? 0;
					nextTasks += result.next_tasks?.length ?? 0;
					errorFindings +=
						result.findings?.filter((finding) => finding.severity === "error").length ?? 0;
					if (stage.id === "databook-review") {
						rejectedVisualPages +=
							result.proposals?.filter((proposal) => proposal.decision === "reject").length ?? 0;
						invalidVisualProposals +=
							result.proposals?.filter(
								(proposal) =>
									proposal.decision === "propose" &&
									(!proposal.value?.trim() || classerDefaut(proposal.value) !== null)
							).length ?? 0;
					}
				} catch {
					missingOutputs++;
				}
			}
		}
		for (const item of [
			{
				kind: "missing_agent_outputs",
				count: missingOutputs,
				detail: "sorties d'agents absentes ou illisibles",
			},
			{
				kind: "non_ok_agents",
				count: nonOkAgents,
				detail: "agents terminés avec un statut partiel ou bloqué",
			},
			{
				kind: "agent_blocked_reasons",
				count: blockedReasons,
				detail: "blocages explicites signalés par les agents",
			},
			{
				kind: "agent_next_tasks",
				count: nextTasks,
				detail: "tâches de suivi encore demandées par les agents",
			},
			{
				kind: "agent_error_findings",
				count: errorFindings,
				detail: "constats de sévérité erreur encore ouverts",
			},
			{
				kind: "visual_pages_rejected",
				count: rejectedVisualPages,
				detail: "planches rejetées par la relecture visuelle et encore à traiter",
			},
			{
				kind: "visual_proposals_invalid",
				count: invalidVisualProposals,
				detail: "propositions visuelles encore rejetées par le filtre anti-hallucination",
			},
		]) {
			if (item.count > 0) details.push(item);
		}
	}

	return { unresolved: details.reduce((sum, item) => sum + item.count, 0), details };
}

const closure = await closureReport();
await writeFile(join(runDir, "closure.json"), `${JSON.stringify(closure, null, 2)}\n`, "utf8");
const finalStatus = failures === 0 && closure.unresolved === 0 ? "FAIT" : "INCOMPLET";
await writeFile(
	join(runDir, "summary.json"),
	`${JSON.stringify(
		{
			run_id: runId,
			status: finalStatus,
			failures,
			unresolved: closure.unresolved,
			finished_at: new Date().toISOString(),
		},
		null,
		2
	)}\n`,
	"utf8"
);
await a2aTick(
	iteration,
	failures === 0 ? "fact" : "error",
	`Shenron workflow ${runId} terminé`,
	`${finalStatus} — ${failures} échec(s), ${closure.unresolved} élément(s) non résolu(s). Sorties: ${relativePath(runDir)}. Mode ${apply ? "application versionnée" : "simulation sans écriture"}.`
);

console.log(
	`\n${finalStatus} — ${failures} échec(s), ${closure.unresolved} élément(s) non résolu(s). ${apply ? "Actions validées appliquées après sauvegarde." : "Aucun dépôt DB/wiki exécuté."}`
);
process.exitCode = failures === 0 && closure.unresolved === 0 ? 0 : 1;
