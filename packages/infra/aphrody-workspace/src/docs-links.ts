import { readdir, readFile, stat } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";

async function getFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const res = join(dir, entry.name);
      return entry.isDirectory() ? getFiles(res) : res;
    }),
  );
  return files.flat().filter((f) => f.endsWith(".md") || f.endsWith(".mdx"));
}

async function verifyPath(filePath: string): Promise<boolean> {
  try {
    const s = await stat(filePath);
    return s.isFile() || s.isDirectory();
  } catch {
    return false;
  }
}

function documentationRouteCandidates(docsDir: string, route: string): string[] {
  const relativeRoute = route.replace(/^\/+/, "").split(/[?#]/, 1)[0] ?? "";
  if (relativeRoute.split(/[\\/]/).includes("..")) return [];
  const page = join(docsDir, relativeRoute);
  return [page, `${page}.md`, `${page}.mdx`, join(page, "index.md"), join(page, "index.mdx")];
}

export async function runDocsLinks(args: string[]): Promise<number> {
  let root = process.cwd();
  let docs = "docs";
  let scope: "docs" | "repository" = "docs";
  let webRoutes = false;
  let json = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--root") root = args[++index] ?? "";
    else if (arg === "--docs") docs = args[++index] ?? "";
    else if (arg === "--scope") {
      const value = args[++index];
      if (value !== "docs" && value !== "repository")
        throw new Error("--scope must be docs or repository");
      scope = value;
    } else if (arg === "--web-routes") webRoutes = true;
    else if (arg === "--json") json = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: aphrody-ops docs-links [--root <repository>] [--docs <directory>] [--scope docs|repository] [--web-routes] [--json]",
      );
      return 0;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!root || !docs) throw new Error("--root and --docs require a path");
  const ROOT_DIR = resolve(root);
  const DOCS_DIR = resolve(ROOT_DIR, docs);
  if (!json) console.log("🔗 Vérification des liens de documentation...");

  const files = await getFiles(DOCS_DIR);
  if (scope === "repository") {
    const rootEntries = await readdir(ROOT_DIR, { withFileTypes: true });
    for (const entry of rootEntries)
      if (entry.isFile() && entry.name.endsWith(".md")) files.push(join(ROOT_DIR, entry.name));
  }
  let totalLinks = 0;
  let brokenLinks = 0;
  const findings: Array<{ file: string; link: string; target: string }> = [];

  for (const file of files) {
    // Ignorer les fichiers de bundle générés qui contiennent beaucoup de liens absolus virtuels
    if (file.endsWith("llms.txt") || file.endsWith("llms-full.txt")) continue;

    // `docs/reference/` est recopié depuis des documentations externes par la
    // tâche cron `external-docs` : ses liens pointent vers les sites d'origine
    // (`/docs/concepts/...`, `./LICENSE.md`) et n'ont aucun sens ici. Les
    // vérifier ne signalerait que du bruit qu'on ne peut pas corriger — toute
    // édition manuelle y est de toute façon écrasée.
    if (file.includes("/docs/reference/")) continue;
    if (
      file.includes("/docs/_root/") ||
      file.includes("/docs/aphrody-os/n2b/node/") ||
      file.includes("/docs/n2b/node/") ||
      file.includes("/docs/n2b/bun/") ||
      file.includes("/apps/bxc/specs/") ||
      file.includes("/apps/bxc/.agents/skills/rust-best-practices/")
    )
      continue;

    const content = await readFile(file, "utf-8");
    const relativeFile = file.replace(ROOT_DIR, "").replace(/^\//, "");
    const fileDir = dirname(file);

    // Retirer les blocs de code (fenced et inline) pour éviter de valider de faux liens dans des exemples de code
    const cleanContent = content.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]+`/g, "");

    // Regex pour capturer les liens Markdown [texte](url)
    // Ignorer les URLs externes commençant par http/https/mailto
    const linkRegex = /\[[^\]]*?\]\(([^)]+?)\)/g;
    let match;

    while ((match = linkRegex.exec(cleanContent)) !== null) {
      const linkUrl = match[1]?.trim() ?? "";

      // Ignorer les liens externes
      if (
        linkUrl.startsWith("http://") ||
        linkUrl.startsWith("https://") ||
        linkUrl.startsWith("mailto:")
      ) {
        continue;
      }

      // Ignorer les ancres de même page (#...)
      if (linkUrl.startsWith("#")) {
        continue;
      }

      totalLinks++;
      let targets: string[];

      if (linkUrl.startsWith("file:///")) {
        // Lien absolu virtuel par rapport à la racine du monorepo (ex: file:///docs/PLAN.md)
        const subPath = linkUrl.replace("file:///", "");
        targets = [join(ROOT_DIR, subPath)];
      } else if (webRoutes && linkUrl.startsWith("/")) {
        // Mint and similar static documentation sites use root-relative routes.
        // Resolve those routes against the configured docs tree rather than the
        // workstation filesystem, while requiring a matching source page.
        targets = documentationRouteCandidates(DOCS_DIR, linkUrl);
      } else {
        // Lien relatif (ex: ./database.md ou ../packages/...)
        // Supprimer l'ancre si elle existe (ex: database.md#cache-redis)
        const urlWithoutAnchor = linkUrl.split("#")[0] || "";
        if (!urlWithoutAnchor) continue;
        targets = [resolve(fileDir, urlWithoutAnchor)];
      }

      const exists = (await Promise.all(targets.map(verifyPath))).some(Boolean);
      if (!exists) {
        const targetPath = targets[0] ?? "<invalid route>";
        findings.push({ file: relativeFile, link: linkUrl, target: targetPath });
        if (!json)
          console.error(
            `❌ Lien cassé dans [${relativeFile}] : "${linkUrl}" (Cible non trouvée: ${targetPath})`,
          );
        brokenLinks++;
      }
    }
  }

  if (json)
    console.log(
      JSON.stringify(
        { scanned: files.length, links: totalLinks, broken: brokenLinks, findings },
        null,
        2,
      ),
    );
  else {
    console.log(`\n📊 Bilan de la vérification :`);
    console.log(`   - Liens locaux vérifiés : ${totalLinks}`);
    console.log(`   - Liens cassés trouvés  : ${brokenLinks}`);
  }

  if (brokenLinks > 0) {
    return 1;
  } else {
    if (!json) console.log("💚 Tous les liens internes sont valides !");
    return 0;
  }
}

if (import.meta.main) process.exit(await runDocsLinks(process.argv.slice(2)));
