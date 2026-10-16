// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export interface SiteDocument {
  path: string;
  title: string;
  sha256: string;
}
const MARKER = "aphrody-private-documentation-site-v1";
const escape = (value: string): string =>
  value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const inside = (base: string, path: string): boolean =>
  path === base ||
  (!relative(base, path).startsWith(`..${sep}`) && relative(base, path) !== ".." && !isAbsolute(relative(base, path)));
const htmlPath = (path: string): string => `${path}.html`;
const url = (path: string): string =>
  path
    .split(sep === "\\" ? /[\\/]/ : "/")
    .map(encodeURIComponent)
    .join("/");

/** Check every existing ancestor, including dangling links, before reading or writing. */
async function noSymlinks(path: string): Promise<void> {
  const absolute = resolve(path);
  let cursor = absolute;
  for (;;) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- remontée séquentielle de l'arborescence : chaque parent dépend du précédent
      if ((await lstat(cursor)).isSymbolicLink()) throw new Error(`Symlink refused: ${cursor}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}

function sourcePath(path: string): void {
  if (
    isAbsolute(path) ||
    path.includes("\\") ||
    path.split("/").some(part => part === ".." || part === "." || !part) ||
    !/^docs\/.+\.mdx?$/.test(path)
  )
    throw new Error(`Invalid documentation path: ${path}`);
}

function localTarget(path: string, destination: string, allowed: Set<string>): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(destination.split(/[?#]/, 1)[0] ?? "");
  } catch {
    return undefined;
  }
  if (!decoded || decoded.includes("\\") || decoded.startsWith("/") || /^[a-z][a-z\d+.-]*:/i.test(decoded))
    return undefined;
  const target = resolve("/", dirname(path), decoded).slice(1);
  return allowed.has(target) ? target : undefined;
}

/** Conservative renderer: all source HTML/MDX is escaped; only allowlisted document links become anchors. */
function renderMarkdown(text: string, path: string, allowed: Set<string>): string {
  const inline = (line: string): string => {
    let result = "";
    let cursor = 0;
    const links = /!?\[([^\]\n]*)\]\(([^)\n]+)\)/g;
    for (const match of line.matchAll(links)) {
      result += escape(line.slice(cursor, match.index));
      const target = localTarget(path, match[2]!, allowed);
      result += target
        ? `<a href="${escape(url(relative(dirname(htmlPath(path)), htmlPath(target))))}">${escape(match[1]!)}</a>`
        : `<code>${escape(match[1]!)} (${escape(match[2]!)})</code>`;
      cursor = match.index! + match[0].length;
    }
    return result + escape(line.slice(cursor));
  };
  const rendered: string[] = [];
  let fence: string | undefined;
  let code: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) {
        rendered.push(`<pre><code>${escape(code.join("\n"))}</code></pre>`);
        fence = undefined;
        code = [];
      } else code.push(line);
    } else if (marker) fence = marker;
    else {
      const heading = /^(#{1,6})\s+(.+)$/.exec(line);
      if (heading) rendered.push(`<h${heading[1]!.length}>${inline(heading[2]!)}</h${heading[1]!.length}>`);
      else if (line.trim()) rendered.push(`<p>${inline(line)}</p>`);
    }
  }
  if (fence) rendered.push(`<pre><code>${escape(code.join("\n"))}</code></pre>`);
  return rendered.join("\n");
}

function shell(title: string, navigation: string, body: string): string {
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; object-src 'none'"><title>${escape(title)}</title><style>body{font:17px/1.65 system-ui;max-width:1100px;margin:2rem auto;padding:0 1rem;color:#243040;background:#fafbfc}nav{border-bottom:1px solid #ccd;padding-bottom:1rem}nav a{margin-right:1rem}a{color:#174f94}pre,code{background:#eef1f5;overflow-wrap:anywhere}pre{padding:1rem;overflow:auto}h1,h2,h3{line-height:1.3}</style></head><body><nav>${navigation}</nav><main>${body}</main></body></html>\n`;
}

async function filesUnder(directory: string, base = directory): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlink refused: ${path}`);
    // oxlint-disable-next-line no-await-in-loop -- parcours récursif séquentiel : l'ordre des chemins et le premier refus de symlink sont déterministes
    if (entry.isDirectory()) paths.push(...(await filesUnder(path, base)));
    else if (entry.isFile()) paths.push(relative(base, path).split(sep).join("/"));
    else throw new Error(`Unsupported output entry: ${path}`);
  }
  return paths;
}

/** Export an explicitly selected PRIVATE corpus. This function never publishes or deploys it. */
export async function exportDocumentationSite(
  root: string,
  documents: readonly SiteDocument[],
  output: string,
): Promise<{ pages: number; output: string }> {
  root = resolve(root);
  output = resolve(output);
  await noSymlinks(root);
  await noSymlinks(output);
  const cache = join(root, ".cache/documentation-site");
  if (inside(root, output) && !inside(cache, output))
    throw new Error("Output must be under .cache/documentation-site or outside the repository");
  if (inside(output, root)) throw new Error("Output cannot contain the repository");
  const allowed = new Set<string>();
  const loaded: { document: SiteDocument; text: string }[] = [];
  for (const document of documents) {
    sourcePath(document.path);
    if (allowed.has(document.path)) throw new Error(`Duplicate documentation path: ${document.path}`);
    allowed.add(document.path);
    const source = join(root, document.path);
    // oxlint-disable-next-line no-await-in-loop -- documents validés dans l'ordre : la première erreur signalée doit être celle du premier document fautif
    await noSymlinks(source);
    // oxlint-disable-next-line no-await-in-loop -- même validation séquentielle que ci-dessus
    if (!(await lstat(source)).isFile()) throw new Error(`Not a documentation file: ${document.path}`);
    // oxlint-disable-next-line no-await-in-loop -- même validation séquentielle que ci-dessus
    const bytes = await readFile(source);
    if (createHash("sha256").update(bytes).digest("hex") !== document.sha256)
      throw new Error(`SHA mismatch: ${document.path}`);
    loaded.push({ document, text: bytes.toString("utf8") });
  }
  const generated = [
    "index.html",
    "llms.txt",
    "llms-full.txt",
    "robots.txt",
    "export-manifest.json",
    ...documents.flatMap(document => [document.path, htmlPath(document.path)]),
  ];
  let previous: string[] = [];
  try {
    const stat = await lstat(output);
    if (!stat.isDirectory()) throw new Error("Output is not a directory");
    previous = await filesUnder(output);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (previous.length) {
    const manifest = JSON.parse(await readFile(join(output, "export-manifest.json"), "utf8")) as {
      kind?: string;
      files?: string[];
    };
    if (
      manifest.kind !== MARKER ||
      !Array.isArray(manifest.files) ||
      previous.some(file => !manifest.files!.includes(file) || !generated.includes(file))
    )
      throw new Error("Refusing to overwrite unknown output files");
  }
  await mkdir(output, { recursive: true });
  const write = async (path: string, text: string): Promise<void> => {
    await mkdir(dirname(join(output, path)), { recursive: true });
    await writeFile(join(output, path), text);
  };
  const nav = (from: string): string =>
    documents
      .map(
        document =>
          `<a href="${escape(url(relative(dirname(from), htmlPath(document.path))))}">${escape(document.title)}</a>`,
      )
      .join(" ");
  for (const { document, text } of loaded) {
    // oxlint-disable-next-line no-await-in-loop -- écritures séquentielles dans le dossier de sortie : ordre déterministe des pages
    await write(document.path, text);
    const markdown = `<p><a href="${escape(url(relative(dirname(htmlPath(document.path)), document.path)))}">Canonical Markdown</a></p>`;
    // oxlint-disable-next-line no-await-in-loop -- écritures séquentielles dans le dossier de sortie : ordre déterministe des pages
    await write(
      htmlPath(document.path),
      shell(document.title, nav(htmlPath(document.path)), markdown + renderMarkdown(text, document.path, allowed)),
    );
  }
  await write(
    "index.html",
    shell(
      "Private documentation",
      nav("index.html"),
      "<h1>Private documentation</h1><p>Local export. Internal documents are not approved for public distribution.</p>",
    ),
  );
  await write(
    "llms.txt",
    `# Private documentation\n\n${documents.map(document => `- [${document.title.replace(/[\r\n]/g, " ")}](${url(document.path)}): SHA-256 ${document.sha256}`).join("\n")}\n`,
  );
  await write(
    "llms-full.txt",
    loaded
      .map(
        ({ document, text }) => `# ${document.title}\nSource: ${document.path}\nSHA-256: ${document.sha256}\n\n${text}`,
      )
      .join("\n\n---\n\n"),
  );
  await write("robots.txt", "User-agent: *\nDisallow: /\n");
  await write(
    "export-manifest.json",
    `${JSON.stringify({ kind: MARKER, visibility: "private", documents, files: generated }, null, 2)}\n`,
  );
  return { pages: documents.length, output };
}
