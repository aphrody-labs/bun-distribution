// SPDX-License-Identifier: Apache-2.0
// Pages Router -> App Router hints. Nothing is rewritten: a Pages app moves one route at a time, so the useful output
// is a plan: where each file goes and what each feature becomes.
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

export interface PagesHint {
  /** Project-relative source file. */
  file: string;
  /** Where it goes in `app/`. */
  target: string;
  kind: "route" | "layout" | "document" | "error" | "api" | "other";
  notes: string[];
}

/* oxlint-disable eslint/no-await-in-loop -- directory entries and files are visited in order, so the plan is deterministic */
const SKIP = new Set(["node_modules", ".next", "dist", "out", ".git", ".turbo"]);

/** `pages/blog/[slug].tsx` -> `app/blog/[slug]/page.tsx`. */
export function appTarget(relPath: string): { target: string; kind: PagesHint["kind"] } {
  const path = relPath.replace(/\\/g, "/").replace(/^(src\/)?pages\//, "");
  const ext = /\.(tsx?|jsx?|mdx?)$/.exec(path)?.[0] ?? "";
  const stem = path.slice(0, path.length - ext.length);
  const prefix = relPath.startsWith("src/") ? "src/app" : "app";
  if (stem === "_app") return { target: `${prefix}/layout${ext}`, kind: "layout" };
  if (stem === "_document") return { target: `${prefix}/layout${ext}`, kind: "document" };
  if (stem === "_error") return { target: `${prefix}/error${ext}`, kind: "error" };
  if (stem === "404") return { target: `${prefix}/not-found${ext}`, kind: "error" };
  if (stem === "500") return { target: `${prefix}/global-error${ext}`, kind: "error" };
  if (stem === "api" || stem.startsWith("api/")) {
    const route = stem === "api" ? "api" : stem.replace(/\/index$/, "");
    return { target: `${prefix}/${route}/route${ext.replace(/x$/, "")}`, kind: "api" };
  }
  const route = stem === "index" ? "" : stem.replace(/\/index$/, "");
  return { target: `${prefix}${route ? `/${route}` : ""}/page${ext}`, kind: "route" };
}

/** What the features a Pages file uses turn into. */
export function featureNotes(source: string): string[] {
  const notes: string[] = [];
  const add = (cond: boolean, note: string) => {
    if (cond) notes.push(note);
  };
  add(
    /\bgetServerSideProps\b/.test(source),
    "getServerSideProps -> an async Server Component: await your data in the page; read cookies() and headers() from next/headers (dynamic by default)",
  );
  add(
    /\bgetStaticProps\b/.test(source),
    'getStaticProps -> an async Server Component; cache with "use cache" and cacheLife (Cache Components) or leave it static; revalidate with revalidateTag',
  );
  add(
    /\bgetStaticPaths\b/.test(source),
    "getStaticPaths -> generateStaticParams (return the params objects; `fallback` becomes dynamicParams)",
  );
  add(/\bgetInitialProps\b/.test(source), "getInitialProps -> fetch in a Server Component");
  add(
    /from\s*["']next\/router["']/.test(source),
    "next/router -> next/navigation: useRouter().push/replace/back stay; router.query -> useParams()/useSearchParams(); router.pathname -> usePathname(); router.isReady is gone",
  );
  add(
    /from\s*["']next\/head["']/.test(source),
    "next/head -> export const metadata or generateMetadata (title, description, openGraph); <link> and <meta> in the layout head",
  );
  add(
    /from\s*["']next\/script["']/.test(source),
    "next/script works as is; strategy beforeInteractive belongs in the root layout",
  );
  add(
    /from\s*["']next\/dynamic["']/.test(source) && /ssr\s*:\s*false/.test(source),
    "dynamic(..., { ssr: false }) must live in a Client Component",
  );
  add(
    /\b(useState|useEffect|useReducer|useRef|useContext|useLayoutEffect|onClick|onChange|onSubmit)\b/.test(
      source,
    ),
    'hooks and event handlers need "use client" at the top of the file (or move them into a small Client Component)',
  );
  add(
    /\bres\.(json|status|send|setHeader|redirect)\b/.test(source) && /\breq\b/.test(source),
    "(req, res) handler -> export async function GET(request: Request) / POST(...) returning Response.json(...)",
  );
  add(
    /\bNextApiRequest\b|\bNextApiResponse\b/.test(source),
    "NextApiRequest/NextApiResponse -> Request/NextRequest and Response/NextResponse",
  );
  add(
    /\b_app\b|\bAppProps\b/.test(source),
    "_app -> app/layout.tsx: providers and global CSS imports go there; <Component {...pageProps} /> becomes {children}",
  );
  add(
    /\b_document\b|\bDocument\b.*from\s*["']next\/document["']/.test(source),
    "_document -> app/layout.tsx: <html lang> and <body>; next/document <Head> becomes metadata; use M3Root from @aphrody/m3-next/server",
  );
  add(
    /\bnext-i18next|\bi18n\b/.test(source),
    "i18n routing is not built in to the App Router: use a [lang] segment and proxy.ts for locale detection",
  );
  return notes;
}

/** Walk `dir` for `pages/` (and `src/pages/`) and return the move plan, plus conflicts with an existing `app/`. */
export async function pagesHints(dir: string): Promise<PagesHint[]> {
  const hints: PagesHint[] = [];
  const files: string[] = [];
  async function walk(current: string) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files.push(relative(dir, full).replace(/\\/g, "/"));
    }
  }
  await walk(dir);
  const existing = new Set(files);
  for (const file of files.filter((f) => /^(src\/)?pages\/.+\.(tsx?|jsx?|mdx?)$/.test(f))) {
    const { target, kind } = appTarget(file);
    const notes = featureNotes(await readFile(join(dir, file), "utf8"));
    if (existing.has(target))
      notes.unshift(
        `${target} already exists: the route is served twice, remove the pages file once the app route is complete`,
      );
    hints.push({ file, target, kind, notes });
  }
  // oxlint-disable-next-line unicorn/no-array-sort -- `hints` is local
  return hints.sort((a, b) => a.file.localeCompare(b.file));
}
