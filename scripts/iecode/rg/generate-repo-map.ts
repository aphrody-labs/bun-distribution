import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const ROOT_DIR = resolve(import.meta.dirname, "..");
const DOCS_DIR = join(ROOT_DIR, "docs");

interface PackageMeta {
	name: string;
	path: string;
	version: string;
	description: string;
	dependencies: string[];
	devDependencies: string[];
	scripts: Record<string, string>;
	entrypoints: string[];
}

async function getDirPackages(parentDir: string): Promise<PackageMeta[]> {
	const result: PackageMeta[] = [];
	try {
		const entries = await readdir(parentDir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;

			const pkgPath = join(parentDir, entry.name);
			const pkgJsonPath = join(pkgPath, "package.json");

			try {
				const raw = await readFile(pkgJsonPath, "utf-8");
				const parsed = JSON.parse(raw);

				// Trouver les entrypoints typiques
				const entrypoints: string[] = [];
				const possibleEntries = [
					"src/index.ts",
					"src/index.js",
					"src/main.ts",
					"src/main.js",
					"app/page.tsx",
					"app/route.ts",
					"src/tasks/ie-crawl/index.ts",
				];

				for (const p of possibleEntries) {
					try {
						const exists = await readFile(join(pkgPath, p), "utf-8");
						if (exists) {
							entrypoints.push(p);
						}
					} catch {}
				}

				result.push({
					name: parsed.name || entry.name,
					path: pkgPath.replace(ROOT_DIR, "").replace(/^\//, ""),
					version: parsed.version || "0.0.0",
					description: parsed.description || "Aucune description fournie.",
					dependencies: Object.keys(parsed.dependencies || {}),
					devDependencies: Object.keys(parsed.devDependencies || {}),
					scripts: parsed.scripts || {},
					entrypoints,
				});
			} catch {}
		}
	} catch (err) {
		console.warn(`[Map Generator] Impossible de lire ${parentDir} :`, err);
	}
	return result;
}

async function generate() {
	console.log("🗺️ Génération de la cartographie du repo...");
	const apps = await getDirPackages(join(ROOT_DIR, "apps"));
	const packages = await getDirPackages(join(ROOT_DIR, "packages"));

	let md = `---
title: "Cartographie du Monorepo"
description: "Structure et dépendances des packages et applications du monorepo Rose Griffon"
scope: ["monorepo"]
status: "stable"
last_updated: "${new Date().toISOString().split("T")[0]}"
---

# 🗺️ Cartographie du Monorepo

Ce document cartographie la structure complète du monorepo **Rose Griffon**. Il est maintenu automatiquement et sert de source de vérité pour les développeurs et les assistants IA (Gemini, Claude) afin de comprendre les responsabilités et connexions de chaque module.

## 🚀 Applications (\`apps/\`)

Applications autonomes prêtes à être déployées :

`;

	for (const app of apps) {
		md += `### 📁 [${app.name}](file:///${app.path})
* **Chemin :** \`${app.path}\`
* **Description :** ${app.description}
* **Version :** \`${app.version}\`
${app.entrypoints.length > 0 ? `* **Points d'entrée clés :**\n${app.entrypoints.map((e) => `  - [\`${e}\`](file:///${app.path}/${e})`).join("\n")}\n` : ""}
* **Scripts disponibles :**
${
	Object.keys(app.scripts).length > 0
		? Object.entries(app.scripts)
				.map(([name, cmd]) => `  - \`bun run ${name}\` : \`${cmd}\``)
				.join("\n")
		: "  - Aucun script disponible."
}

* **Dépendances internes & externes :**
  - **Dependencies :** ${app.dependencies.length > 0 ? app.dependencies.map((d) => `\`${d}\``).join(", ") : "Aucune"}
  - **DevDependencies :** ${app.devDependencies.length > 0 ? app.devDependencies.map((d) => `\`${d}\``).join(", ") : "Aucune"}

---

`;
	}

	md += `\n## 📦 Packages (\`packages/\`)

Packages partagés consommés par les applications :

`;

	for (const pkg of packages) {
		md += `### 📁 [${pkg.name}](file:///${pkg.path})
* **Chemin :** \`${pkg.path}\`
* **Description :** ${pkg.description}
* **Version :** \`${pkg.version}\`
${pkg.entrypoints.length > 0 ? `* **Points d'entrée clés :**\n${pkg.entrypoints.map((e) => `  - [\`${e}\`](file:///${pkg.path}/${e})`).join("\n")}\n` : ""}
* **Scripts disponibles :**
${
	Object.keys(pkg.scripts).length > 0
		? Object.entries(pkg.scripts)
				.map(([name, cmd]) => `  - \`bun run ${name}\` : \`${cmd}\``)
				.join("\n")
		: "  - Aucun script disponible."
}

* **Dépendances internes & externes :**
  - **Dependencies :** ${pkg.dependencies.length > 0 ? pkg.dependencies.map((d) => `\`${d}\``).join(", ") : "Aucune"}
  - **DevDependencies :** ${pkg.devDependencies.length > 0 ? pkg.devDependencies.map((d) => `\`${d}\``).join(", ") : "Aucune"}

---

`;
	}

	md += `\n## 🔄 Dépendances croisées (Workspace Dependencies)

Voici les relations d'importation interne au sein du monorepo :

\`\`\`mermaid
graph TD
`;

	const all = [...apps, ...packages];
	for (const item of all) {
		const workspaceDeps = item.dependencies.filter(
			(d) => d.startsWith("@rosegriffon/") || d.startsWith("@aphrody-code/")
		);
		for (const dep of workspaceDeps) {
			md += `    ${item.name.replace(/[@/-]/g, "_")} --> ${dep.replace(/[@/-]/g, "_")}\n`;
		}
	}
	md += `\`\`\`\n`;

	const outputPath = join(DOCS_DIR, "REPO_MAP.md");
	await writeFile(outputPath, md);
	console.log(`✅ Cartographie générée dans : ${outputPath}`);
}

generate().catch(console.error);
