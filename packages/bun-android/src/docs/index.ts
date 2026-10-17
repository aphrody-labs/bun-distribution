/** `bun android docs <fetch|repos|search|stats>`: local Android and AOSP documentation. */
import { parseArgs } from "node:util";
import { crawl, syncRepos } from "./crawl.ts";
import { DocsStore, docsHome } from "./store.ts";

export { htmlToMarkdown } from "./convert.ts";
export { crawl, DOC_REPOS, SOURCES, syncRepos } from "./crawl.ts";
export { DocsStore, docsHome } from "./store.ts";

export const docsUsage = `bun android docs <command>

  fetch   [--source developer|source] [--concurrency 8] [--limit N] [--no-sitemap]
  repos                                  shallow-clone and index AOSP doc repositories
  search  <query> [--limit 10] [--source developer|source|aosp-git] [--json]
  stats

  store: ${docsHome()}`;

export async function docsCommand(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: false,
    options: {
      source: { type: "string", multiple: true },
      concurrency: { type: "string" },
      limit: { type: "string" },
      "no-sitemap": { type: "boolean" },
      json: { type: "boolean" },
    },
  });
  const [command, ...rest] = positionals;
  switch (command) {
    case "fetch":
      await crawl({
        sources: values.source as string[] | undefined,
        concurrency: values.concurrency ? Number(values.concurrency) : undefined,
        limit: values.limit ? Number(values.limit) : undefined,
        refreshSitemaps: !values["no-sitemap"],
      });
      return 0;
    case "repos":
      await syncRepos();
      return 0;
    case "search": {
      const query = rest.join(" ").trim();
      if (!query) {
        console.error(docsUsage);
        return 1;
      }
      const store = new DocsStore();
      const hits = store.search(
        query,
        values.limit ? Number(values.limit) : 10,
        (values.source as string[] | undefined)?.[0],
      );
      store.close();
      if (values.json) console.log(JSON.stringify(hits, null, 2));
      else for (const hit of hits) console.log(`${hit.title}\n  ${hit.url}\n  ${hit.snippet.replace(/\s+/g, " ")}\n`);
      return hits.length ? 0 : 1;
    }
    case "stats": {
      const store = new DocsStore();
      console.table(store.stats());
      store.close();
      return 0;
    }
    default:
      console.log(docsUsage);
      return command ? 1 : 0;
  }
}
