// SPDX-License-Identifier: Apache-2.0
//! Crawlability gate for the UI layer (`m3/packages`): can the Rust crawler (`aphrody-web crawl`,
//! static HTTP stack, no JavaScript) and an LLM agent read, navigate and address the markup the
//! m3 components server-render?
//!
//! The audit server-renders a deterministic fixture site from the m3 packages (see
//! `web-crawlability-fixture.ts`), serves it on 127.0.0.1, crawls it with the engine and
//! analyses every page's raw HTML with Bun's built-in HTMLRewriter: landmarks, headings, image
//! alternatives, link vs click-only navigation, accessible names, duplicate ids, test hooks,
//! custom-element content, canvas/svg alternatives, JSON-LD and page metadata. The crawler's own
//! numbers (text coverage, discovered links, markdown size) are compared with the visible text.
//!
//!   bun scripts/audit/web-crawlability.ts [--bin <aphrody-web>] [--out <file>] [--json]
//!       [--baseline <file>] [--update-baseline] [--no-crawl] [--save-fixture <dir>]
//!       [--from-fixture <dir>] [--seed <url>] [--allow-private-network]
//!
//! Exit code: 0 within the baseline, 1 on a regression, 2 when the audit could not run (for
//! example a binary without `crawl`). The default report path is the `storage.crawlabilityReport`
//! of tools/config/web.json; the repository is only written to with an explicit `--out`.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// ---------------------------------------------------------------------------------------------
// HTML tree (HTMLRewriter is the only parser: no new dependency)
// ---------------------------------------------------------------------------------------------

export interface HtmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: (HtmlNode | string)[];
  parent: HtmlNode | null;
}

/** Parses markup into a light DOM tree with Bun's HTMLRewriter (streaming, no tree builder). */
export async function parseHtml(html: string): Promise<HtmlNode> {
  const root: HtmlNode = { tag: "#document", attrs: {}, children: [], parent: null };
  let current = root;
  await new HTMLRewriter()
    .on("*", {
      element(el) {
        const node: HtmlNode = {
          tag: el.tagName.toLowerCase(),
          attrs: Object.fromEntries([...el.attributes].map(([name, value]) => [name.toLowerCase(), value])),
          children: [],
          parent: current,
        };
        current.children.push(node);
        if (el.canHaveContent) {
          current = node;
          el.onEndTag(() => {
            current = node.parent ?? root;
          });
        }
      },
      text(chunk) {
        if (chunk.text) current.children.push(chunk.text);
      },
    })
    .transform(new Response(html))
    .text();
  return root;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

function isElement(child: HtmlNode | string): child is HtmlNode {
  return typeof child !== "string";
}

/** Every element below `node` (excluded), in document order. */
export function descendants(node: HtmlNode): HtmlNode[] {
  const out: HtmlNode[] = [];
  const visit = (parent: HtmlNode) => {
    for (const child of parent.children) {
      if (isElement(child)) {
        out.push(child);
        visit(child);
      }
    }
  };
  visit(node);
  return out;
}

export function ancestors(node: HtmlNode): HtmlNode[] {
  const out: HtmlNode[] = [];
  for (let parent = node.parent; parent; parent = parent.parent) out.push(parent);
  return out;
}

const NON_RENDERED = new Set([
  "script",
  "style",
  "template",
  "noscript",
  "head",
  "meta",
  "link",
  "title",
  "base",
  "datalist",
]);

/** True when the element itself is not rendered or is hidden from assistive technology. */
export function hiddenSelf(node: HtmlNode): boolean {
  const { attrs, tag } = node;
  if (NON_RENDERED.has(tag)) return true;
  if ("hidden" in attrs && attrs.hidden !== "false") return true;
  if (attrs["aria-hidden"] === "true") return true;
  if (tag === "input" && attrs.type?.toLowerCase() === "hidden") return true;
  const style = (attrs.style ?? "").replace(/\s+/g, "").toLowerCase();
  return style.includes("display:none") || style.includes("visibility:hidden");
}

export function isHidden(node: HtmlNode): boolean {
  return hiddenSelf(node) || ancestors(node).some(hiddenSelf);
}

/** Text of a subtree, skipping non-rendered and hidden branches; svg `title` / `desc` are not content. */
export function visibleText(node: HtmlNode): string {
  const parts: string[] = [];
  const visit = (parent: HtmlNode) => {
    for (const child of parent.children) {
      if (typeof child === "string") parts.push(decodeEntities(child));
      else if (!hiddenSelf(child) && !(parent.tag === "svg" && (child.tag === "title" || child.tag === "desc"))) {
        parts.push(" ");
        visit(child);
        parts.push(" ");
      }
    }
  };
  visit(node);
  return parts.join("").replace(/\s+/g, " ").trim();
}

/** Raw text of a subtree regardless of visibility (title, script payloads). */
export function rawText(node: HtmlNode): string {
  return node.children.map(child => (typeof child === "string" ? child : rawText(child))).join("");
}

// ---------------------------------------------------------------------------------------------
// Roles, landmarks and accessible names
// ---------------------------------------------------------------------------------------------

const WIDGET_ROLES = new Set([
  "button",
  "link",
  "checkbox",
  "switch",
  "radio",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "combobox",
  "slider",
  "spinbutton",
  "textbox",
  "searchbox",
  "option",
  "treeitem",
  "progressbar",
  "meter",
]);
const FORM_CONTROL_ROLES = new Set([
  "checkbox",
  "switch",
  "radio",
  "combobox",
  "slider",
  "spinbutton",
  "textbox",
  "searchbox",
]);
const NAME_FROM_CONTENT_ROLES = new Set([
  "button",
  "link",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "treeitem",
  "checkbox",
  "switch",
  "radio",
  "heading",
]);
const BUTTON_INPUTS = new Set(["submit", "button", "reset", "image"]);

export function explicitRole(node: HtmlNode): string | undefined {
  return node.attrs.role?.trim().toLowerCase().split(/\s+/)[0] || undefined;
}

/** The widget role of an element (explicit or implicit), or `undefined` when it is not a widget. */
export function widgetRole(node: HtmlNode): string | undefined {
  const explicit = explicitRole(node);
  if (explicit) return WIDGET_ROLES.has(explicit) ? explicit : undefined;
  const type = node.attrs.type?.toLowerCase() ?? "text";
  switch (node.tag) {
    case "button":
    case "summary":
      return "button";
    case "a":
      return node.attrs.href !== undefined ? "link" : undefined;
    case "select":
      return "combobox";
    case "textarea":
      return "textbox";
    case "progress":
      return "progressbar";
    case "meter":
      return "meter";
    case "input":
      if (type === "hidden") return undefined;
      if (BUTTON_INPUTS.has(type)) return "button";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "range") return "slider";
      if (type === "number") return "spinbutton";
      if (type === "search") return "searchbox";
      return "textbox";
    default:
      return undefined;
  }
}

