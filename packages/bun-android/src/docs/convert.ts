/** HTML to Markdown conversion for devsite pages, built on HTMLRewriter. */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  copy: "©",
  reg: "®",
  trade: "™",
  times: "×",
  rarr: "→",
  larr: "←",
};

export function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (whole, name: string) => {
      if (name[0] === "#") {
        const code =
          name[1] === "x" || name[1] === "X"
            ? Number.parseInt(name.slice(2), 16)
            : Number.parseInt(name.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
      }
      return ENTITIES[name.toLowerCase()] ?? whole;
    },
  );
}

const BLOCK: Record<string, [string, string]> = {
  h1: ["\n\n# ", "\n\n"],
  h2: ["\n\n## ", "\n\n"],
  h3: ["\n\n### ", "\n\n"],
  h4: ["\n\n#### ", "\n\n"],
  h5: ["\n\n##### ", "\n\n"],
  h6: ["\n\n###### ", "\n\n"],
  p: ["\n\n", "\n\n"],
  div: ["\n", "\n"],
  section: ["\n", "\n"],
  br: ["\n", ""],
  hr: ["\n\n---\n\n", ""],
  blockquote: ["\n\n> ", "\n\n"],
  ul: ["\n", "\n"],
  ol: ["\n", "\n"],
  li: ["\n- ", ""],
  dt: ["\n\n**", "**\n"],
  dd: ["\n: ", "\n"],
  table: ["\n\n", "\n\n"],
  tr: ["\n|", ""],
  th: [" ", " |"],
  td: [" ", " |"],
  strong: ["**", "**"],
  b: ["**", "**"],
  em: ["_", "_"],
  i: ["_", "_"],
};

const SKIP = new Set([
  "script",
  "style",
  "noscript",
  "svg",
  "button",
  "devsite-feedback",
  "devsite-thumb-rating",
  "devsite-toc",
  "nav",
]);

export interface ConvertedPage {
  title: string;
  markdown: string;
  links: string[];
}

/** Convert one HTML document into Markdown, keeping only the article body. */
export async function htmlToMarkdown(
  html: string,
  baseUrl: string,
  root = ".devsite-article-body",
): Promise<ConvertedPage> {
  const out: string[] = [];
  const links: string[] = [];
  let title = "";
  let inTitle = false;
  let skip = 0;
  let pre = 0;
  let rootDepth = 0;
  let code = 0;

  const rewriter = new HTMLRewriter()
    .on("title", {
      element(element) {
        inTitle = true;
        element.onEndTag(() => {
          inTitle = false;
        });
      },
      text(chunk) {
        if (inTitle) title += chunk.text;
      },
    })
    .on("a[href]", {
      element(element) {
        const href = element.getAttribute("href");
        if (!href) return;
        try {
          const url = new URL(decodeEntities(href), baseUrl);
          url.hash = "";
          links.push(url.href);
        } catch {}
      },
    })
    .on(root, {
      element(element) {
        if (rootDepth > 0) return;
        rootDepth++;
        element.onEndTag(() => {
          rootDepth--;
        });
      },
      text(chunk) {
        if (rootDepth === 0 || skip > 0) return;
        const text = decodeEntities(chunk.text);
        out.push(pre > 0 ? text : text.replace(/\s+/g, " "));
      },
    })
    .on(
      root
        .split(",")
        .map((selector) => `${selector.trim()} *`)
        .join(", "),
      {
        element(element) {
          if (rootDepth === 0) return;
          const tag = element.tagName.toLowerCase();
          if (SKIP.has(tag) || element.hasAttribute("hidden")) {
            skip++;
            element.onEndTag(() => {
              skip--;
            });
            return;
          }
          if (skip > 0) return;
          if (tag === "pre") {
            pre++;
            out.push("\n\n```\n");
            element.onEndTag(() => {
              pre--;
              out.push("\n```\n\n");
            });
            return;
          }
          if (tag === "code" && pre === 0) {
            code++;
            out.push("`");
            element.onEndTag(() => {
              code--;
              out.push("`");
            });
            return;
          }
          if (tag === "a" && pre === 0 && code === 0) {
            const href = element.getAttribute("href");
            if (
              href &&
              !href.startsWith("#") &&
              !href.startsWith("javascript:")
            ) {
              let absolute = href;
              try {
                absolute = new URL(decodeEntities(href), baseUrl).href;
              } catch {}
              out.push("[");
              element.onEndTag(() => {
                out.push(`](${absolute})`);
              });
            }
            return;
          }
          if (tag === "img") {
            const alt = element.getAttribute("alt");
            if (alt) out.push(`[image: ${decodeEntities(alt)}]`);
            return;
          }
          const pair = BLOCK[tag];
          if (!pair || pre > 0) return;
          out.push(pair[0]);
          if (pair[1] && !element.selfClosing) {
            const end = pair[1];
            try {
              element.onEndTag(() => {
                out.push(end);
              });
            } catch {}
          }
        },
      },
    );

  await rewriter.transform(new Response(html)).text();
  title = decodeEntities(title)
    .replace(/\s*\|\s*Android.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const markdown = out
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, markdown, links };
}
