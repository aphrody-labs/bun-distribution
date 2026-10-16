#!/usr/bin/env bun

import { basename, dirname, join, relative, resolve } from "node:path";

const EXPECTED_COMMIT = "674b6897d49241f811eaa0254975bc3587e85b7f";
const REPO_ROOT = resolve(import.meta.dir, "../..");
const OUTPUTS = {
	manifest: join(REPO_ROOT, "docs/achillea-phase0-import-manifest.json"),
	dependencies: join(REPO_ROOT, "docs/achillea-phase0-dependencies.md"),
	sourceMap: join(REPO_ROOT, "docs/achillea-phase0-source-map.md"),
} as const;

type Mode = "generate" | "check";
type DependencyKind = "dependencies" | "devDependencies" | "optionalDependencies";

interface Args {
	mode: Mode;
	source: string;
}

interface ImportEntry {
	source: string;
	destination: string;
	sha256: string;
	size: number;
}

interface ExcludedEntry {
	source: string;
	rule: string;
}

interface Manifest {
	schemaVersion: 1;
	source: {
		repository: "rose-griffon/achillea";
		commit: string;
	};
	policy: {
		trackedFilesOnly: true;
		requireCleanWorktree: true;
		allowedDestinations: string[];
		exclusionRules: Array<{ id: string; description: string }>;
		secretSignatures: string[];
	};
	summary: {
		trackedFiles: number;
		importedFiles: number;
		excludedFiles: number;
		importedBytes: number;
	};
	imports: ImportEntry[];
	exclusions: ExcludedEntry[];
}

interface PackageManifest {
	name?: string;
	version?: string;
	license?: string;
	catalog?: Record<string, string>;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
}

interface DependencyRow {
	workspace: string;
	kind: DependencyKind;
	name: string;
	declared: string;
	resolved: string;
	license: string;
	licenseProvenance: string;
	runtime: string;
	decision: string;
}

const PACKAGE_MANIFESTS = [
	"package.json",
	"apps/bot/package.json",
	"apps/iecode-web/package.json",
	"packages/core/package.json",
	"packages/types/package.json",
] as const;

const ALLOWED_MAPPINGS = [
	["apps/bot/", "apps/achillea-bot/"],
	["apps/iecode-web/", "apps/achillea-web/"],
	["packages/core/", "packages/achillea-core/"],
	["packages/types/", "packages/achillea-types/"],
] as const;

const EXCLUSION_RULES = [
	{ id: "git-metadata", description: ".git metadata (never enumerated by git ls-files)" },
	{ id: "dependencies", description: "node_modules directories" },
	{ id: "lockfile", description: "Bun, npm, pnpm and Yarn lockfiles" },
	{ id: "environment", description: ".env and every .env* variant" },
	{ id: "build-output", description: "build, dist and .angular output/cache directories" },
	{ id: "snapshot", description: "database snapshots and *.snap files" },
	{ id: "dump", description: "database/archive dump artifacts" },
	{ id: "runtime-data", description: "backup, storage, upload and log directories" },
	{ id: "certificate", description: "certificate and private-key paths/extensions" },
	{ id: "deploy-workflow", description: "source deployment/migration/release workflows" },
	{ id: "duplicate-bot-infra", description: "non-canonical apps/bot/infra copy" },
	{ id: "secret-signature", description: "tracked file quarantined by content scan" },
	{ id: "outside-port-scope", description: "tracked source outside the four Phase 0 destinations" },
] as const;

