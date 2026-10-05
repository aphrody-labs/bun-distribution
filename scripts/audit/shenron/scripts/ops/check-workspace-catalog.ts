#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0

import { Glob } from "bun";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const manifest = (await Bun.file(join(root, "package.json")).json()) as {
	workspaces?: string[] | { packages?: string[]; catalog?: Record<string, string> };
};
const workspace = manifest.workspaces;
const patterns = Array.isArray(workspace) ? workspace : (workspace?.packages ?? []);
const catalog = Array.isArray(workspace) ? {} : (workspace?.catalog ?? {});
const excluded = new Set<string>();

for (const pattern of patterns.filter((entry) => entry.startsWith("!"))) {
	const glob = new Glob(`${pattern.slice(1)}/package.json`);
	for await (const file of glob.scan({ cwd: root, onlyFiles: true }))
		excluded.add(resolve(root, file));
}

const manifests = new Set<string>();
for (const pattern of patterns.filter((entry) => !entry.startsWith("!"))) {
	const glob = new Glob(`${pattern}/package.json`);
	for await (const file of glob.scan({ cwd: root, onlyFiles: true })) {
		const path = resolve(root, file);
		// Adjacent source workspaces keep their own catalogs and package policy.
		if (relative(root, path).startsWith("..")) continue;
		if (!excluded.has(path)) manifests.add(path);
	}
}

const errors: string[] = [];
for (const path of [...manifests].toSorted()) {
	const pkg = (await Bun.file(path).json()) as {
		name?: string;
		dependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
		optionalDependencies?: Record<string, string>;
	};
	for (const group of [pkg.dependencies, pkg.devDependencies, pkg.optionalDependencies]) {
		for (const [name, version] of Object.entries(group ?? {})) {
			if (
				version.startsWith("workspace:") ||
				version.startsWith("file:") ||
				version.startsWith("link:")
			)
				continue;
			if (name in catalog && version !== "catalog:") {
				errors.push(`${pkg.name ?? path}: ${name}=${version}, attendu catalog:`);
			}
			if (version === "catalog:" && !(name in catalog)) {
				errors.push(`${pkg.name ?? path}: ${name} référence un catalogue absent`);
			}
		}
	}
}

if (errors.length) {
	console.error(
		`✗ ${errors.length} écart(s) au catalogue workspace :\n${errors.map((error) => `- ${error}`).join("\n")}`
	);
	process.exit(1);
}
console.log(
	`✓ ${manifests.size} manifests workspace respectent le catalogue (${Object.keys(catalog).length} entrées).`
);