export interface DocIndex {
  byId: Map<string, HtmlNode>;
  labelsFor: Map<string, HtmlNode[]>;
}

export function indexDocument(root: HtmlNode): DocIndex {
  const byId = new Map<string, HtmlNode>();
  const labelsFor = new Map<string, HtmlNode[]>();
  for (const node of descendants(root)) {
    const id = node.attrs.id;
    if (id !== undefined && id !== "" && !byId.has(id)) byId.set(id, node);
    if (node.tag === "label" && node.attrs.for)
      labelsFor.set(node.attrs.for, [...(labelsFor.get(node.attrs.for) ?? []), node]);
  }
  return { byId, labelsFor };
}

/** Name from content: nested aria-label, img alt, svg title and visible text. */
function contentName(node: HtmlNode): string {
  const parts: string[] = [];
  const visit = (parent: HtmlNode) => {
    for (const child of parent.children) {
      if (typeof child === "string") {
        parts.push(decodeEntities(child));
        continue;
      }
      if (hiddenSelf(child)) continue;
      const label = child.attrs["aria-label"]?.trim();
      if (label) parts.push(` ${label} `);
      else if (child.tag === "img") parts.push(` ${child.attrs.alt?.trim() ?? ""} `);
      else if (child.tag === "svg") {
        const title = child.children.find((c): c is HtmlNode => isElement(c) && c.tag === "title");
        if (title) parts.push(` ${visibleTextOfTitle(title)} `);
      } else {
        parts.push(" ");
        visit(child);
        parts.push(" ");
      }
    }
  };
  visit(node);
  return parts.join("").replace(/\s+/g, " ").trim();
}

function visibleTextOfTitle(title: HtmlNode): string {
  return decodeEntities(rawText(title)).replace(/\s+/g, " ").trim();
}

/** Accessible name (a pragmatic subset of accname 1.2: labelledby, label, native, content, title). */
export function accessibleName(node: HtmlNode, index: DocIndex): string {
  const labelledBy = node.attrs["aria-labelledby"];
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map(id => index.byId.get(id))
      .filter((target): target is HtmlNode => target !== undefined)
      .map(target => contentName(target) || decodeEntities(rawText(target)).trim())
      .join(" ")
      .trim();
    if (text) return text;
  }
  const label = node.attrs["aria-label"]?.trim();
  if (label) return label;

  const type = node.attrs.type?.toLowerCase() ?? "text";
  if (node.tag === "img") return node.attrs.alt?.trim() ?? "";
  if (node.tag === "input" && type === "image") return node.attrs.alt?.trim() || node.attrs.value?.trim() || "";
  if (node.tag === "input" && BUTTON_INPUTS.has(type))
    return node.attrs.value?.trim() || (type === "submit" ? "Submit" : type === "reset" ? "Reset" : "");
  if (["input", "select", "textarea", "progress", "meter", "output", "button"].includes(node.tag)) {
    const labels = [...(node.attrs.id ? (index.labelsFor.get(node.attrs.id) ?? []) : [])];
    for (const ancestor of ancestors(node)) if (ancestor.tag === "label") labels.push(ancestor);
    const text = labels
      .map(target => contentName(target))
      .join(" ")
      .trim();
    if (text) return text;
  }
  if (
    node.tag === "a" ||
    node.tag === "button" ||
    node.tag === "summary" ||
    NAME_FROM_CONTENT_ROLES.has(explicitRole(node) ?? "")
  ) {
    const text = contentName(node);
    if (text) return text;
  }
  return node.attrs.title?.trim() ?? "";
}

export type LandmarkName =
  | "banner"
  | "navigation"
  | "main"
  | "contentinfo"
  | "complementary"
  | "region"
  | "search"
  | "form";
export const LANDMARKS: readonly LandmarkName[] = [
  "banner",
  "navigation",
  "main",
  "contentinfo",
  "complementary",
  "region",
  "search",
  "form",
];

const SECTIONING = new Set(["article", "aside", "main", "nav", "section"]);

