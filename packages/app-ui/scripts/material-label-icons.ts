#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Replaces a button's sole verbose label with its Material Symbols icon, keeping the label as aria-label/title.
//   bun scripts/material-label-icons.ts plan|apply|rollback
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";

const APP = resolve(import.meta.dir, "..");
const SRC = join(APP, "src");
const REPO = resolve(APP, "../../..");
const ts: typeof import("typescript") = createRequire(
  join(REPO, "packages/infra/workspace/package.json"),
)("@typescript/typescript6");
const MANIFEST = join(import.meta.dir, "material-label-icons.manifest.json");
const CATALOGUE = join(
  REPO,
  "m3/packages/m3-fonts/fonts/upstream/material-symbols/index.d.ts",
);
const PRIMITIVES = "@aphrody/m3-primitives";
const ICON_SIZE = 18;

export const LABEL_ICONS: Record<string, string> = {
  Save: "save",
  Enregistrer: "save",
  Sauvegarder: "save",
  Cancel: "close",
  Annuler: "close",
  Close: "close",
  Fermer: "close",
  Delete: "delete",
  Supprimer: "delete",
  Search: "search",
  Rechercher: "search",
  Settings: "settings",
  Paramètres: "settings",
  Help: "help",
  Aide: "help",
  Open: "open_in_new",
  Ouvrir: "open_in_new",
  Add: "add",
  Ajouter: "add",
  New: "add",
  Nouveau: "add",
  "New thread": "add",
  "Nouveau fil": "add",
  Edit: "edit",
  Modifier: "edit",
  Copy: "content_copy",
  Copier: "content_copy",
  Download: "download",
  Télécharger: "download",
  Upload: "upload",
  Importer: "upload",
  Refresh: "refresh",
  Actualiser: "refresh",
  Retry: "refresh",
  Réessayer: "refresh",
  Back: "arrow_back",
  Retour: "arrow_back",
  Next: "arrow_forward",
  Suivant: "arrow_forward",
  Preview: "visibility",
  Aperçu: "visibility",
  "Choose folder": "folder_open",
  "Choisir un dossier": "folder_open",
  Send: "send",
  Envoyer: "send",
  Share: "share",
  Partager: "share",
  Stop: "stop",
  Arrêter: "stop",
  Start: "play_arrow",
  Démarrer: "play_arrow",
  Pause: "pause",
  Skip: "skip_next",
  Passer: "skip_next",
  Confirm: "check",
  Confirmer: "check",
  Apply: "check",
  Appliquer: "check",
  Done: "check",
  Terminé: "check",
};

const SKIP_TOP_DIRS = new Set(["material", "generated"]);
const LABEL_ATTRS = ["aria-label", "title"];

type Edit = { start: number; end: number; text: string };
type Hit = { line: number; label: string; icon: string };
type FileRecord = { path: string; before: string; after: string; edits: Hit[] };
type Manifest = { schema: 1; base: string; files: FileRecord[] };

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const rel = (path: string) => relative(REPO, path).replaceAll("\\", "/");

function git(args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", REPO, ...args]);
  if (result.exitCode !== 0)
    throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

function assertIconsExist() {
  const names = new Set(
    [...readFileSync(CATALOGUE, "utf8").matchAll(/"([a-z0-9_]+)"/g)].map(
      (m) => m[1],
    ),
  );
  const missing = [...new Set(Object.values(LABEL_ICONS))].filter(
    (name) => !names.has(name),
  );
  if (missing.length)
    throw new Error(
      `icons absent from the Material Symbols catalogue: ${missing.join(", ")}`,
    );
}

function sourceFiles(dir: string, top = true): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      return top && SKIP_TOP_DIRS.has(entry.name)
        ? []
        : sourceFiles(path, false);
    return entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx")
      ? [path]
      : [];
  });
}

function isButton(tag: ts.JsxTagNameExpression) {
  return (
    ts.isIdentifier(tag) && (tag.text === "Button" || tag.text === "button")
  );
}

function importsForeignIcon(sf: ts.SourceFile) {
  return sf.statements.some((statement) => {
    if (!ts.isImportDeclaration(statement) || !statement.importClause)
      return false;
    if (
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === PRIMITIVES
    )
      return false;
    const clause = statement.importClause;
    const named =
      clause.namedBindings && ts.isNamedImports(clause.namedBindings)
        ? clause.namedBindings.elements
        : [];
    return (
      clause.name?.text === "Icon" ||
      named.some((element) => element.name.text === "Icon")
    );
  });
}

function labelTarget(
  element: ts.JsxElement,
  text: string,
): { label: string; start: number; end: number } | undefined {
  const content = element.children.filter(
    (child) => !(ts.isJsxText(child) && child.containsOnlyTriviaWhiteSpaces),
  );
  if (content.length !== 1) return undefined;
  const only = content[0];
  if (ts.isJsxText(only)) {
    const raw = text.slice(only.pos, only.end);
    const label = raw.trim();
    if (!(label in LABEL_ICONS)) return undefined;
    const start = only.pos + raw.indexOf(label);
    return { label, start, end: start + label.length };
  }
  if (
    ts.isJsxElement(only) &&
    only.openingElement.tagName.getText() === "span"
  ) {
    const inner = only.children.filter(
      (child) => !(ts.isJsxText(child) && child.containsOnlyTriviaWhiteSpaces),
    );
    if (inner.length !== 1 || !ts.isJsxText(inner[0])) return undefined;
    const label = inner[0].getText().trim();
    if (!(label in LABEL_ICONS)) return undefined;
    return { label, start: only.getStart(), end: only.getEnd() };
  }
  return undefined;
}

