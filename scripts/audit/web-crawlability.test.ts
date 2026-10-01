// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
  aggregate,
  analyzeHtml,
  countWords,
  crawlMetrics,
  decodeEntities,
  deriveBaseline,
  evaluate,
  GAP_METRICS,
  parseHtml,
  reachablePaths,
  accessibleName,
  indexDocument,
  descendants,
  type Baseline,
  type PageReport,
} from "./web-crawlability.ts";

const doc = (body: string, head = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>T &amp; U</title><meta name="description" content="d"><link rel="canonical" href="/p">${head}</head><body>${body}</body></html>`;

const GOOD = doc(
  `<header><nav aria-label="Primary"><a href="/a">A</a></nav></header><main><h1>Title</h1><h2>Sub</h2>
   <img src="x.png" alt="An x"><img src="d.png" alt="">
   <label for="n">Name</label><input id="n"><button>Save</button>
   <button aria-label="Close"><svg aria-hidden="true"></svg></button>
   <div data-m3-component="Card" data-testid="card-1">text here</div></main><footer>f</footer>`,
  `<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage","name":"x"}</script>`,
);

describe("HTML analysis (HTMLRewriter)", () => {
  test("a well-formed page has no gaps", async () => {
    const m = await analyzeHtml(GOOD, "http://h/p");
    expect(m.lang).toBe("en");
    expect(m.title).toBe("T & U");
    expect(m.canonical).toBe("/p");
    expect(m.landmarks).toMatchObject({ banner: 1, navigation: 1, main: 1, contentinfo: 1 });
    expect(m.headings).toMatchObject({ h1: 1, skips: 0 });
    expect(m.images).toMatchObject({ total: 2, withAlt: 1, decorative: 1, missingAlt: 0 });
    expect(m.interactive.unnamed).toBe(0);
    expect(m.formControls).toMatchObject({ total: 1, unlabeled: 0 });
    expect(m.hooks).toMatchObject({ testIds: 1, components: 1, componentNames: ["Card"] });
    expect(m.jsonLd).toMatchObject({ blocks: 1, invalid: 0, types: ["WebPage"] });
    expect(m.links).toMatchObject({ withHref: 1, internal: 1, clickOnly: 0 });
  });

  test("detects missing alt, unnamed controls, heading skips and duplicate ids", async () => {
    const m = await analyzeHtml(
      doc(
        `<main><h1>A</h1><h3>B</h3><img src="x"><button><span aria-hidden="true">x</span></button><input id="q"><input id="q" aria-label="Q"><select></select></main>`,
      ),
    );
    expect(m.images.missingAlt).toBe(1);
    expect(m.headings.skips).toBe(1);
    expect(m.interactive.unnamed).toBe(1);
    expect(m.formControls.unlabeled).toBe(2);
    expect(m.ids.duplicates).toEqual(["q"]);
  });

  test("labels: for=, wrapping, aria-labelledby and labelable buttons", async () => {
    const root = await parseHtml(
      `<label for="b">Accept</label><button id="b" role="checkbox"></button><label>Wrapped <input></label><span id="l">Named</span><input aria-labelledby="l">`,
    );
    const index = indexDocument(root);
    const names = descendants(root)
      .filter((n) => n.tag === "button" || n.tag === "input")
      .map((n) => accessibleName(n, index));
    expect(names).toEqual(["Accept", "Wrapped", "Named"]);
  });

  test("click-only navigation, custom elements and canvas/svg without alternatives", async () => {
    const m = await analyzeHtml(
      doc(
        `<main><h1>A</h1><a>placeholder</a><a href="#">hash</a><span role="link">fake</span><div onclick="location.href='/x'">go</div>
         <md-filled-button></md-filled-button><md-icon>search</md-icon><md-ripple></md-ripple><my-card><template shadowrootmode="open"><p>x</p></template></my-card>
         <canvas></canvas><canvas aria-label="Chart"></canvas><svg><path d="M0 0"/></svg><svg><title>Logo</title></svg></main>`,
      ),
    );
    expect(m.links.clickOnly).toBe(4);
    expect(m.customElements.empty).toEqual(["<md-filled-button>"]);
    expect(m.customElements.declarativeShadow).toBe(1);
    expect(m.mediaWithoutAlt).toMatchObject({ canvas: 1, svg: 1, total: 2 });
  });

  test("JSON-LD validity and landmark naming rules", async () => {
    const bad = await analyzeHtml(
      doc(
        `<header>in body</header><main><section>unnamed</section><section aria-label="Named">n</section><nav>1</nav><nav>2</nav></main>`,
        `<script type="application/ld+json">{oops</script><script type="application/ld+json">{"@type":"X"}</script>`,
      ),
    );
    expect(bad.jsonLd.invalid).toBe(2);
    expect(bad.landmarks).toMatchObject({ region: 1, navigation: 2, banner: 1 });
    expect(bad.unnamedSections).toBe(1);
    expect(bad.unnamedNavigations).toBe(2);
  });

  test("text helpers", () => {
    expect(countWords("  a  b\nc ")).toBe(3);
    expect(decodeEntities("a &amp; b &#x41; &lt;")).toBe("a & b A <");
  });
});

