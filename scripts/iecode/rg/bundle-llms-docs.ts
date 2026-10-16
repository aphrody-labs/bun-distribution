import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const ROOT_DIR = resolve(import.meta.dirname, "..");
const DOCS_DIR = join(ROOT_DIR, "docs");

interface DocMeta {
  title: string;
  description: string;
  scope: string[];
  status: string;
  relativePath: string;
  fullPath: string;
  content: string;
}

// Simple YAML frontmatter parser
function parseFrontmatter(fileContent: string): { data: Record<string, any>; content: string } {
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;
  const match = fileContent.match(frontmatterRegex);

  if (!match) {
    return { data: {}, content: fileContent };
  }

  const yamlBlock = match[1];
  const content = fileContent.replace(frontmatterRegex, "");
  const data: Record<string, any> = {};

  const lines = yamlBlock.split("\n");
  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    let val = line.slice(colonIdx + 1).trim();

    // Remove quotes
    if (val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1);
    } else if (val.startsWith("'") && val.endsWith("'")) {
      val = val.slice(1, -1);
    }

    // Parse arrays
    if (val.startsWith("[") && val.endsWith("]")) {
      try {
        data[key] = val
          .slice(1, -1)
          .split(",")
          .map(s => s.trim().replace(/^['"]|['"]$/g, ""))
          .filter(Boolean);
      } catch {
        data[key] = val;
      }
    } else {
      data[key] = val;
    }
  }

  return { data, content };
}

async function getFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(entry => {
      const res = join(dir, entry.name);
      return entry.isDirectory() ? getFiles(res) : res;
    }),
  );
  return files.flat().filter(f => f.endsWith(".md") || f.endsWith(".mdx"));
}

async function bundle() {
  console.log("📦 Concaténation de la documentation pour le RAG / LLM...");

  const files = await getFiles(DOCS_DIR);
  // Trier pour mettre REPO_MAP et PLAN en premier
  files.sort((a, b) => {
    if (a.includes("REPO_MAP.md")) return -1;
    if (b.includes("REPO_MAP.md")) return 1;
    if (a.includes("PLAN.md")) return -1;
    if (b.includes("PLAN.md")) return 1;
    return a.localeCompare(b);
  });

  const docs: DocMeta[] = [];

  for (const file of files) {
    // Ignorer les fichiers de bundle eux-mêmes pour éviter une récursion
    if (file.endsWith("llms.txt") || file.endsWith("llms-full.txt")) continue;

    const rawContent = await readFile(file, "utf-8");
    const { data, content } = parseFrontmatter(rawContent);
    const relativePath = file.replace(ROOT_DIR, "").replace(/^\//, "");

    docs.push({
      title: data.title || content.match(/^#\s+(.+)$/m)?.[1] || relativePath,
      description: data.description || "Aucune description fournie.",
      scope: data.scope || ["general"],
      status: data.status || "stable",
      relativePath,
      fullPath: file,
      content,
    });
  }

  // 1. Générer llms.txt (index curé)
  let llmsTxt = `# Rose Griffon Documentation Index

Bienvenue dans la documentation technique de Rose Griffon. Ce fichier sert d'index structuré pour les assistants IA (Gemini, Claude, GPT) et pointe vers le contenu complet.

* **Documentation complète consolidée (un seul fichier) :** [llms-full.txt](file:///docs/llms-full.txt)

## Sommaire de la documentation

`;

  for (const doc of docs) {
    llmsTxt += `- **[${doc.title}](file:///${doc.relativePath})**
  - *Description :* ${doc.description}
  - *Scope :* ${doc.scope.map(s => `\`${s}\``).join(", ")} (Statut : \`${doc.status}\`)\n\n`;
  }

  // 2. Générer llms-full.txt (corpus concaténé)
  let llmsFullTxt = `# Rose Griffon - Corpus de Documentation Complet

Ce fichier regroupe l'ensemble des documentations techniques du monorepo Rose Griffon pour permettre aux assistants IA de lire tout le contexte en une seule passe.

`;

  for (const doc of docs) {
    llmsFullTxt += `
==================================================================
📖 DEBUT DOCUMENT : ${doc.title} (${doc.relativePath})
==================================================================
Scope: ${doc.scope.join(", ")}
Status: ${doc.status}
------------------------------------------------------------------

${doc.content.trim()}

==================================================================
📖 FIN DOCUMENT : ${doc.title}
==================================================================
`;
  }

  // Ecriture dans docs/
  await writeFile(join(DOCS_DIR, "llms.txt"), llmsTxt);
  await writeFile(join(DOCS_DIR, "llms-full.txt"), llmsFullTxt);
  console.log(`✅ Fichiers créés dans docs/ : llms.txt & llms-full.txt`);

  // Website est l'unique frontend : aucune seconde copie n'est produite.
  //
  // Ce corpus est la documentation INTERNE du monorepo : cartographie des
  // paquets, points d'entrée, scripts, notes d'infrastructure, feuilles de
  // route. L'écrire dans le dossier public le publiait sur
  // `azalee.rosegriffon.fr/llms-full.txt`, à la lecture de tous — y compris des
  // robots d'indexation IA, explicitement autorisés dans notre `robots.txt`.
  //
  // Ce chemin est par ailleurs déjà produit par la tâche planifiée
  // `seo-llms-txt` (`packages/cron/src/tasks/seo/llms-txt.ts`), avec un contenu
  // tourné vers le public. Les deux générateurs se réécrivaient l'un l'autre
  // chaque nuit : `docs:bundle` y posait 5597 lignes de doc interne, le cron les
  // remplaçait par sa version publique. Un seul propriétaire désormais — le
  // cron pour le web, ce script pour `docs/`.
}

bundle().catch(console.error);