/** The landmark role of an element, honouring the HTML-AAM rules for header, footer, section and form. */
export function landmarkOf(node: HtmlNode, index: DocIndex): LandmarkName | undefined {
  const explicit = explicitRole(node);
  const named = () => accessibleName(node, index) !== "";
  if (explicit) {
    if (explicit === "region" || explicit === "form") return named() ? explicit : undefined;
    return (LANDMARKS as readonly string[]).includes(explicit) ? (explicit as LandmarkName) : undefined;
  }
  switch (node.tag) {
    case "main":
      return "main";
    case "nav":
      return "navigation";
    case "aside":
      return "complementary";
    case "search":
      return "search";
    case "header":
      return ancestors(node).some(a => SECTIONING.has(a.tag)) ? undefined : "banner";
    case "footer":
      return ancestors(node).some(a => SECTIONING.has(a.tag)) ? undefined : "contentinfo";
    case "section":
      return named() ? "region" : undefined;
    case "form":
      return named() ? "form" : undefined;
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------------------------
// Per-page HTML metrics
// ---------------------------------------------------------------------------------------------

export interface HtmlMetrics {
  lang: string | null;
  title: string | null;
  description: string | null;
  canonical: string | null;
  viewport: boolean;
  charset: boolean;
  landmarks: Record<LandmarkName, number>;
  unnamedNavigations: number;
  unnamedSections: number;
  headings: { h1: number; levels: number[]; skips: number; empty: number };
  images: { total: number; withAlt: number; decorative: number; missingAlt: number };
  mediaWithoutAlt: { canvas: number; svg: number; roleImg: number; iframe: number; total: number };
  links: {
    anchors: number;
    withHref: number;
    internal: number;
    external: number;
    clickOnly: number;
    hrefs: string[];
  };
  interactive: { total: number; unnamed: number; samples: string[] };
  formControls: { total: number; unlabeled: number; placeholderOnly: number; samples: string[] };
  ids: { total: number; duplicates: string[]; brokenRefs: string[] };
  hooks: { testIds: number; components: number; componentNames: string[] };
  customElements: { total: number; empty: string[]; declarativeShadow: number };
  jsonLd: { blocks: number; invalid: number; types: string[]; errors: string[] };
  text: { visibleWords: number; visibleChars: number; ariaHiddenWords: number };
}

const SVG_MATH_RESERVED = new Set([
  "annotation-xml",
  "color-profile",
  "font-face",
  "font-face-src",
  "font-face-uri",
  "font-face-format",
  "font-face-name",
  "missing-glyph",
]);
/** Decorative infrastructure elements whose content lives in the shadow tree by design. */
const DECORATIVE_CUSTOM_ELEMENTS = new Set(["md-ripple", "md-focus-ring", "md-elevation", "md-divider"]);
const ID_REF_ATTRS = [
  "aria-labelledby",
  "aria-describedby",
  "aria-controls",
  "aria-owns",
  "aria-activedescendant",
  "for",
  "headers",
  "list",
];
const NAVIGATING = /\b(location|window\.open|navigate|history\.(push|replace)State|router\.)/;

export function describeNode(node: HtmlNode): string {
  const id = node.attrs.id ? `#${node.attrs.id}` : "";
  const hook = node.attrs["data-m3-component"] ? `[${node.attrs["data-m3-component"]}]` : "";
  const cls = node.attrs.class?.split(/\s+/)[0];
  return `<${node.tag}${id}${hook}${cls && !id && !hook ? `.${cls.slice(0, 24)}` : ""}>`;
}

function resolveHref(href: string, base: string): URL | undefined {
  try {
    return new URL(href, base);
  } catch {
    return undefined;
  }
}

/** Analyses one parsed document. `pageUrl` classifies links as internal or external. */
export function analyzeDocument(root: HtmlNode, pageUrl = "http://page.invalid/"): HtmlMetrics {
  const all = descendants(root);
  const index = indexDocument(root);
  const html = all.find(node => node.tag === "html");
  const head = all.find(node => node.tag === "head");
  const body = all.find(node => node.tag === "body") ?? root;
  const bodyElements = descendants(body);
  const visible = bodyElements.filter(node => !isHidden(node));
  const origin = new URL(pageUrl).origin;

  // Head metadata.
  const headElements = head ? descendants(head) : all.filter(node => ["title", "meta", "link"].includes(node.tag));
  const titleNode = headElements.find(node => node.tag === "title");
  const title = titleNode ? decodeEntities(rawText(titleNode)).trim() : "";
  const meta = (name: string) =>
    headElements.find(node => node.tag === "meta" && node.attrs.name?.toLowerCase() === name)?.attrs.content?.trim();
  const canonicalNode = headElements.find(
    node => node.tag === "link" && node.attrs.rel?.toLowerCase().split(/\s+/).includes("canonical"),
  );

  // Landmarks.
  const landmarks = Object.fromEntries(LANDMARKS.map(name => [name, 0])) as Record<LandmarkName, number>;
  let unnamedNavigations = 0;
  let unnamedSections = 0;
  const navs = visible.filter(node => landmarkOf(node, index) === "navigation");
  for (const node of visible) {
    const landmark = landmarkOf(node, index);
    if (landmark) landmarks[landmark] += 1;
    else if (node.tag === "section") unnamedSections += 1;
  }
  if (navs.length > 1) unnamedNavigations = navs.filter(node => accessibleName(node, index) === "").length;

  // Headings.
  const headingNodes = visible.filter(node => /^h[1-6]$/.test(node.tag) || explicitRole(node) === "heading");
  const levels = headingNodes.map(node =>
    /^h[1-6]$/.test(node.tag) ? Number(node.tag[1]) : Number(node.attrs["aria-level"]) || 2,
  );
  let skips = 0;
  levels.forEach((level, i) => {
    if (level > (i === 0 ? 0 : levels[i - 1]!) + 1) skips += 1;
  });
  const emptyHeadings = headingNodes.filter(
    node => accessibleName(node, index) === "" && visibleText(node) === "",
  ).length;

  // Images and non-text media.
  const imgs = visible.filter(node => node.tag === "img");
  const missingAlt = imgs.filter(node => node.attrs.alt === undefined).length;
  const decorative = imgs.filter(node => node.attrs.alt?.trim() === "").length;
  const insideWidget = (node: HtmlNode) => ancestors(node).some(a => widgetRole(a) !== undefined && !hiddenSelf(a));
  const canvas = visible.filter(
    node => node.tag === "canvas" && accessibleName(node, index) === "" && visibleText(node) === "",
  ).length;
  const svg = visible.filter(
    node =>
      node.tag === "svg" &&
      !ancestors(node).some(a => a.tag === "svg") &&
      !insideWidget(node) &&
      !["presentation", "none"].includes(explicitRole(node) ?? "") &&
      accessibleName(node, index) === "" &&
      !node.children.some(c => isElement(c) && c.tag === "title" && visibleTextOfTitle(c) !== "") &&
      visibleText(node) === "",
  ).length;
  const roleImg = visible.filter(node => explicitRole(node) === "img" && accessibleName(node, index) === "").length;
  const iframe = visible.filter(node => node.tag === "iframe" && accessibleName(node, index) === "").length;

  // Links.
  const anchors = visible.filter(node => node.tag === "a");
  const hrefs: string[] = [];
  let internal = 0;
  let external = 0;
  let withHref = 0;
  let clickOnly = 0;
  for (const node of visible) {
    const href = node.attrs.href?.trim();
    const realHref =
      node.tag === "a" && href !== undefined && href !== "" && href !== "#" && !/^(javascript|data):/i.test(href);
    if (node.tag === "a") {
      if (realHref) {
        withHref += 1;
        const url = resolveHref(href!, pageUrl);
        if (url && /^https?:$/.test(url.protocol)) {
          hrefs.push(url.href);
          if (url.origin === origin) internal += 1;
          else external += 1;
        }
      } else clickOnly += 1;
    } else if (explicitRole(node) === "link" && !(node.tag === "a" && realHref)) clickOnly += 1;
    else if (
      node.attrs.onclick !== undefined &&
      (NAVIGATING.test(node.attrs.onclick) ||
        !["button", "input", "summary", "select", "textarea", "label", "option"].includes(node.tag))
    ) {
      clickOnly += 1;
    }
  }

  // Interactive widgets and form controls.
  let interactiveTotal = 0;
  let unnamed = 0;
  const unnamedSamples: string[] = [];
  let controlsTotal = 0;
  let unlabeled = 0;
  let placeholderOnly = 0;
  const unlabeledSamples: string[] = [];
  for (const node of visible) {
    const role = widgetRole(node);
    if (!role) continue;
    const named = accessibleName(node, index) !== "";
    const nativeControl =
      ["input", "select", "textarea"].includes(node.tag) && !BUTTON_INPUTS.has(node.attrs.type?.toLowerCase() ?? "");
    if (nativeControl || FORM_CONTROL_ROLES.has(role)) {
      controlsTotal += 1;
      if (!named) {
        unlabeled += 1;
        if (node.attrs.placeholder?.trim()) placeholderOnly += 1;
        if (unlabeledSamples.length < 8) unlabeledSamples.push(describeNode(node));
      }
    } else {
      interactiveTotal += 1;
      if (!named) {
        unnamed += 1;
        if (unnamedSamples.length < 8) unnamedSamples.push(describeNode(node));
      }
    }
  }

  // Ids.
  const idCounts = new Map<string, number>();
  for (const node of all) if (node.attrs.id) idCounts.set(node.attrs.id, (idCounts.get(node.attrs.id) ?? 0) + 1);
  const brokenRefs = new Set<string>();
  for (const node of bodyElements) {
    for (const name of ID_REF_ATTRS) {
      const value = node.attrs[name];
      if (!value) continue;
      for (const id of value.split(/\s+/)) if (id && !idCounts.has(id)) brokenRefs.add(`${name}=${id}`);
    }
  }

  // Test and component hooks.
  const componentNames = new Set<string>();
  let testIds = 0;
  let components = 0;
  for (const node of bodyElements) {
    if (node.attrs["data-testid"]) testIds += 1;
    const component = node.attrs["data-m3-component"];
    if (component) {
      components += 1;
      componentNames.add(component);
    }
  }

  // Custom elements.
  const customs = visible.filter(node => node.tag.includes("-") && !SVG_MATH_RESERVED.has(node.tag));
  const isShadowTemplate = (child: HtmlNode | string) =>
    isElement(child) &&
    child.tag === "template" &&
    (child.attrs.shadowrootmode !== undefined || child.attrs.shadowroot !== undefined);
  const emptyCustom = customs.filter(
    node =>
      !DECORATIVE_CUSTOM_ELEMENTS.has(node.tag) &&
      node.attrs["aria-hidden"] !== "true" &&
      !["presentation", "none"].includes(explicitRole(node) ?? "") &&
      !node.children.some(isShadowTemplate) &&
      visibleText(node) === "" &&
      !descendants(node).some(child =>
        ["img", "svg", "canvas", "video", "audio", "picture", "input"].includes(child.tag),
      ),
  );
  const declarativeShadow = customs.filter(node => node.children.some(isShadowTemplate)).length;

  // JSON-LD.
  const jsonLdScripts = all.filter(
    node => node.tag === "script" && node.attrs.type?.toLowerCase() === "application/ld+json",
  );
  const types = new Set<string>();
  const jsonErrors: string[] = [];
  const collectTypes = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.length > 0 && value.map(collectTypes).every(Boolean);
    if (!value || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    if (Array.isArray(record["@graph"])) return collectTypes(record["@graph"]);
    const type = record["@type"];
    if (typeof type === "string") types.add(type);
    else if (Array.isArray(type) && type.every(t => typeof t === "string") && type.length > 0)
      for (const t of type) types.add(t as string);
    else return false;
    return true;
  };
  for (const script of jsonLdScripts) {
    try {
      const data = JSON.parse(rawText(script)) as unknown;
      const context = (Array.isArray(data) ? data : [data]).every(item => {
        const ctx = (item as Record<string, unknown> | null)?.["@context"];
        return typeof ctx === "string"
          ? /schema\.org/.test(ctx)
          : Array.isArray(ctx)
            ? ctx.some(c => typeof c === "string" && /schema\.org/.test(c))
            : ctx !== undefined && typeof ctx === "object";
      });
      if (!context) jsonErrors.push("missing schema.org @context");
      else if (!collectTypes(data)) jsonErrors.push("missing @type");
    } catch (error) {
      jsonErrors.push(`invalid JSON: ${(error as Error).message.slice(0, 60)}`);
    }
  }

  // Text.
  const bodyText = visibleText(body);
  const hiddenRoots = bodyElements.filter(
    node =>
      node.attrs["aria-hidden"] === "true" &&
      !ancestors(node).some(a => a.attrs["aria-hidden"] === "true") &&
      !isHidden(node.parent ?? root),
  );
  const ariaHiddenWords = hiddenRoots.reduce((sum, node) => sum + countWords(visibleTextIgnoringAria(node)), 0);

  return {
    lang: html?.attrs.lang?.trim() || null,
    title: title || null,
    description: meta("description") || null,
    canonical: canonicalNode?.attrs.href?.trim() || null,
    viewport: Boolean(meta("viewport")),
    charset: headElements.some(
      node =>
        node.tag === "meta" &&
        (node.attrs.charset !== undefined || node.attrs["http-equiv"]?.toLowerCase() === "content-type"),
    ),
    landmarks,
    unnamedNavigations,
    unnamedSections,
    headings: {
      h1: levels.filter(level => level === 1).length,
      levels,
      skips,
      empty: emptyHeadings,
    },
    images: {
      total: imgs.length,
      withAlt: imgs.length - missingAlt - decorative,
      decorative,
      missingAlt,
    },
    mediaWithoutAlt: { canvas, svg, roleImg, iframe, total: canvas + svg + roleImg + iframe },
    links: {
      anchors: anchors.length,
      withHref,
      internal,
      external,
      clickOnly,
      hrefs: [...new Set(hrefs)],
    },
    interactive: { total: interactiveTotal, unnamed, samples: unnamedSamples },
    formControls: { total: controlsTotal, unlabeled, placeholderOnly, samples: unlabeledSamples },
    ids: {
      total: idCounts.size,
      duplicates: [...idCounts]
        .filter(([, n]) => n > 1)
        .map(([id]) => id)
        .toSorted(),
      brokenRefs: [...brokenRefs].toSorted(),
    },
    hooks: { testIds, components, componentNames: [...componentNames].toSorted() },
    customElements: {
      total: customs.length,
      empty: emptyCustom.map(describeNode),
      declarativeShadow,
    },
    jsonLd: {
      blocks: jsonLdScripts.length,
      invalid: jsonErrors.length,
      types: [...types].toSorted(),
      errors: jsonErrors,
    },
    text: { visibleWords: countWords(bodyText), visibleChars: bodyText.length, ariaHiddenWords },
  };
}

/** Text of an aria-hidden subtree (it is skipped by `visibleText`), still honouring `hidden` and display:none. */
function visibleTextIgnoringAria(node: HtmlNode): string {
  const parts: string[] = [];
  const visit = (parent: HtmlNode) => {
    for (const child of parent.children) {
      if (typeof child === "string") parts.push(decodeEntities(child));
      else if (!NON_RENDERED.has(child.tag) && !("hidden" in child.attrs)) {
        parts.push(" ");
        visit(child);
        parts.push(" ");
      }
    }
  };
  visit(node);
  return parts.join("").replace(/\s+/g, " ").trim();
}

export async function analyzeHtml(html: string, pageUrl?: string): Promise<HtmlMetrics> {
  return analyzeDocument(await parseHtml(html), pageUrl);
}

// ---------------------------------------------------------------------------------------------
// Crawler-side metrics and the link graph
// ---------------------------------------------------------------------------------------------

/** The subset of one `aphrody-web.crawl/1` page this audit reads. */
export interface CrawlPage {
  url: string;
  depth?: number;
  status: number;
  title?: string;
  lang?: string | null;
  canonical?: string | null;
  description?: string | null;
  wordCount: number;
  textChars: number;
  markdownChars: number;
  bytes?: number | null;
  duplicate?: boolean;
  discoveredLinks: number;
  links?: string[];
  markdown?: string;
  html?: string;
}

export interface CrawlMetrics {
  status: number;
  wordCount: number;
  textChars: number;
  markdownChars: number;
  discoveredLinks: number;
  duplicate: boolean;
  /** Extracted words divided by the visible body words (the extractor drops chrome, so below 1 is normal). */
  textCoverage: number | null;
  /** Head metadata the crawler reported that differs from the raw HTML. */
  metadataMismatch: string[];
}

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim() === (b ?? "").trim();

export function crawlMetrics(page: CrawlPage, html: HtmlMetrics, pageUrl: string): CrawlMetrics {
  const mismatch: string[] = [];
  // `title` is not compared: the crawler reports the extracted title (the first heading when there is one).
  if (page.lang !== undefined && !same(page.lang, html.lang)) mismatch.push("lang");
  if (page.description !== undefined && !same(page.description, html.description)) mismatch.push("description");
  if (page.canonical !== undefined && page.canonical !== null && html.canonical) {
    const a = resolveHref(page.canonical, pageUrl)?.href;
    const b = resolveHref(html.canonical, pageUrl)?.href;
    if (a !== b) mismatch.push("canonical");
  }
  return {
    status: page.status,
    wordCount: page.wordCount,
    textChars: page.textChars,
    markdownChars: page.markdownChars,
    discoveredLinks: page.discoveredLinks,
    duplicate: page.duplicate === true,
    textCoverage: html.text.visibleWords > 0 ? round(page.wordCount / html.text.visibleWords, 3) : null,
    metadataMismatch: mismatch,
  };
}

const round = (value: number, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Paths reachable from `start` through internal `<a href>` links only (what a link-following crawler can see). */
export function reachablePaths(
  pages: readonly { path: string; hrefs: readonly string[] }[],
  origin: string,
  start = "/",
): Set<string> {
  const outgoing = new Map(pages.map(page => [page.path, page.hrefs]));
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length > 0) {
    const path = queue.shift()!;
    if (seen.has(path) || !outgoing.has(path)) continue;
    seen.add(path);
    for (const href of outgoing.get(path)!) {
      const url = resolveHref(href, origin);
      if (url && url.origin === origin && !seen.has(url.pathname)) queue.push(url.pathname);
    }
  }
  return seen;
}

// ---------------------------------------------------------------------------------------------
// Report, baseline and verdict
// ---------------------------------------------------------------------------------------------

export type PageKind = "landing" | "primitives" | "forms" | "explorer" | "reader" | "data" | "lit" | "generic";

export interface PageReport {
  path: string;
  kind: PageKind;
  url: string;
  bytes: number;
  html: HtmlMetrics;
  crawl: CrawlMetrics | null;
}

/** Aggregate counters where lower is better; every one has a `max` in the baseline. */
export const GAP_METRICS = [
  "imagesMissingAlt",
  "unnamedInteractive",
  "unlabeledFormControls",
  "duplicateIds",
  "brokenIdRefs",
  "clickOnlyLinks",
  "emptyCustomElements",
  "mediaWithoutAlt",
  "invalidJsonLd",
  "headingSkips",
  "emptyHeadings",
  "pagesWithoutSingleH1",
  "pagesWithoutSingleMain",
  "unnamedNavigations",
  "pagesWithoutLang",
  "pagesWithoutTitle",
  "pagesWithoutDescription",
  "pagesWithoutCanonical",
  "unreachablePages",
  "metadataMismatches",
] as const;
export type GapMetric = (typeof GAP_METRICS)[number];

export interface Aggregate {
  pages: number;
  gaps: Record<GapMetric, number>;
  totals: {
    words: number;
    visibleWords: number;
    anchors: number;
    internalLinks: number;
    testIds: number;
    components: number;
    jsonLdBlocks: number;
    markdownChars: number;
    ariaHiddenWords: number;
    images: number;
    interactive: number;
    formControls: number;
  };
  crawl: {
    crawledPages: number;
    minTextCoverage: number | null;
    meanTextCoverage: number | null;
    unreachable: string[];
  } | null;
  componentNames: string[];
}

export function aggregate(
  pages: readonly PageReport[],
  unreachable: readonly string[] = [],
  crawled = false,
): Aggregate {
  const sum = (pick: (page: PageReport) => number) => pages.reduce((total, page) => total + pick(page), 0);
  const count = (test: (page: PageReport) => boolean) => pages.filter(test).length;
  const coverage = pages
    .map(page => page.crawl?.textCoverage)
    .filter((value): value is number => typeof value === "number");
  return {
    pages: pages.length,
    gaps: {
      imagesMissingAlt: sum(p => p.html.images.missingAlt),
      unnamedInteractive: sum(p => p.html.interactive.unnamed),
      unlabeledFormControls: sum(p => p.html.formControls.unlabeled),
      duplicateIds: sum(p => p.html.ids.duplicates.length),
      brokenIdRefs: sum(p => p.html.ids.brokenRefs.length),
      clickOnlyLinks: sum(p => p.html.links.clickOnly),
      emptyCustomElements: sum(p => p.html.customElements.empty.length),
      mediaWithoutAlt: sum(p => p.html.mediaWithoutAlt.total),
      invalidJsonLd: sum(p => p.html.jsonLd.invalid),
      headingSkips: sum(p => p.html.headings.skips),
      emptyHeadings: sum(p => p.html.headings.empty),
      pagesWithoutSingleH1: count(p => p.html.headings.h1 !== 1),
      pagesWithoutSingleMain: count(p => p.html.landmarks.main !== 1),
      unnamedNavigations: sum(p => p.html.unnamedNavigations),
      pagesWithoutLang: count(p => !p.html.lang),
      pagesWithoutTitle: count(p => !p.html.title),
      pagesWithoutDescription: count(p => !p.html.description),
      pagesWithoutCanonical: count(p => !p.html.canonical),
      unreachablePages: unreachable.length,
      metadataMismatches: sum(p => p.crawl?.metadataMismatch.length ?? 0),
    },
    totals: {
      words: sum(p => p.crawl?.wordCount ?? 0),
      visibleWords: sum(p => p.html.text.visibleWords),
      anchors: sum(p => p.html.links.withHref),
      internalLinks: sum(p => p.html.links.internal),
      testIds: sum(p => p.html.hooks.testIds),
      components: sum(p => p.html.hooks.components),
      jsonLdBlocks: sum(p => p.html.jsonLd.blocks),
      markdownChars: sum(p => p.crawl?.markdownChars ?? 0),
      ariaHiddenWords: sum(p => p.html.text.ariaHiddenWords),
      images: sum(p => p.html.images.total),
      interactive: sum(p => p.html.interactive.total),
      formControls: sum(p => p.html.formControls.total),
    },
    crawl: crawled
      ? {
          crawledPages: pages.filter(p => p.crawl !== null).length,
          minTextCoverage: coverage.length ? Math.min(...coverage) : null,
          meanTextCoverage: coverage.length ? round(coverage.reduce((a, b) => a + b, 0) / coverage.length, 3) : null,
          unreachable: [...unreachable],
        }
      : null,
    componentNames: [...new Set(pages.flatMap(p => p.html.hooks.componentNames))].toSorted(),
  };
}

export interface KindRequirement {
  /** Landmarks every page of the kind must carry at least once (`main` exactly once). */
  landmarks: LandmarkName[];
  minTestIds: number;
  minComponents: number;
  jsonLd: boolean;
  minInternalLinks: number;
  minVisibleWords: number;
}

export interface Baseline {
  schema: "aphrody-web.crawlability-baseline/1";
  note: string;
  max: Record<GapMetric, number>;
  min: { pages: number; crawledPages: number; textCoverage: number };
  kinds: Partial<Record<PageKind, KindRequirement>>;
}

export interface CrawlabilityReport {
  schema: "aphrody-web.crawlability/1";
  generatedBy: string;
  mode: "fixture" | "seed";
  engine: { binary: string; version: string } | null;
  origin: string;
  pages: PageReport[];
  aggregate: Aggregate;
  violations: Violation[];
}

export interface Violation {
  rule: string;
  scope: string;
  message: string;
  actual: number | string;
  limit: number | string;
}

/** The pages (up to 5) contributing most to a gap, for the violation message. */
function offenders(pages: readonly PageReport[], metric: GapMetric): string {
  const per = (page: PageReport): number => aggregate([page], [], false).gaps[metric];
  return (
    pages
      .filter(page => per(page) > 0)
      .toSorted((a, b) => per(b) - per(a))
      .slice(0, 5)
      .map(page => `${page.path} (${per(page)})`)
      .join(", ") || "-"
  );
}

/** Compares a report with the baseline; every returned item is a regression. */
export function evaluate(pages: readonly PageReport[], agg: Aggregate, baseline: Baseline): Violation[] {
  const violations: Violation[] = [];
  const crawled = agg.crawl !== null;
  for (const metric of GAP_METRICS) {
    const limit = baseline.max[metric];
    if (limit === undefined) continue;
    if (!crawled && metric === "metadataMismatches") continue;
    if (agg.gaps[metric] > limit) {
      violations.push({
        rule: `max.${metric}`,
        scope: "site",
        message: `${metric} ${agg.gaps[metric]} exceeds ${limit}; worst pages: ${offenders(pages, metric)}`,
        actual: agg.gaps[metric],
        limit,
      });
    }
  }
  if (agg.pages < baseline.min.pages) {
    violations.push({
      rule: "min.pages",
      scope: "site",
      message: `fixture has ${agg.pages} pages, expected at least ${baseline.min.pages}`,
      actual: agg.pages,
      limit: baseline.min.pages,
    });
  }
  if (crawled) {
    if (agg.crawl!.crawledPages < baseline.min.crawledPages) {
      violations.push({
        rule: "min.crawledPages",
        scope: "site",
        message: `the crawler reached ${agg.crawl!.crawledPages} pages, expected at least ${baseline.min.crawledPages}`,
        actual: agg.crawl!.crawledPages,
        limit: baseline.min.crawledPages,
      });
    }
    for (const page of pages) {
      const coverage = page.crawl?.textCoverage;
      if (typeof coverage === "number" && coverage < baseline.min.textCoverage) {
        violations.push({
          rule: "min.textCoverage",
          scope: page.path,
          message: `extracted ${page.crawl!.wordCount} of ${page.html.text.visibleWords} visible words (${coverage})`,
          actual: coverage,
          limit: baseline.min.textCoverage,
        });
      }
    }
  }
  for (const page of pages) {
    const need = baseline.kinds[page.kind];
    if (!need) continue;
    for (const landmark of need.landmarks) {
      const have = page.html.landmarks[landmark];
      if (have < 1 || (landmark === "main" && have !== 1)) {
        violations.push({
          rule: `kind.${page.kind}.landmark.${landmark}`,
          scope: page.path,
          message: `landmark ${landmark} found ${have} times`,
          actual: have,
          limit: landmark === "main" ? "1" : ">=1",
        });
      }
    }
    const checks: [string, number, number][] = [
      ["minTestIds", page.html.hooks.testIds, need.minTestIds],
      ["minComponents", page.html.hooks.components, need.minComponents],
      ["minInternalLinks", page.html.links.internal, need.minInternalLinks],
      ["minVisibleWords", page.html.text.visibleWords, need.minVisibleWords],
    ];
    for (const [rule, actual, limit] of checks) {
      if (actual < limit)
        violations.push({
          rule: `kind.${page.kind}.${rule}`,
          scope: page.path,
          message: `${rule} ${actual} is below ${limit}`,
          actual,
          limit,
        });
    }
    if (need.jsonLd && (page.html.jsonLd.blocks < 1 || page.html.jsonLd.invalid > 0)) {
      violations.push({
        rule: `kind.${page.kind}.jsonLd`,
        scope: page.path,
        message: `JSON-LD blocks ${page.html.jsonLd.blocks}, invalid ${page.html.jsonLd.invalid}`,
        actual: page.html.jsonLd.blocks,
        limit: ">=1 valid",
      });
    }
  }
  return violations;
}

/** The strictest baseline the current report satisfies (the ratchet written by `--update-baseline`). */
export function deriveBaseline(pages: readonly PageReport[], agg: Aggregate): Baseline {
  const kinds: Partial<Record<PageKind, KindRequirement>> = {};
  for (const kind of new Set(pages.map(page => page.kind))) {
    const group = pages.filter(page => page.kind === kind);
    kinds[kind] = {
      landmarks: LANDMARKS.filter(name => group.every(page => page.html.landmarks[name] >= 1)),
      // Slack of 20 % so a small fixture edit does not trip the gate; a lost hook family still does.
      minTestIds: Math.floor(Math.min(...group.map(page => page.html.hooks.testIds)) * 0.8),
      minComponents: Math.floor(Math.min(...group.map(page => page.html.hooks.components)) * 0.8),
      jsonLd: group.every(page => page.html.jsonLd.blocks >= 1 && page.html.jsonLd.invalid === 0),
      minInternalLinks: Math.min(...group.map(page => page.html.links.internal)),
      minVisibleWords: Math.floor(Math.min(...group.map(page => page.html.text.visibleWords)) * 0.9),
    };
  }
  const coverage = agg.crawl?.minTextCoverage;
  return {
    schema: "aphrody-web.crawlability-baseline/1",
    note: "Ratchet: thresholds equal the measured state when written by `bun scripts/audit/web-crawlability.ts --update-baseline`. A metric above its max, a missing landmark/hook/JSON-LD, or text coverage under the minimum fails the gate (exit 1). Tighten, never loosen, without review.",
    max: { ...agg.gaps },
    min: {
      pages: pages.length,
      crawledPages: agg.crawl?.crawledPages ?? 0,
      textCoverage: typeof coverage === "number" ? Math.floor(coverage * 0.9 * 100) / 100 : 0,
    },
    kinds,
  };
}

export function loadBaseline(path: string): Baseline | undefined {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Baseline) : undefined;
}

// ---------------------------------------------------------------------------------------------
// Page assembly (pure) and CLI
// ---------------------------------------------------------------------------------------------

export interface SitePage {
  path: string;
  kind: PageKind;
  html: string;
}

/** Builds the per-page reports from served HTML and the crawler's pages (matched by pathname). */
export async function buildPageReports(
  site: readonly SitePage[],
  origin: string,
  crawl: readonly CrawlPage[] | null,
): Promise<PageReport[]> {
  const byPath = new Map((crawl ?? []).map(page => [new URL(page.url).pathname, page]));
  const reports: PageReport[] = [];
  for (const page of site) {
    const crawled = byPath.get(page.path);
    const html = crawled?.html ?? page.html;
    const url = `${origin}${page.path}`;
    const metrics = await analyzeHtml(html, url);
    reports.push({
      path: page.path,
      kind: page.kind,
      url,
      bytes: Buffer.byteLength(html),
      html: metrics,
      crawl: crawl ? (crawled ? crawlMetrics(crawled, metrics, url) : null) : null,
    });
  }
  return reports;
}

function loadFixtureDir(dir: string): SitePage[] {
  const manifest = JSON.parse(readFileSync(join(dir, "fixture.json"), "utf8")) as {
    path: string;
    kind: PageKind;
    file: string;
  }[];
  return manifest.map(entry => ({
    path: entry.path,
    kind: entry.kind,
    html: readFileSync(join(dir, entry.file), "utf8"),
  }));
}

function saveFixtureDir(dir: string, site: readonly SitePage[]): void {
  mkdirSync(dir, { recursive: true });
  const manifest = site.map(page => ({
    path: page.path,
    kind: page.kind,
    file: `${page.path === "/" ? "index" : page.path.replace(/^\/|\/$/g, "").replaceAll("/", "__")}.html`,
  }));
  for (const [i, page] of site.entries()) writeFileSync(join(dir, manifest[i]!.file), page.html);
  writeFileSync(join(dir, "fixture.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

function printSummary(report: CrawlabilityReport): void {
  const w = (value: string | number, width: number) => String(value).padEnd(width);
  console.log(
    `${w("page", 24)}${w("kind", 11)}${w("words", 7)}${w("cover", 7)}${w("links", 6)}${w("h1", 4)}${w("land", 5)}${w("hooks", 7)}gaps`,
  );
  for (const page of report.pages) {
    const h = page.html;
    const gaps =
      h.images.missingAlt +
      h.interactive.unnamed +
      h.formControls.unlabeled +
      h.ids.duplicates.length +
      h.links.clickOnly +
      h.customElements.empty.length +
      h.mediaWithoutAlt.total;
    console.log(
      `${w(page.path, 24)}${w(page.kind, 11)}${w(h.text.visibleWords, 7)}${w(page.crawl?.textCoverage ?? "-", 7)}${w(h.links.internal, 6)}${w(h.headings.h1, 4)}${w(Object.values(h.landmarks).filter(n => n > 0).length, 5)}${w(`${h.hooks.testIds}/${h.hooks.components}`, 7)}${gaps}`,
    );
  }
  const a = report.aggregate;
  console.log(
    `\n${a.pages} pages${a.crawl ? `, crawler reached ${a.crawl.crawledPages}, coverage min ${a.crawl.minTextCoverage} mean ${a.crawl.meanTextCoverage}` : " (no crawler)"}`,
  );
  console.log(
    Object.entries(a.gaps)
      .map(([k, v]) => `${k}=${v}`)
      .join("  "),
  );
  console.log(
    Object.entries(a.totals)
      .map(([k, v]) => `${k}=${v}`)
      .join("  "),
  );
  for (const v of report.violations) console.log(`REGRESSION [${v.rule}] ${v.scope}: ${v.message}`);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const value = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const flag = (name: string) => args.includes(name);
  const { loadWebConfig, expandHome, repositoryRoot } = await import("@aphrody/bun-web/config");
  const root = repositoryRoot();
  const config = loadWebConfig();
  const baselinePath = resolve(root, value("--baseline") ?? "tools/config/web-crawlability.baseline.json");
  const outPath = value("--out")
    ? resolve(root, value("--out")!)
    : resolve(expandHome(config.storage.crawlabilityReport));

  let site: SitePage[] = [];
  let origin = "http://127.0.0.1";
  let mode: CrawlabilityReport["mode"] = "fixture";
  let server: ReturnType<typeof Bun.serve> | undefined;
  let crawlPages: CrawlPage[] | null = null;
  let engine: CrawlabilityReport["engine"] = null;
  let expectedPaths: string[] = [];

  try {
    const seed = value("--seed");
    const fixture = seed ? undefined : await import("./web-crawlability-fixture.ts");
    if (seed) mode = "seed";
    else {
      const fromDir = value("--from-fixture");
      site = fromDir ? loadFixtureDir(resolve(root, fromDir)) : await fixture!.renderFixtureSite();
      if (value("--save-fixture")) saveFixtureDir(resolve(root, value("--save-fixture")!), site);
    }

    if (!flag("--no-crawl")) {
      const { WebService } = await import("@aphrody/bun-web/service");
      const service = new WebService({ config, binary: value("--bin") });
      if (!(await service.supports("crawl"))) {
        console.error(
          `web-crawlability: ${service.binary} has no \`crawl\` subcommand; build it with \`cargo build -p bun_browser_engine\` or pass --no-crawl`,
        );
        process.exit(2);
      }
      engine = { binary: service.binary, version: await service.version() };
      let seedUrl = seed;
      if (!seed) {
        // Pages and support files are served from memory; the placeholder origin is swapped for the real one.
        let served: SitePage[] = site;
        let support: Record<string, { type: string; body: string }> = {};
        server = Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch(request) {
            const path = new URL(request.url).pathname;
            const page = served.find(candidate => candidate.path === path);
            if (page)
              return new Response(page.html, {
                headers: { "content-type": "text/html; charset=utf-8" },
              });
            const file = support[path];
            return file
              ? new Response(file.body, { headers: { "content-type": file.type } })
              : new Response("not found", { status: 404 });
          },
        });
        origin = `http://127.0.0.1:${server.port}`;
        served = site = fixture!.withOrigin(site, origin);
        support = fixture!.crawlSupportFiles(site, origin);
        seedUrl = `${origin}/`;
      } else origin = new URL(seed).origin;
      const report = await service.crawl([seedUrl!], {
        allowPrivateNetwork: flag("--allow-private-network") || !seed,
        includeHtml: true,
        includeLinks: true,
        includeMarkdown: true,
        maxDepth: 5,
        maxPages: Number(value("--max-pages") ?? 100),
        concurrency: 4,
        delayMs: 0,
        timeoutSecs: 180,
        obeyRobots: true,
        sitemaps: false,
      });
      crawlPages = report.pages as CrawlPage[];
      if (seed) {
        site = crawlPages.map(page => ({
          path: new URL(page.url).pathname,
          kind: "generic" as const,
          html: page.html ?? "",
        }));
      }
      await service.close();
    } else {
      origin = "http://127.0.0.1";
      if (fixture) site = fixture.withOrigin(site, origin);
    }
    expectedPaths = site.map(page => page.path);

    const pages = await buildPageReports(site, origin, crawlPages);
    // Reachability by links only: from the crawler when it ran, from the parsed `<a href>` graph otherwise.
    const graphReach = reachablePaths(
      pages.map(page => ({ path: page.path, hrefs: page.html.links.hrefs })),
      origin,
    );
    const reached = crawlPages ? new Set(crawlPages.map(page => new URL(page.url).pathname)) : graphReach;
    const unreachable = mode === "seed" ? [] : expectedPaths.filter(path => !reached.has(path));
    const agg = aggregate(pages, unreachable, crawlPages !== null);

    let baseline = loadBaseline(baselinePath);
    if (flag("--update-baseline")) {
      baseline = deriveBaseline(pages, agg);
      mkdirSync(dirname(baselinePath), { recursive: true });
      writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
      console.log(`web-crawlability: baseline written to ${baselinePath}`);
    }
    const violations = baseline ? evaluate(pages, agg, baseline) : [];
    const report: CrawlabilityReport = {
      schema: "aphrody-web.crawlability/1",
      generatedBy: "scripts/audit/web-crawlability.ts",
      mode,
      engine,
      origin: mode === "fixture" ? "http://127.0.0.1:<ephemeral>" : origin,
      pages,
      aggregate: agg,
      violations,
    };
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

    if (flag("--json")) console.log(JSON.stringify(report, null, 2));
    else {
      printSummary(report);
      console.log(`\nreport: ${outPath}`);
      console.log(
        baseline
          ? `baseline: ${baselinePath}`
          : `no baseline at ${baselinePath}; run with --update-baseline to create it`,
      );
    }
    process.exitCode = baseline ? (violations.length === 0 ? 0 : 1) : 1;
  } finally {
    server?.stop(true);
  }
}
