/**
 * Script de scan GitHub pour les projets Dragon Ball / DBZ.
 * Utilise l'API Search de GitHub pour trouver des repos intéressants.
 *
 * Usage: bun scripts/scan-github.ts [--json]
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const KEYWORDS = ["dbz", "dragon ball", "dragonball"];
const OUTPUT_DIR = "reports";

interface Repo {
	name: string;
	full_name: string;
	description: string;
	html_url: string;
	stargazers_count: number;
	language: string;
	updated_at: string;
	topics: string[];
}

async function searchGithub(query: string): Promise<Repo[]> {
	console.log(`🔍 Recherche GitHub pour: "${query}"...`);

	const url = new URL("https://api.github.com/search/repositories");
	url.searchParams.set("q", query);
	url.searchParams.set("sort", "stars");
	url.searchParams.set("order", "desc");
	url.searchParams.set("per_page", "100");

	const headers: Record<string, string> = {
		Accept: "application/vnd.github.v3+json",
		"User-Agent": "Shenron-Scanner-Bot",
	};

	if (GITHUB_TOKEN) {
		headers["Authorization"] = `token ${GITHUB_TOKEN}`;
	} else {
		console.warn("⚠️ Pas de GITHUB_TOKEN détecté. Le rate limit sera très bas (60 req/h).");
	}

	const res = await fetch(url.toString(), { headers });

	if (!res.ok) {
		const error = await res.text();
		throw new Error(`GitHub API error (${res.status}): ${error}`);
	}

	const data = await res.json();
	return data.items as Repo[];
}

async function main() {
	const allRepos = new Map<string, Repo>();

	try {
		for (const kw of KEYWORDS) {
			const repos = await searchGithub(kw);
			for (const repo of repos) {
				allRepos.set(repo.full_name, repo);
			}
			// Petit sleep pour éviter le rate limit si pas de token
			if (!GITHUB_TOKEN) await new Promise((r) => setTimeout(r, 2000));
		}

		const sortedRepos = Array.from(allRepos.values()).toSorted(
			(a, b) => b.stargazers_count - a.stargazers_count
		);

		// Génération du rapport Markdown
		let md = `# 🐉 Rapport de Scan GitHub — Dragon Ball\n\n`;
		md += `Généré le : ${new Date().toLocaleString("fr-FR")}\n`;
		md += `Total de projets uniques trouvés : **${sortedRepos.length}**\n\n`;
		md += `| Projet | Stars | Langage | Description |\n`;
		md += `| :--- | :--- | :--- | :--- |\n`;

		for (const repo of sortedRepos) {
			const desc = (repo.description || "Pas de description").replace(/\|/g, "\\|");
			md += `| [${repo.full_name}](${repo.html_url}) | ⭐ ${repo.stargazers_count} | ${repo.language || "N/A"} | ${desc} |\n`;
		}

		mkdirSync(OUTPUT_DIR, { recursive: true });
		const filename = `github-scan-${new Date().toISOString().split("T")[0]}.md`;
		const path = join(OUTPUT_DIR, filename);

		await Bun.write(path, md);

		console.log(`\n✅ Scan terminé !`);
		console.log(`📊 ${sortedRepos.length} projets trouvés.`);
		console.log(`📄 Rapport généré : ${path}`);

		if (process.argv.includes("--json")) {
			const jsonPath = path.replace(".md", ".json");
			await Bun.write(jsonPath, JSON.stringify(sortedRepos, null, 2));
			console.log(`📄 Données JSON : ${jsonPath}`);
		}
	} catch (err) {
		console.error("❌ Erreur lors du scan:", err);
		process.exit(1);
	}
}

main();
