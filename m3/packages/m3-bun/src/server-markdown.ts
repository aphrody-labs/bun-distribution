// SPDX-License-Identifier: Apache-2.0
// `.md` files served as HTML pages: `Bun.markdown.html` (GFM, heading ids, the GFM tag filter) in a minimal document,
// with an optional YAML front matter (`Bun.YAML.parse`) for the title, description and language.

export interface M3MarkdownOptions extends Bun.markdown.Options {
  /** Stylesheet linked from every page (`/assets/markdown.css`), if any. */
  stylesheet?: string;
  /** `lang` of the page when the front matter has none (default `en`). */
  lang?: string;
}

export interface M3MarkdownPage {
  html: string;
  /** The front matter, `{}` without one. */
  data: Record<string, unknown>;
  title: string;
}

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

const escapeHtml = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/** The page of a Markdown source. */
export function renderMarkdown(source: string, options: M3MarkdownOptions = {}): M3MarkdownPage {
  const { stylesheet, lang = "en", ...markdown } = options;
  const match = FRONT_MATTER.exec(source);
  const parsed = match ? Bun.YAML.parse(match[1]!) : undefined;
  const data =
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  const body = match ? source.slice(match[0].length) : source;
  const content = Bun.markdown.html(body, {
    tagFilter: true,
    autolinks: true,
    ...markdown,
    headings: markdown.headings ?? { ids: true },
  });
  const heading = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(content)?.[1]?.replace(/<[^>]+>/g, "");
  const title = typeof data.title === "string" ? escapeHtml(data.title) : (heading ?? "Document");
  const description =
    typeof data.description === "string" ? `<meta name="description" content="${escapeHtml(data.description)}">` : "";
  const link = stylesheet ? `<link rel="stylesheet" href="${escapeHtml(stylesheet)}">` : "";
  const language = escapeHtml(typeof data.lang === "string" ? data.lang : lang);
  return {
    data,
    title,
    html: `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>${description}${link}</head><body><main class="m3-markdown">${content}</main></body></html>`,
  };
}