const SECRET_SIGNATURES: Array<{ id: string; pattern: RegExp }> = [
	{ id: "private-key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
	{ id: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
	{ id: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/ },
	{ id: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
	{ id: "stripe-secret", pattern: /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
	{ id: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
	{ id: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{16,}\.eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/ },
	{ id: "credential-url", pattern: /\b(?:postgres(?:ql)?|mysql|redis|mongodb(?:\+srv)?):\/\/[A-Za-z0-9._-]+:[A-Za-z0-9._~!%+,-]{4,}@/i },
];

function fail(message: string): never {
	console.error(`achillea-phase0: ${message}`);
	process.exit(1);
}

function parseArgs(argv: string[]): Args {
	let mode: Mode = "check";
	let source = process.env.ACHILLEA_SOURCE ?? "";
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--generate") mode = "generate";
		else if (argument === "--check") mode = "check";
		else if (argument === "--source") source = argv[++index] ?? "";
		else if (argument === "--help" || argument === "-h") {
			console.log("Usage: bun scripts/achillea/phase0.ts (--generate|--check) --source <clean-achillea-clone>");
			process.exit(0);
		} else fail(`unknown argument: ${argument}`);
	}
	if (!source) fail("--source is required (or set ACHILLEA_SOURCE)");
	return { mode, source: resolve(source) };
}

function runGit(source: string, args: string[]): Uint8Array {
	const result = Bun.spawnSync(["git", "-C", source, ...args], { stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) {
		fail(`git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`);
	}
	return result.stdout;
}

function gitText(source: string, args: string[]): string {
	return new TextDecoder().decode(runGit(source, args)).trim();
}

function pathSegments(path: string): string[] {
	return path.toLowerCase().split("/");
}

function pathExclusion(path: string): string | undefined {
	const lower = path.toLowerCase();
	const segments = pathSegments(path);
	const file = basename(lower);
	if (segments.includes(".git")) return "git-metadata";
	if (segments.includes("node_modules")) return "dependencies";
	if (/^(?:bun\.lockb?|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.ya?ml|yarn\.lock)$/.test(file)) return "lockfile";
	if (file === ".env" || file.startsWith(".env.")) return "environment";
	if (segments.some((part) => part === "build" || part === "dist" || part === ".angular")) return "build-output";
	if (segments.includes("snapshots") || file.startsWith(".snapshot") || file.endsWith(".snap")) return "snapshot";
	if (segments.some((part) => part === "dump" || part === "dumps") || /\.(?:dump|sql\.gz|sqlite3?|db)$/.test(file)) return "dump";
	if (segments.some((part) => ["backup", "backups", "storage", "upload", "uploads", "log", "logs"].includes(part))) return "runtime-data";
	if (segments.some((part) => ["cert", "certs", "certificate", "certificates"].includes(part)) || /\.(?:pem|key|crt|cer|p12|pfx)$/.test(file)) return "certificate";
	if (/^\.github\/workflows\/.*(?:deploy|migration|migrate|release)/.test(lower)) return "deploy-workflow";
	if (lower.startsWith("apps/bot/infra/")) return "duplicate-bot-infra";
	return undefined;
}

function destinationFor(path: string): string | undefined {
	for (const [sourcePrefix, destinationPrefix] of ALLOWED_MAPPINGS) {
		if (path.startsWith(sourcePrefix)) return destinationPrefix + path.slice(sourcePrefix.length);
	}
	return undefined;
}

function sha256(bytes: Uint8Array): string {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(bytes);
	return hasher.digest("hex");
}

function secretSignature(bytes: Uint8Array): string | undefined {
	const sample = bytes.subarray(0, Math.min(bytes.length, 2_000_000));
	if (sample.includes(0)) return undefined;
	const text = new TextDecoder("utf-8", { fatal: false }).decode(sample);
	return SECRET_SIGNATURES.find(({ pattern }) => pattern.test(text))?.id;
}

function assertPolicy(): void {
	const cases: Array<[string, string]> = [
		["node_modules/pkg/index.js", "dependencies"],
		["apps/iecode-web/bun.lock", "lockfile"],
		["apps/bot/.env.production", "environment"],
		["apps/iecode-web/dist/index.html", "build-output"],
		["apps/bot/database/migrations/.snapshot-db.json", "snapshot"],
		["apps/bot/database/dumps/latest.sql.gz", "dump"],
		["apps/bot/storage/proof.png", "runtime-data"],
		["apps/bot/logs/runtime.log", "runtime-data"],
		["apps/bot/certs/server.pem", "certificate"],
		[".github/workflows/deploy.yml", "deploy-workflow"],
		["apps/bot/infra/systemd/service", "duplicate-bot-infra"],
	];
	for (const [path, expected] of cases) {
		if (pathExclusion(path) !== expected) fail(`policy self-test failed for ${path}`);
	}
	for (const [sourcePrefix, destinationPrefix] of ALLOWED_MAPPINGS) {
		const mapped = destinationFor(`${sourcePrefix}sentinel.ts`);
		if (mapped !== `${destinationPrefix}sentinel.ts`) fail(`mapping self-test failed for ${sourcePrefix}`);
	}
}

async function createManifest(source: string, trackedFiles: string[]): Promise<Manifest> {
	const imports: ImportEntry[] = [];
	const exclusions: ExcludedEntry[] = [];
	const destinations = new Set<string>();

	for (const path of trackedFiles) {
		let rule = pathExclusion(path);
		const destination = destinationFor(path);
		if (!rule && !destination) rule = "outside-port-scope";
		if (rule) {
			exclusions.push({ source: path, rule });
			continue;
		}
		if (!destination) fail(`internal mapping error for ${path}`);
		if (!ALLOWED_MAPPINGS.some(([, prefix]) => destination.startsWith(prefix))) {
			fail(`destination escaped allowlist: ${destination}`);
		}
		if (destinations.has(destination)) fail(`destination collision: ${destination}`);
		destinations.add(destination);

		const absolutePath = join(source, path);
		const bytes = new Uint8Array(await Bun.file(absolutePath).arrayBuffer());
		const signature = secretSignature(bytes);
		if (signature) {
			exclusions.push({ source: path, rule: `secret-signature:${signature}` });
			continue;
		}
		imports.push({ source: path, destination, sha256: sha256(bytes), size: bytes.length });
	}

	imports.sort((a, b) => a.source.localeCompare(b.source));
	exclusions.sort((a, b) => a.source.localeCompare(b.source));
	return {
		schemaVersion: 1,
		source: { repository: "rose-griffon/achillea", commit: EXPECTED_COMMIT },
		policy: {
			trackedFilesOnly: true,
			requireCleanWorktree: true,
			allowedDestinations: ALLOWED_MAPPINGS.map(([, destination]) => destination.slice(0, -1)),
			exclusionRules: [...EXCLUSION_RULES],
			secretSignatures: SECRET_SIGNATURES.map(({ id }) => id),
		},
		summary: {
			trackedFiles: trackedFiles.length,
			importedFiles: imports.length,
			excludedFiles: exclusions.length,
			importedBytes: imports.reduce((total, entry) => total + entry.size, 0),
		},
		imports,
		exclusions,
	};
}

function parseLockVersions(lockText: string): Map<string, string> {
	const versions = new Map<string, string>();
	for (const match of lockText.matchAll(/^ {4}"([^"]+)": \["([^"]+)"/gm)) {
		const key = match[1];
		const resolution = match[2];
		if (key.includes("/node_modules/") || key.includes("/@")) continue;
		const prefix = `${key}@`;
		if (resolution.startsWith(prefix)) versions.set(key, resolution.slice(prefix.length));
	}
	return versions;
}

function packageLockMetadata(text: string): Map<string, { version?: string; license?: string }> {
	const parsed = JSON.parse(text) as { packages?: Record<string, { version?: string; license?: string }> };
	const result = new Map<string, { version?: string; license?: string }>();
	for (const [path, metadata] of Object.entries(parsed.packages ?? {})) {
		if (!path.startsWith("node_modules/")) continue;
		const name = path.slice("node_modules/".length);
		if (!name.includes("/node_modules/") && metadata.license) result.set(name, metadata);
	}
	return result;
}

function runtimeFor(workspace: string, kind: DependencyKind): string {
	if (kind === "optionalDependencies") return "backend native optionnel";
	if (workspace === "apps/bot") return kind === "dependencies" ? "backend Bun/Discord/API/ranked" : "build, lint et tests backend";
	if (workspace === "apps/iecode-web") return kind === "dependencies" ? "navigateur Angular" : "build et tests Angular";
	if (workspace === "packages/core") return "cœur métier multi-runtime";
	if (workspace === "packages/types") return "types/compilation";
	return "outillage monorepo source";
}

function dependencyDecision(name: string, declared: string, rgCatalog: Record<string, string>): string {
	if (declared === "workspace:*") return "conserver en workspace dédié et remapper le chemin";
	if (name.startsWith("@aphrody/")) return "bloquer avant install : arbitrer @aphrody/* vs @aphrody-code/* et tester le natif";
	if (name.startsWith("@angular/") || ["primeng", "primeicons", "@primeuix/themes", "zone.js"].includes(name)) return "conserver Angular/PrimeNG dans achillea-web ; ne pas convertir vers Next";
	if (name.startsWith("@tsed/")) return "conserver Ts.ED dans achillea-bot isolé";
	if (name.startsWith("@mikro-orm/")) return "conserver MikroORM 7 ; base et migrations Achillea séparées";
	if (name.includes("colyseus") || name === "socket.io" || name === "socket.io-client") return "conserver ; valider séparément REST, Colyseus et Socket.IO";
	if (name === "bullmq" || name === "ioredis") return "conserver ; Redis Achillea reste une dépendance runtime externe";
	if (rgCatalog[name]) return `réutiliser le catalogue RG (${rgCatalog[name]}) après contrôle de compatibilité`;
	if (declared === "catalog:") return "ajouter au catalogue RG avec la version source résolue";
	return "ajouter au seul workspace consommateur ; licence/gate ciblée avant install global";
}

async function dependencyRows(source: string): Promise<DependencyRow[]> {
	const sourceRootManifest = (await Bun.file(join(source, "package.json")).json()) as PackageManifest;
	const sourceCatalog = sourceRootManifest.catalog ?? {};
	const rgRootManifest = (await Bun.file(join(REPO_ROOT, "package.json")).json()) as { workspaces?: { catalog?: Record<string, string> } };
	const rgCatalog = rgRootManifest.workspaces?.catalog ?? {};
	const lockVersions = parseLockVersions(await Bun.file(join(source, "bun.lock")).text());
	const npmMetadata = packageLockMetadata(await Bun.file(join(source, "apps/bot/package-lock.json")).text());
	const workspaceVersions = new Map<string, string>();
	const manifests = new Map<string, PackageManifest>();

	for (const path of PACKAGE_MANIFESTS) {
		const manifest = (await Bun.file(join(source, path)).json()) as PackageManifest;
		const workspace = dirname(path) === "." ? "." : dirname(path);
		manifests.set(workspace, manifest);
		if (manifest.name && manifest.version) workspaceVersions.set(manifest.name, manifest.version);
	}

	const rows: DependencyRow[] = [];
	for (const [workspace, manifest] of manifests) {
		for (const kind of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
			for (const [name, declared] of Object.entries(manifest[kind] ?? {})) {
				const effectiveDeclared = declared === "catalog:" ? (sourceCatalog[name] ?? "catalog:UNRESOLVED") : declared;
				const metadata = npmMetadata.get(name);
				const resolved = declared === "workspace:*" ? (workspaceVersions.get(name) ?? "workspace") : (lockVersions.get(name) ?? "non résolue dans bun.lock");
				const metadataLicense = metadata?.license;
				const license = name.startsWith("@rosegriffon/achillea-")
					? (manifests.get(name === "@rosegriffon/achillea-core" ? "packages/core" : "packages/types")?.license ?? "non déclarée")
					: metadataLicense
						? metadata?.version === resolved
							? metadataLicense
							: `${metadataLicense} (metadata ${metadata?.version ?? "?"}; résolution ${resolved} à vérifier)`
						: "indéterminée localement";
				const licenseProvenance = metadata?.license
					? `apps/bot/package-lock.json metadata (${metadata.version ?? "version inconnue"})`
					: name.startsWith("@rosegriffon/achillea-")
						? "package.json du workspace source"
						: "aucune metadata de licence locale disponible";
				let decision = dependencyDecision(name, declared, rgCatalog);
				if (metadataLicense && /(?:AGPL|GPL|LGPL)/i.test(metadataLicense)) {
					decision = `bloquer avant install : licence ${metadataLicense} à arbitrer pour la version résolue`;
				}
				rows.push({
					workspace,
					kind,
					name,
					declared: effectiveDeclared,
					resolved,
					license,
					licenseProvenance,
					runtime: runtimeFor(workspace, kind),
					decision,
				});
			}
		}
	}
	return rows.sort((a, b) => a.workspace.localeCompare(b.workspace) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}

function escapeCell(value: string): string {
	return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function dependencyMarkdown(rows: DependencyRow[]): string {
	const critical = [
		["Angular 21 / PrimeNG 21", "Conserver dans `apps/achillea-web`; aucune conversion Next.js pendant le portage."],
		["Ts.ED 8", "Conserver dans `apps/achillea-bot`; ne pas fusionner avec l'API ou le bot RG."],
		["MikroORM 7", "Conserver avec ses migrations; interdire toute cible DB RG et tester sur une base Achillea dédiée."],
		["Colyseus + Socket.IO", "Conserver les trois processus/flux; valider REST, Colyseus et Socket.IO séparément."],
		["BullMQ + ioredis", "Conserver seulement avec une cible Redis Achillea explicitement configurée."],
		["`@aphrody/*`", "Bloquant avant install global : arbitrer le namespace face à `@aphrody-code/*`; tester `canvas` et son binaire optionnel."],
		["Catalog source", "Importer les entrées absentes dans le catalogue RG seulement en Phase 1, après décision de version et licence."],
	];
	const lines = [
		"# Achillea Phase 0 — Dependency ledger",
		"",
		`Generated from \`rose-griffon/achillea\` at \`${EXPECTED_COMMIT}\` by \`scripts/achillea/phase0.ts\`. This ledger enumerates every direct dependency declaration in the five source manifests. The resolved version comes from the frozen source \`bun.lock\`; licenses come only from local package metadata (principally the source bot's package-lock metadata), and are explicitly left undetermined otherwise.`,
		"",
		`Entries: **${rows.length}** declarations across **${new Set(rows.map((row) => row.workspace)).size}** manifests. No package installation or network lookup was performed.`,
		"",
		"## Critical decisions before Phase 1",
		"",
		"| Family | Decision |",
		"| --- | --- |",
		...critical.map(([family, decision]) => `| ${family} | ${decision} |`),
		"",
		"## Exhaustive direct-dependency ledger",
		"",
		"| Workspace | Surface | Dependency | Declared constraint | Frozen resolution | License | License provenance | Runtime | Phase 0 decision |",
		"| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
		...rows.map((row) => `| ${[row.workspace, row.kind, row.name, row.declared, row.resolved, row.license, row.licenseProvenance, row.runtime, row.decision].map(escapeCell).join(" | ")} |`),
		"",
		"## Interpretation",
		"",
		"`indéterminée localement` is deliberate: Phase 0 does not infer a license from memory and does not contact a registry. Such a row requires metadata/license verification before the dependency is admitted to the RG lockfile. A license recorded by the source npm lock is evidence about the named package, but its metadata version is retained in the provenance column when it differs from the Bun resolution.",
		"",
	];
	return lines.join("\n");
}

function sourceMapMarkdown(manifest: Manifest): string {
	const importStats = ALLOWED_MAPPINGS.map(([sourcePrefix, destinationPrefix]) => {
		const entries = manifest.imports.filter((entry) => entry.source.startsWith(sourcePrefix));
		return { source: sourcePrefix.slice(0, -1), destination: destinationPrefix.slice(0, -1), files: entries.length, bytes: entries.reduce((sum, entry) => sum + entry.size, 0) };
	});
	const exclusionCounts = new Map<string, number>();
	for (const entry of manifest.exclusions) {
		const rule = entry.rule.split(":", 1)[0];
		exclusionCounts.set(rule, (exclusionCounts.get(rule) ?? 0) + 1);
	}
	const detailed = [
		["`packages/types/**`", "`packages/achillea-types/**`", "Phase 1", "Portable contracts first; preserve package API, then rename paths only."],
		["`packages/core/**`", "`packages/achillea-core/**`", "Phase 1", "Portable business logic; dependency only on Achillea types and catalog utilities."],
		["`apps/bot/src/**`", "`apps/achillea-bot/src/**`", "Phase 2", "Keep Discord, REST :4000, ranked :4002 and Socket.IO :4005 isolated from RG bot."],
		["`apps/bot/database/migrations/**`", "`apps/achillea-bot/database/migrations/**`", "Phase 2", "Import TypeScript migrations; snapshots are excluded. Never point at the RG database."],
		["`apps/bot/infra/**`", "excluded", "Review only", "Duplicate non-canonical infrastructure; root source infra must be adapted separately."],
		["`apps/iecode-web/src/**`, `public/**`", "`apps/achillea-web/**`", "Phase 3", "Preserve Angular/PrimeNG and Achillea-owned static assets."],
		["`apps/iecode-web/src/environments/environment.prod.ts`", "quarantined by secret scan", "Phase 3", "Regenerate from an injectable public runtime/build configuration; do not copy credentials."],
		["root configs/scripts/docs/infra", "excluded from import", "Manual adaptation", "Review one by one; never overwrite RG root configuration or operations."],
		["`.github/workflows/*deploy|*migrate|*release*`", "excluded", "Phase 5", "No source deployment or mutation automation enters the first port."],
	];
	const lines = [
		"# Achillea Phase 0 — Source to RG matrix",
		"",
		`Source baseline: \`rose-griffon/achillea@${EXPECTED_COMMIT}\`. This matrix describes the import boundary only; it does not copy code, install packages, migrate data, alter RG root manifests, or authorize deployment. The exhaustive per-file mapping and SHA-256 evidence live in \`docs/achillea-phase0-import-manifest.json\`.`,
		"",
		"## Import destinations",
		"",
		"| Source root | RG destination | Files | Bytes |",
		"| --- | --- | ---: | ---: |",
		...importStats.map((row) => `| \`${row.source}\` | \`${row.destination}\` | ${row.files} | ${row.bytes} |`),
		"",
		"## Operational mapping",
		"",
		"| Source surface | RG target/action | Earliest phase | Boundary |",
		"| --- | --- | --- | --- |",
		...detailed.map((row) => `| ${row.join(" | ")} |`),
		"",
		"## Exclusion evidence",
		"",
		"| Rule | Tracked files excluded |",
		"| --- | ---: |",
		...Array.from(exclusionCounts).sort(([a], [b]) => a.localeCompare(b)).map(([rule, count]) => `| \`${rule}\` | ${count} |`),
		"",
		"`.git` and `node_modules` are structural deny rules even when Git cannot enumerate them as tracked files. Every imported destination is allowlisted under one of the four roots above, destination collisions are fatal, and each imported file carries a content hash. Content matching a secret signature is quarantined as an exclusion without recording the matched value.",
		"",
		"## Reproduce and verify",
		"",
		"```bash",
		"bun scripts/achillea/phase0.ts --check --source /path/to/clean/achillea",
		"# Deliberate refresh after auditing a new generator/source change:",
		"bun scripts/achillea/phase0.ts --generate --source /path/to/clean/achillea",
		"```",
		"",
		"The command refuses a source commit other than the frozen hash, a dirty source checkout, an untracked file dependency, a destination outside the allowlist, a collision, or any drift in the three generated artifacts.",
		"",
	];
	return lines.join("\n");
}

async function compareOrWrite(path: string, content: string, mode: Mode): Promise<void> {
	const normalized = content.endsWith("\n") ? content : `${content}\n`;
	if (mode === "generate") {
		await Bun.write(path, normalized);
		console.log(`wrote ${relative(REPO_ROOT, path)}`);
		return;
	}
	const file = Bun.file(path);
	if (!(await file.exists())) fail(`missing generated artifact: ${relative(REPO_ROOT, path)}`);
	const actual = await file.text();
	if (actual !== normalized) fail(`generated artifact drift: ${relative(REPO_ROOT, path)} (run --generate deliberately)`);
	console.log(`verified ${relative(REPO_ROOT, path)}`);
}

async function main(): Promise<void> {
	const args = parseArgs(Bun.argv.slice(2));
	assertPolicy();
	const head = gitText(args.source, ["rev-parse", "HEAD"]);
	if (head !== EXPECTED_COMMIT) fail(`source HEAD is ${head}, expected ${EXPECTED_COMMIT}`);
	const status = gitText(args.source, ["status", "--porcelain=v1", "--untracked-files=all"]);
	if (status) fail("source worktree must be clean, including untracked files");
	const indexModes = new TextDecoder().decode(runGit(args.source, ["ls-files", "-s", "-z"])).split("\0").filter(Boolean);
	const unsupportedEntry = indexModes.find((entry) => !entry.startsWith("100644 ") && !entry.startsWith("100755 "));
	if (unsupportedEntry) fail(`source contains a symlink, submodule or unsupported Git mode: ${unsupportedEntry.split("\t", 2)[1] ?? "unknown"}`);
	const tracked = new TextDecoder().decode(runGit(args.source, ["ls-files", "-z"])).split("\0").filter(Boolean).sort();
	if (tracked.length === 0) fail("source contains no tracked files");

	const manifest = await createManifest(args.source, tracked);
	if (manifest.summary.trackedFiles !== manifest.summary.importedFiles + manifest.summary.excludedFiles) fail("manifest accounting mismatch");
	const rows = await dependencyRows(args.source);
	await compareOrWrite(OUTPUTS.manifest, JSON.stringify(manifest, null, 2), args.mode);
	await compareOrWrite(OUTPUTS.dependencies, dependencyMarkdown(rows), args.mode);
	await compareOrWrite(OUTPUTS.sourceMap, sourceMapMarkdown(manifest), args.mode);
	console.log(`ok: ${manifest.summary.importedFiles} imports, ${manifest.summary.excludedFiles} exclusions, ${rows.length} dependency declarations`);
}

await main();
