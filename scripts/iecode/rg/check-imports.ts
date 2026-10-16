#!/usr/bin/env bun
/**
 * Validate imports from every tracked file and every untracked, non-ignored file.
 *
 * Internal imports (relative paths, tsconfig aliases and workspace packages) are
 * blocking. Missing external packages are reported, but remain non-blocking so
 * optional/peer/platform-specific dependencies do not make this structural gate
 * flaky.
 *
 * Usage: bun scripts/check-imports.ts
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, extname, join, relative, resolve } from "node:path";

import ts from "@typescript/typescript6";

const ROOT = resolve(import.meta.dir, "..");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const RESOLUTION_EXTENSIONS = [
	".ts",
	".tsx",
	".mts",
	".cts",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".json",
	".node",
	".css",
	".scss",
	".sass",
	".less",
	".svg",
	".wasm",
	".html",
];
const IGNORED_DIRECTORY_NAMES = new Set([
	".angular",
	".git",
	".next",
	".nuxt",
	".output",
	".turbo",
	".vercel",
	"build",
	"coverage",
	"dist",
	"node_modules",
	"out",
	"out-tsc",
	"vendor",
]);
const BUILTINS = new Set(builtinModules.flatMap((name) => [name, name.replace(/^node:/, "")]));

type JsonObject = Record<string, unknown>;
type Workspace = {
	dir: string;
	name: string;
	manifest: JsonObject;
};
type Config = {
	cache: ts.ModuleResolutionCache;
	options: ts.CompilerOptions;
	pathsBase: string;
};
type ImportReference = { line: number; specifier: string };
type Miss = ImportReference & {
	file: string;
	kind: "alias" | "external" | "manifest" | "relative" | "workspace";
};

function declaresDependency(manifest: JsonObject, name: string): boolean {
	return ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].some(
		(field) => {
			const dependencies = manifest[field];
			return dependencies !== null && typeof dependencies === "object" && name in dependencies;
		}
	);
}

function runGit(args: string[]): string[] {
	const result = Bun.spawnSync(["git", "-C", ROOT, ...args], { stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) {
		const message = result.stderr.toString().trim() || `git ${args.join(" ")} failed`;
		throw new Error(message);
	}
	return result.stdout.toString().split("\0").filter(Boolean);
}

function readJson(path: string): JsonObject {
	const result = ts.readConfigFile(path, ts.sys.readFile);
	if (result.error) {
		throw new Error(ts.flattenDiagnosticMessageText(result.error.messageText, "\n"));
	}
	return result.config as JsonObject;
}

function globPatternToRegExp(pattern: string): RegExp {
	let output = "^";
	for (let index = 0; index < pattern.length; index++) {
		const character = pattern[index];
		if (character === "*") {
			if (pattern[index + 1] === "*") {
				output += ".*";
				index++;
			} else {
				output += "[^/]*";
			}
		} else if (character === "?") {
			output += "[^/]";
		} else {
			output += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
		}
	}
	return new RegExp(`${output}$`);
}

function workspacePatterns(manifest: JsonObject): string[] {
	const value = manifest.workspaces;
	const configuredPackages =
		value && typeof value === "object" ? (value as JsonObject).packages : undefined;
	const patterns: unknown[] = Array.isArray(value)
		? value
		: Array.isArray(configuredPackages)
			? configuredPackages
			: [];
	return patterns.filter(
		(entry): entry is string => typeof entry === "string" && !entry.startsWith("!")
	);
}

function discoverWorkspaces(files: string[]): Workspace[] {
	const rootManifest = readJson(join(ROOT, "package.json"));
	const matchers = workspacePatterns(rootManifest).map(globPatternToRegExp);
	const workspaces: Workspace[] = [];

	for (const file of files) {
		if (!file.endsWith("/package.json")) continue;
		const dir = file.slice(0, -"/package.json".length);
		if (!matchers.some((matcher) => matcher.test(dir))) continue;
		const manifest = readJson(join(ROOT, file));
		if (typeof manifest.name !== "string" || manifest.name.length === 0) continue;
		workspaces.push({ dir, name: manifest.name, manifest });
	}

	return workspaces.sort((left, right) => left.dir.localeCompare(right.dir));
}

function hasIgnoredDirectory(path: string): boolean {
	return path.split("/").some((part) => IGNORED_DIRECTORY_NAMES.has(part));
}

function isSourceFile(path: string): boolean {
	return (
		!path.endsWith(".d.ts") && SOURCE_EXTENSIONS.has(extname(path)) && !hasIgnoredDirectory(path)
	);
}

function isFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

function withoutQueryOrHash(path: string): string {
	const marker = path.search(/[?#]/);
	return marker === -1 ? path : path.slice(0, marker);
}

function resolvesAsFile(input: string): boolean {
	const path = withoutQueryOrHash(input);
	if (isFile(path)) return true;

	for (const extension of RESOLUTION_EXTENSIONS) {
		if (isFile(path + extension)) return true;
	}

	const runtimeExtension = extname(path);
	const sourceAlternatives: Record<string, string[]> = {
		".js": [".ts", ".tsx"],
		".jsx": [".tsx", ".ts"],
		".mjs": [".mts", ".ts"],
		".cjs": [".cts", ".ts"],
	};
	for (const sourceExtension of sourceAlternatives[runtimeExtension] ?? []) {
		if (isFile(path.slice(0, -runtimeExtension.length) + sourceExtension)) return true;
	}

	if (isDirectory(path)) {
		for (const extension of RESOLUTION_EXTENSIONS) {
			if (isFile(join(path, `index${extension}`))) return true;
		}
		const manifestPath = join(path, "package.json");
		if (isFile(manifestPath)) {
			const manifest = readJson(manifestPath);
			for (const field of ["types", "module", "main"] as const) {
				if (typeof manifest[field] === "string" && resolvesAsFile(join(path, manifest[field])))
					return true;
			}
		}
	}
	return false;
}

function configForWorkspace(workspaceDir: string | null, configs: Map<string, Config>): Config {
	const key = workspaceDir ?? ".";
	const cached = configs.get(key);
	if (cached) return cached;

	const workspaceConfig = join(ROOT, key, "tsconfig.json");
	const configPath = existsSync(workspaceConfig) ? workspaceConfig : join(ROOT, "tsconfig.json");
	const parsedFile = ts.readConfigFile(configPath, ts.sys.readFile);
	if (parsedFile.error) {
		throw new Error(
			`${relative(ROOT, configPath)}: ${ts.flattenDiagnosticMessageText(parsedFile.error.messageText, "\n")}`
		);
	}
	const configDir = dirname(configPath);
	const parsed = ts.parseJsonConfigFileContent(parsedFile.config, ts.sys, configDir);
	const pathsBase =
		parsed.options.baseUrl ??
		((parsed.options as ts.CompilerOptions & { pathsBasePath?: string }).pathsBasePath ||
			configDir);
	const config = {
		cache: ts.createModuleResolutionCache(configDir, (fileName) => fileName, parsed.options),
		options: parsed.options,
		pathsBase,
	};
	configs.set(key, config);
	return config;
}

function workspaceForFile(
	file: string,
	workspacesBySpecificity: Workspace[]
): Workspace | undefined {
	return workspacesBySpecificity.find(
		(workspace) => file === workspace.dir || file.startsWith(`${workspace.dir}/`)
	);
}

function aliasTargets(specifier: string, config: Config): string[] | null {
	const paths = config.options.paths;
	if (!paths) return null;

	const matches: Array<{ captured: string; pattern: string; targets: string[] }> = [];
	for (const [pattern, targets] of Object.entries(paths)) {
		if (!targets) continue;
		const star = pattern.indexOf("*");
		if (star === -1) {
			if (specifier === pattern) matches.push({ captured: "", pattern, targets });
			continue;
		}
		const prefix = pattern.slice(0, star);
		const suffix = pattern.slice(star + 1);
		if (specifier.startsWith(prefix) && specifier.endsWith(suffix)) {
			matches.push({
				captured: specifier.slice(prefix.length, specifier.length - suffix.length),
				pattern,
				targets,
			});
		}
	}
	if (matches.length === 0) return null;

	matches.sort((left, right) => {
		const leftExact = left.pattern.includes("*") ? 0 : 1;
		const rightExact = right.pattern.includes("*") ? 0 : 1;
		return (
			rightExact - leftExact ||
			right.pattern.length - left.pattern.length ||
			left.pattern.localeCompare(right.pattern)
		);
	});
	const selected = matches[0];
	return selected.targets.map((target) =>
		resolve(config.pathsBase, target.replaceAll("*", selected.captured))
	);
}

function collectExportTargets(value: unknown, wildcard: string): string[] {
	if (typeof value === "string") return [value.replaceAll("*", wildcard)];
	if (Array.isArray(value)) return value.flatMap((entry) => collectExportTargets(entry, wildcard));
	if (value && typeof value === "object") {
		return Object.values(value as JsonObject).flatMap((entry) =>
			collectExportTargets(entry, wildcard)
		);
	}
	return [];
}

function exportTargets(exportsField: unknown, subpath: string): string[] | null {
	if (exportsField === undefined) return null;
	if (typeof exportsField === "string" || Array.isArray(exportsField)) {
		return subpath === "." ? collectExportTargets(exportsField, "") : [];
	}
	if (!exportsField || typeof exportsField !== "object") return [];

	const exportsObject = exportsField as JsonObject;
	const keys = Object.keys(exportsObject);
	if (!keys.some((key) => key.startsWith("."))) {
		return subpath === "." ? collectExportTargets(exportsObject, "") : [];
	}
	if (subpath in exportsObject) return collectExportTargets(exportsObject[subpath], "");

	const wildcardMatches = keys
		.filter((key) => key.includes("*"))
		.map((key) => {
			const star = key.indexOf("*");
			const prefix = key.slice(0, star);
			const suffix = key.slice(star + 1);
			return subpath.startsWith(prefix) && subpath.endsWith(suffix)
				? { captured: subpath.slice(prefix.length, subpath.length - suffix.length), key }
				: null;
		})
		.filter((match): match is { captured: string; key: string } => match !== null)
		.sort((left, right) => right.key.length - left.key.length || left.key.localeCompare(right.key));
	if (wildcardMatches.length === 0) return [];
	const selected = wildcardMatches[0];
	return collectExportTargets(exportsObject[selected.key], selected.captured);
}

function generatedTargetHasSource(packageDir: string, target: string): boolean {
	if (!target.startsWith("./")) return false;
	const normalized = target.replace(/^\.\/(?:dist|build|lib)\//, "./src/");
	if (normalized === target) return false;
	const withoutDeclaration = normalized.replace(/\.d\.(?:mts|cts|ts)$/, "");
	const withoutRuntime = withoutDeclaration.replace(/\.(?:mjs|cjs|js)$/, "");
	return resolvesAsFile(join(packageDir, withoutRuntime));
}

function resolveWorkspaceImport(specifier: string, workspace: Workspace): boolean {
	const suffix = specifier.slice(workspace.name.length);
	const subpath = suffix.length === 0 ? "." : `.${suffix}`;
	const targets = exportTargets(workspace.manifest.exports, subpath);
	if (targets !== null) {
		return targets.some(
			(target) =>
				target.startsWith("./") &&
				(resolvesAsFile(join(ROOT, workspace.dir, target)) ||
					generatedTargetHasSource(join(ROOT, workspace.dir), target))
		);
	}

	if (subpath !== ".") {
		return (
			resolvesAsFile(join(ROOT, workspace.dir, suffix.slice(1))) ||
			resolvesAsFile(join(ROOT, workspace.dir, "src", suffix.slice(1)))
		);
	}
	for (const field of ["types", "module", "main"] as const) {
		const target = workspace.manifest[field];
		if (typeof target === "string" && resolvesAsFile(join(ROOT, workspace.dir, target)))
			return true;
	}
	return (
		resolvesAsFile(join(ROOT, workspace.dir, "src", "index")) ||
		resolvesAsFile(join(ROOT, workspace.dir, "index"))
	);
}

function packageName(specifier: string): string {
	const parts = specifier.split("/");
	return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function externalPackageExists(specifier: string, fromDirectory: string): boolean {
	const name = packageName(specifier);
	let directory = fromDirectory;
	for (;;) {
		if (existsSync(join(directory, "node_modules", name))) return true;
		const parent = dirname(directory);
		if (parent === directory) return false;
		directory = parent;
	}
}

function isBuiltinOrProtocol(specifier: string): boolean {
	const normalized = specifier.replace(/^node:/, "");
	return (
		BUILTINS.has(specifier) ||
		BUILTINS.has(normalized) ||
		specifier === "bun" ||
		specifier.startsWith("bun:") ||
		/^[a-z][a-z\d+.-]*:/i.test(specifier)
	);
}

const ignoredTargetCache = new Map<string, boolean>();
function isIgnoredTarget(path: string): boolean {
	const repoRelative = relative(ROOT, withoutQueryOrHash(path)).split("\\").join("/");
	if (repoRelative === "" || repoRelative === ".." || repoRelative.startsWith("../")) return false;
	const cached = ignoredTargetCache.get(repoRelative);
	if (cached !== undefined) return cached;
	const result = Bun.spawnSync(
		["git", "-C", ROOT, "check-ignore", "--quiet", "--no-index", "--", repoRelative],
		{
			stderr: "ignore",
			stdout: "ignore",
		}
	);
	const ignored = result.exitCode === 0;
	ignoredTargetCache.set(repoRelative, ignored);
	return ignored;
}

function collectImports(source: string, file: string): ImportReference[] {
	const scriptKind = (() => {
		switch (extname(file)) {
			case ".tsx":
				return ts.ScriptKind.TSX;
			case ".jsx":
				return ts.ScriptKind.JSX;
			case ".js":
			case ".mjs":
			case ".cjs":
				return ts.ScriptKind.JS;
			default:
				return ts.ScriptKind.TS;
		}
	})();
	const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind);
	const imports: ImportReference[] = [];

	const add = (literal: ts.StringLiteralLike): void => {
		const line = sourceFile.getLineAndCharacterOfPosition(literal.getStart(sourceFile)).line + 1;
		imports.push({ line, specifier: literal.text });
	};
	const visit = (node: ts.Node): void => {
		if (
			(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
			node.moduleSpecifier &&
			ts.isStringLiteralLike(node.moduleSpecifier)
		) {
			add(node.moduleSpecifier);
		} else if (
			ts.isImportEqualsDeclaration(node) &&
			ts.isExternalModuleReference(node.moduleReference) &&
			node.moduleReference.expression &&
			ts.isStringLiteralLike(node.moduleReference.expression)
		) {
			add(node.moduleReference.expression);
		} else if (ts.isCallExpression(node)) {
			const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
			const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
			const argument = node.arguments[0];
			if ((isDynamicImport || isRequire) && argument && ts.isStringLiteralLike(argument))
				add(argument);
		} else if (ts.isImportTypeNode(node)) {
			const argument = node.argument;
			if (ts.isLiteralTypeNode(argument) && ts.isStringLiteralLike(argument.literal))
				add(argument.literal);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return imports.sort(
		(left, right) => left.line - right.line || left.specifier.localeCompare(right.specifier)
	);
}

function typescriptResolves(specifier: string, containingFile: string, config: Config): boolean {
	const resolved = ts.resolveModuleName(
		specifier,
		containingFile,
		config.options,
		ts.sys,
		config.cache
	).resolvedModule;
	return resolved !== undefined;
}

const allFiles = runGit(["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).sort(
	(a, b) => a.localeCompare(b)
);
const trackedFiles = new Set(runGit(["ls-files", "--cached", "-z"]));
const workspaces = discoverWorkspaces(allFiles);
const workspacesBySpecificity = [...workspaces].sort(
	(left, right) => right.dir.length - left.dir.length || left.dir.localeCompare(right.dir)
);
const workspaceByName = new Map(workspaces.map((workspace) => [workspace.name, workspace]));
const configs = new Map<string, Config>();
const errors: Miss[] = [];
const warnings: Miss[] = [];
const missingDeclarations = new Set<string>();
let importCount = 0;

const sourceFiles = allFiles.filter(isSourceFile);
for (const file of sourceFiles) {
	const absoluteFile = join(ROOT, file);
	const owningWorkspace = workspaceForFile(file, workspacesBySpecificity);
	const config = configForWorkspace(owningWorkspace?.dir ?? null, configs);
	let source: string;
	try {
		source = readFileSync(absoluteFile, "utf8");
	} catch {
		continue;
	}

	for (const imported of collectImports(source, file)) {
		const specifier = imported.specifier;
		if (!specifier || isBuiltinOrProtocol(specifier)) continue;
		importCount++;

		const aliases = aliasTargets(specifier, config);
		const internalWorkspace = workspaceByName.get(packageName(specifier));
		if (
			internalWorkspace &&
			owningWorkspace &&
			internalWorkspace.name !== owningWorkspace.name &&
			!declaresDependency(owningWorkspace.manifest, internalWorkspace.name)
		) {
			const key = `${owningWorkspace.name}\0${internalWorkspace.name}`;
			if (!missingDeclarations.has(key)) {
				missingDeclarations.add(key);
				errors.push({ file, kind: "manifest", ...imported });
			}
		}
		let kind: Miss["kind"];
		let valid: boolean;
		if (specifier.startsWith(".")) {
			kind = "relative";
			const target = resolve(dirname(absoluteFile), specifier);
			valid =
				resolvesAsFile(target) ||
				typescriptResolves(specifier, absoluteFile, config) ||
				isIgnoredTarget(target);
		} else if (aliases !== null || internalWorkspace) {
			kind = aliases !== null ? "alias" : "workspace";
			valid =
				(aliases?.some((target) => resolvesAsFile(target) || isIgnoredTarget(target)) ?? false) ||
				(internalWorkspace ? resolveWorkspaceImport(specifier, internalWorkspace) : false);
		} else {
			kind = "external";
			valid = externalPackageExists(specifier, dirname(absoluteFile));
		}

		if (!valid) {
			const miss = { file, kind, ...imported };
			(kind === "external" ? warnings : errors).push(miss);
		}
	}
}

const byLocation = (left: Miss, right: Miss): number =>
	left.file.localeCompare(right.file) ||
	left.line - right.line ||
	left.specifier.localeCompare(right.specifier);
errors.sort(byLocation);
warnings.sort(byLocation);

const trackedSourceCount = sourceFiles.filter((file) => trackedFiles.has(file)).length;
console.log(
	`Imports checked: ${importCount} in ${sourceFiles.length} source files ` +
		`(${trackedSourceCount} tracked, ${sourceFiles.length - trackedSourceCount} new non-ignored).`
);
console.log(`Workspaces discovered: ${workspaces.length}.`);

if (warnings.length > 0) {
	const counts = new Map<string, number>();
	for (const warning of warnings) {
		const name = packageName(warning.specifier);
		counts.set(name, (counts.get(name) ?? 0) + 1);
	}
	console.log(
		`\nWarning: ${warnings.length} unresolved external import(s) across ${counts.size} package(s), non-blocking:`
	);
	for (const [name, count] of [...counts].sort(([left], [right]) => left.localeCompare(right))) {
		console.log(`  ${name}: ${count}`);
	}
	if (process.env.CHECK_IMPORTS_VERBOSE === "1") {
		console.log("\nExternal import locations:");
		for (const warning of warnings) {
			console.log(`  ${warning.file}:${warning.line} -> "${warning.specifier}"`);
		}
	}
}

if (errors.length === 0) {
	console.log("\nOK: every internal import resolves and workspace dependencies are declared.");
	process.exit(0);
}

console.error(`\nERROR: ${errors.length} unresolved internal import(s):`);
for (const error of errors) {
	console.error(`  ${error.file}:${error.line} [${error.kind}] -> "${error.specifier}"`);
}
process.exit(1);