function transform(path: string, text: string): { text: string; hits: Hit[] } {
  const sf = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  if (importsForeignIcon(sf)) return { text, hits: [] };
  const edits: Edit[] = [];
  const hits: Hit[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) && isButton(node.openingElement.tagName)) {
      const target = labelTarget(node, text);
      if (target) {
        const icon = LABEL_ICONS[target.label];
        const opening = node.openingElement;
        edits.push({
          start: target.start,
          end: target.end,
          text: `<Icon name="${icon}" size={${ICON_SIZE}} />`,
        });
        const present = new Set(
          opening.attributes.properties.flatMap((p) =>
            ts.isJsxAttribute(p) ? [p.name.getText()] : [],
          ),
        );
        const missing = LABEL_ATTRS.filter((attr) => !present.has(attr));
        if (missing.length) {
          const pos = opening.tagName.getEnd();
          edits.push({
            start: pos,
            end: pos,
            text: missing.map((a) => ` ${a}="${target.label}"`).join(""),
          });
        }
        hits.push({
          line: sf.getLineAndCharacterOfPosition(target.start).line + 1,
          label: target.label,
          icon,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (edits.length === 0) return { text, hits };

  const primitives = sf.statements.find(
    (s): s is ts.ImportDeclaration =>
      ts.isImportDeclaration(s) &&
      ts.isStringLiteral(s.moduleSpecifier) &&
      s.moduleSpecifier.text === PRIMITIVES,
  );
  const named = primitives?.importClause?.namedBindings;
  if (primitives && named && ts.isNamedImports(named)) {
    if (!named.elements.some((e) => e.name.text === "Icon")) {
      const pos = named.getStart() + 1;
      edits.push({ start: pos, end: pos, text: "Icon, " });
    }
  } else {
    const imports = sf.statements.filter(ts.isImportDeclaration);
    const pos = imports.length ? imports[imports.length - 1].getEnd() : 0;
    edits.push({
      start: pos,
      end: pos,
      text: `\nimport { Icon } from "${PRIMITIVES}";`,
    });
  }

  let out = text;
  for (const edit of edits.toSorted((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return { text: out, hits };
}

function scan() {
  assertIconsExist();
  const results: {
    file: string;
    original: string;
    changed: string;
    hits: Hit[];
  }[] = [];
  for (const file of sourceFiles(SRC)) {
    const original = readFileSync(file, "utf8");
    const { text, hits } = transform(file, original);
    if (hits.length) results.push({ file, original, changed: text, hits });
  }
  return results;
}

function plan() {
  const results = scan();
  let total = 0;
  for (const r of results) {
    total += r.hits.length;
    for (const h of r.hits)
      console.log(`${rel(r.file)}:${h.line}  "${h.label}" -> ${h.icon}`);
  }
  console.log(`plan: ${total} libellés dans ${results.length} fichiers`);
}

function apply() {
  if (existsSync(MANIFEST))
    throw new Error("manifest présent : lancer rollback avant apply");
  const results = scan();
  if (results.length === 0) {
    console.log("apply: rien à changer");
    return;
  }
  const base = git(["rev-parse", "HEAD"]);
  const files: FileRecord[] = [];
  for (const r of results) {
    writeFileSync(r.file, r.changed);
    files.push({
      path: rel(r.file),
      before: sha(r.original),
      after: sha(r.changed),
      edits: r.hits,
    });
  }
  const manifest: Manifest = { schema: 1, base, files };
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  const total = files.reduce((n, f) => n + f.edits.length, 0);
  console.log(
    `apply: ${total} libellés dans ${files.length} fichiers ; manifeste ${rel(MANIFEST)} (base ${base.slice(0, 12)})`,
  );
}

function rollback() {
  if (!existsSync(MANIFEST)) throw new Error("aucun manifeste à annuler");
  const manifest: Manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const drifted = manifest.files.filter(
    (f) => sha(readFileSync(join(REPO, f.path), "utf8")) !== f.after,
  );
  if (drifted.length) {
    throw new Error(
      `fichiers modifiés depuis apply, rollback refusé : ${drifted.map((f) => f.path).join(", ")}`,
    );
  }
  for (const f of manifest.files)
    git(["checkout", manifest.base, "--", f.path]);
  unlinkSync(MANIFEST);
  console.log(
    `rollback: ${manifest.files.length} fichiers restaurés depuis ${manifest.base.slice(0, 12)}`,
  );
}

const command = process.argv[2];
if (command === "plan") plan();
else if (command === "apply") apply();
else if (command === "rollback") rollback();
else {
  console.error(
    "usage: bun scripts/material-label-icons.ts plan|apply|rollback",
  );
  process.exit(2);
}