describe("crawler metrics, reachability and the verdict", () => {
  const page = (
    path: string,
    html: Awaited<ReturnType<typeof analyzeHtml>>,
    kind: PageReport["kind"] = "landing",
  ): PageReport => ({
    path,
    kind,
    url: `http://h${path}`,
    bytes: 1,
    html,
    crawl: null,
  });

  test("coverage divides crawler words by visible words; metadata mismatch is reported", async () => {
    const html = await analyzeHtml(doc(`<main><h1>One two three four</h1></main>`), "http://h/p");
    const crawl = crawlMetrics(
      {
        url: "http://h/p",
        status: 200,
        wordCount: 2,
        textChars: 8,
        markdownChars: 9,
        discoveredLinks: 0,
        lang: "fr",
        description: "d",
      },
      html,
      "http://h/p",
    );
    expect(crawl.textCoverage).toBe(0.5);
    expect(crawl.metadataMismatch).toEqual(["lang"]);
  });

  test("reachablePaths follows internal links only", () => {
    const pages = [
      { path: "/", hrefs: ["http://h/a", "http://other/x"] },
      { path: "/a", hrefs: ["http://h/b"] },
      { path: "/b", hrefs: [] },
      { path: "/orphan", hrefs: [] },
    ];
    expect([...reachablePaths(pages, "http://h")].toSorted()).toEqual(["/", "/a", "/b"]);
  });

  test("evaluate fails on a regression and passes within the ratchet", async () => {
    const good = page("/", await analyzeHtml(GOOD, "http://h/"));
    const baseline = deriveBaseline([good], aggregate([good]));
    expect(Object.keys(baseline.max).toSorted()).toEqual([...GAP_METRICS].toSorted());
    expect(evaluate([good], aggregate([good]), baseline)).toEqual([]);

    const worse = page(
      "/",
      await analyzeHtml(
        GOOD.replace('alt="An x"', "").replace("<main>", "<main><button></button>"),
        "http://h/",
      ),
    );
    const violations = evaluate([worse], aggregate([worse]), baseline);
    expect(violations.map((v) => v.rule)).toEqual(
      expect.arrayContaining(["max.imagesMissingAlt", "max.unnamedInteractive"]),
    );
  });

  test("kind requirements: landmarks, hooks and JSON-LD", async () => {
    const good = page("/", await analyzeHtml(GOOD, "http://h/"));
    const baseline: Baseline = deriveBaseline([good], aggregate([good]));
    const stripped = page("/", await analyzeHtml(doc(`<main><h1>x</h1></main>`), "http://h/"));
    const rules = evaluate([stripped], aggregate([stripped]), baseline).map((v) => v.rule);
    expect(rules).toEqual(
      expect.arrayContaining([
        "kind.landing.landmark.banner",
        "kind.landing.landmark.contentinfo",
        "kind.landing.minInternalLinks",
        "kind.landing.jsonLd",
      ]),
    );
  });

  test("text coverage under the minimum is a regression", async () => {
    const html = await analyzeHtml(GOOD, "http://h/");
    const p = {
      ...page("/", html),
      crawl: {
        status: 200,
        wordCount: 1,
        textChars: 1,
        markdownChars: 1,
        discoveredLinks: 0,
        duplicate: false,
        textCoverage: 0.1,
        metadataMismatch: [],
      },
    };
    const agg = aggregate([p], [], true);
    const baseline = {
      ...deriveBaseline([{ ...p, crawl: { ...p.crawl, textCoverage: 0.8 } }], agg),
      min: { pages: 1, crawledPages: 1, textCoverage: 0.5 },
    };
    expect(evaluate([p], agg, baseline).map((v) => v.rule)).toContain("min.textCoverage");
  });
});
