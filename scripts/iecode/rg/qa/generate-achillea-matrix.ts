import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const web = join(root, "apps/rg-website/src/app/achillea");
const api = join(root, "apps/api/src/modules/achillea");
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
const rel = (path: string) => relative(root, path).replaceAll("\\", "/");
const lines = [
  "# Achilléa — matrice QA navigateur et API",
  "",
  "Inventaire du code. **À tester** signifie qu'aucune preuve en session navigateur authentifiée n'est consignée ici. Pour valider, noter la date, la release, l'URL, le rôle, l'action, le résultat observé et une trace sans secret ni cookie.",
  "",
  "## Parcours requis",
  "",
  "- Visiteur : ouvrir chaque page publique, suivre chaque lien et utiliser les filtres de lecture sans connexion.",
  "- Joueur : tester modes, recherches, filtres, pagination, états vides, chargement et erreurs; rapprocher UI et réponses API.",
  "- Organisateur, arbitre, administrateur : tester chaque action autorisée et son refus pour les rôles insuffisants. Effectuer les mutations sensibles sur des données de test réversibles.",
  "- Accessibilité : clavier, focus, lecteur d'écran, zoom 200 %, texte de 18 px minimum, contraste et petit écran.",
  "- Données : confronter tournois, brackets, points, palmarès, rangs, historiques et profils à l'API et à la base. Ne jamais inventer un résultat absent.",
  "",
  "## Routes web",
  "",
  "| Route | Source et contrôles directs à tester | Visiteur | Joueur | Rôle dédié | Preuve / anomalie |",
  "|---|---|---|---|---|---|",
];
for (const page of walk(web)
  .filter(path => path.endsWith("page.tsx"))
  .sort()) {
  const route =
    "/achillea" +
    relative(web, page)
      .replaceAll("\\", "/")
      .replace(/\/page\.tsx$/, "")
      .replace(/^page\.tsx$/, "")
      .replace(/^([^/])/, "/$1");
  const text = readdirSync(join(page, ".."))
    .filter(name => name.endsWith(".tsx"))
    .map(name => readFileSync(join(page, "..", name), "utf8"))
    .join("\n");
  const controls = [
    ["boutons", /<button\b/g],
    ["liens", /<Link\b/g],
    ["champs", /<input\b/g],
    ["sélecteurs", /<select\b/g],
    ["formulaires", /<form\b/g],
  ] as const;
  const counts =
    controls
      .map(([name, pattern]) => `${[...text.matchAll(pattern)].length} ${name}`)
      .filter(value => !value.startsWith("0 "))
      .join(", ") || "composants importés ou page statique : inspecter les composants liés";
  lines.push(`| \`${route}\` | \`${rel(page)}\`; ${counts} | À tester | À tester | À tester si applicable | — |`);
}
lines.push(
  "",
  "## Contrôles UI directs",
  "",
  "Chaque contrôle trouvé dans les composants TSX Achilléa a sa propre ligne. Les composants partagés importés doivent aussi être parcourus dans le navigateur, même s'ils ne figurent pas dans cet inventaire statique. Le sélecteur est une aide de repérage, pas une preuve que le contrôle est visible ou fonctionne.",
  "",
  "| Contrôle | Source | Repère dans le code | Action et résultat | Preuve / anomalie |",
  "|---|---|---|---|---|",
);
for (const source of walk(web)
  .filter(path => path.endsWith(".tsx"))
  .sort()) {
  const content = readFileSync(source, "utf8");
  for (const match of content.matchAll(/<(button|input|select|textarea|form|Link)\b/g)) {
    const line = content.slice(0, match.index).split("\n").length;
    const snippet = content
      .slice(match.index, match.index + 240)
      .replace(/\s+/g, " ")
      .replaceAll("|", "\\|")
      .replaceAll("`", "'");
    lines.push(`| ${match[1]} | \`${rel(source)}:${line}\` | \`${snippet}\` | À tester | — |`);
  }
}
lines.push(
  "",
  "## Routes API",
  "",
  "Préfixe public `/achillea` sous le point d'entrée API. Pour chaque endpoint : accès anonyme, session joueur, rôle autorisé, filtres, validation et effet DB. Les mutations exigent des données de test réversibles.",
  "",
  "| Méthode | Chemin | Source | Anonyme | Session / rôle | Preuve / anomalie |",
  "|---|---|---|---|---|---|",
);
for (const source of walk(api)
  .filter(path => path.endsWith("index.ts") || path.endsWith("admin.ts"))
  .sort()) {
  const content = readFileSync(source, "utf8");
  const prefix = content.match(/new Elysia\(\{\s*prefix:\s*"([^"]+)"/)?.[1];
  if (!prefix || source === join(api, "index.ts")) continue;
  for (const match of content.matchAll(/\.(get|post|put|patch|delete)\s*\(\s*["']([^"']+)["']/g)) {
    const [method, path] = [match[1]!.toUpperCase(), match[2]!];
    const line = content.slice(0, match.index).split("\n").length;
    lines.push(
      `| ${method} | \`/achillea${prefix}${path.startsWith("/") ? path : `/${path}`}\` | \`${rel(source)}:${line}\` | À tester | À tester | — |`,
    );
  }
}
lines.push(
  "",
  "## Journal de preuves",
  "",
  "| Date UTC | Environnement / release | Session et rôle | Route et action | Résultat observé | Trace | État |",
  "|---|---|---|---|---|---|---|",
  "| — | — | — | — | — | — | À tester |",
  "",
  "L'inventaire du code ne prouve aucun résultat de navigateur. Ajouter les traces de chaque parcours après la release.",
  "",
);
writeFileSync(join(root, "docs/achillea-qa-matrix.md"), lines.join("\n"));
