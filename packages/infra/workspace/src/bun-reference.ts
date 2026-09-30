// SPDX-License-Identifier: Apache-2.0
/** Official Bun docs captured by `bun run bun:docs:fetch`; these imports embed in --compile. */
import bunLlmIndex from "../docs/bun/llms.txt" with { type: "text" };
import executableDocs from "../docs/bun/bundler/executables.md" with { type: "text" };
import processDocs from "../docs/bun/runtime/child-process.md" with { type: "text" };
import bunApiDocs from "../docs/bun/runtime/bun-apis.md" with { type: "text" };
import tomlDocs from "../docs/bun/runtime/toml.md" with { type: "text" };
import catalogDocs from "../docs/bun/pm/catalogs.md" with { type: "text" };
import filterDocs from "../docs/bun/pm/filter.md" with { type: "text" };
import installDocs from "../docs/bun/pm/install.md" with { type: "text" };
import isolatedDocs from "../docs/bun/pm/isolated-installs.md" with { type: "text" };
import lockfileDocs from "../docs/bun/pm/lockfile.md" with { type: "text" };
import workspaceDocs from "../docs/bun/pm/workspaces.md" with { type: "text" };

export const BUN_DOCUMENTS = [
  {
    title: "Bun documentation index",
    source: "https://bun.com/llms.txt",
    content: bunLlmIndex,
  },
  {
    title: "Package manager: workspaces",
    source: "https://bun.com/docs/pm/workspaces",
    content: workspaceDocs,
  },
  {
    title: "Package manager: catalogs",
    source: "https://bun.com/docs/pm/catalogs",
    content: catalogDocs,
  },
  {
    title: "Package manager: install and release-age policy",
    source: "https://bun.com/docs/pm/cli/install",
    content: installDocs,
  },
  {
    title: "Package manager: isolated installs",
    source: "https://bun.com/docs/pm/isolated-installs",
    content: isolatedDocs,
  },
  {
    title: "Package manager: filtering workspaces",
    source: "https://bun.com/docs/pm/filter",
    content: filterDocs,
  },
  {
    title: "Package manager: lockfile",
    source: "https://bun.com/docs/pm/lockfile",
    content: lockfileDocs,
  },
  {
    title: "Runtime: native APIs",
    source: "https://bun.com/docs/runtime/bun-apis",
    content: bunApiDocs,
  },
  {
    title: "Runtime: spawning child processes",
    source: "https://bun.com/docs/runtime/child-process",
    content: processDocs,
  },
  {
    title: "Runtime: TOML",
    source: "https://bun.com/docs/runtime/toml",
    content: tomlDocs,
  },
  {
    title: "Bundler: standalone executables",
    source: "https://bun.com/docs/bundler/executables",
    content: executableDocs,
  },
] as const;

export interface BunDocMatch {
  title: string;
  source: string;
  score: number;
  excerpt: string;
}

/** Search the pinned documentation snapshot without network access. */
export function searchBunDocs(query: string, limit = 5): BunDocMatch[] {
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  return BUN_DOCUMENTS.flatMap((document) => {
    const title = document.title.toLocaleLowerCase();
    const lines = document.content.split(/\r?\n/);
    let best = { score: 0, excerpt: "" };
    for (const line of lines) {
      const normalized = line.toLocaleLowerCase();
      const score = terms.reduce(
        (total, term) =>
          total + (normalized.includes(term) ? 2 : 0) + (title.includes(term) ? 1 : 0),
        0,
      );
      if (score > best.score) best = { score, excerpt: line.trim().slice(0, 320) };
    }
    return best.score > 0 ? [{ title: document.title, source: document.source, ...best }] : [];
  })
    .toSorted((left, right) => right.score - left.score)
    .slice(0, limit);
}
