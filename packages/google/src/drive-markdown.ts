// SPDX-License-Identifier: Apache-2.0
/** Read-only projection of native Google Docs and flattened MCP snapshots. */
type Link = {
  url?: string;
  tabId?: string;
  heading?: { id?: string; tabId?: string };
  bookmark?: { id?: string; tabId?: string };
};
type Style = { bold?: boolean; italic?: boolean; strikethrough?: boolean; link?: Link };
type Element = {
  textRun?: { content?: string; textStyle?: Style };
  richLink?: { richLinkProperties?: { title?: string; uri?: string } };
  inlineObjectElement?: { inlineObjectId?: string };
  footnoteReference?: { footnoteId?: string };
};
type Paragraph = {
  elements?: Element[];
  paragraphStyle?: { namedStyleType?: string };
  bullet?: { listId?: string; nestingLevel?: number };
};
type Structural = {
  paragraph?: Paragraph;
  table?: { tableRows?: { tableCells?: { content?: Structural[] }[] }[] };
  sectionBreak?: unknown;
};
type Body = { content?: Structural[] };
type TabContent = {
  body?: Body | null;
  lists?: Record<string, { listProperties?: { nestingLevels?: { glyphType?: string; startNumber?: number }[] } }>;
  inlineObjects?: Record<
    string,
    {
      inlineObjectProperties?: {
        embeddedObject?: {
          title?: string;
          description?: string;
          imageProperties?: { contentUri?: string; sourceUri?: string };
        };
      };
    }
  >;
  footnotes?: Record<string, { content?: Structural[] }>;
};
type Tab = TabContent & {
  documentTab?: TabContent;
  tabProperties?: { title?: string };
  title?: string;
  childTabs?: Tab[];
};
export type NativeDocument = TabContent & { tabs?: Tab[]; title?: string };

export function normalizeMarkdown(markdown: string): string {
  return `${markdown
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trimEnd()}\n`;
}
function label(text: string): string {
  return text.replaceAll("\\", "\\\\").replaceAll("[", "\\[").replaceAll("]", "\\]");
}
function destination(url: string): string {
  return /[\s()]/.test(url) ? `<${url.replaceAll(">", "%3E")}>` : url;
}
function linkText(text: string, url: string): string {
  return `[${label(text)}](${destination(url)})`;
}
function style(text: string, marker: string): string {
  return text.replace(/^(\s*)([\s\S]*?)(\s*)$/, (_all, start: string, content: string, end: string) =>
    content ? `${start}${marker}${content}${marker}${end}` : text,
  );
}
function inline(element: Element, tab: TabContent): string {
  if (element.richLink) {
    const rich = element.richLink.richLinkProperties;
    if (!rich?.uri) throw new Error("Native rich link has no URI; content preserved in source snapshot");
    return linkText(rich.title ?? rich.uri, rich.uri);
  }
  if (element.inlineObjectElement) {
    const object =
      tab.inlineObjects?.[element.inlineObjectElement.inlineObjectId ?? ""]?.inlineObjectProperties?.embeddedObject;
    const url = object?.imageProperties?.sourceUri ?? object?.imageProperties?.contentUri;
    if (!url) throw new Error("Native inline object cannot be rendered losslessly");
    return `!${linkText(object?.title ?? object?.description ?? "image", url)}`;
  }
  if (element.footnoteReference) return `[^${element.footnoteReference.footnoteId}]`;
  if (!element.textRun) throw new Error("Unsupported native element; source is preserved for agent review");
  let text = element.textRun.content ?? "";
  const format = element.textRun.textStyle;
  if (format?.bold) text = style(text, "**");
  if (format?.italic) text = style(text, "*");
  if (format?.strikethrough) text = style(text, "~~");
  if (format?.link) {
    const link = format.link;
    const url =
      link.url ??
      (link.heading?.id
        ? `#${link.heading.id}`
        : link.bookmark?.id
          ? `#${link.bookmark.id}`
          : link.tabId
            ? `#tab=${link.tabId}`
            : undefined);
    if (!url) throw new Error("Unsupported native link target");
    text = text.replace(
      /^(\s*)([\s\S]*?)(\s*)$/,
      (_all, start: string, content: string, end: string) => `${start}${linkText(content, url)}${end}`,
    );
  }
  return text;
}
function renderContent(content: Structural[], tab: TabContent): string {
  const blocks: string[] = [],
    counters = new Map<string, number>();
  for (const element of content) {
    if (element.paragraph) {
      const p = element.paragraph;
      let text = (p.elements ?? [])
        .map(item => inline(item, tab))
        .join("")
        .replace(/\r\n?/g, "\n")
        .trimEnd();
      const heading = /HEADING_(\d)/.exec(p.paragraphStyle?.namedStyleType ?? "");
      if (heading && !/^#{1,6} /.test(text)) text = `${"#".repeat(Number(heading[1]))} ${text}`;
      else if (p.paragraphStyle?.namedStyleType === "TITLE" && !text.startsWith("# ")) text = `# ${text}`;
      if (p.bullet) {
        const depth = p.bullet.nestingLevel ?? 0,
          key = `${p.bullet.listId}:${depth}`;
        const nesting = tab.lists?.[p.bullet.listId ?? ""]?.listProperties?.nestingLevels?.[depth];
        const ordered = nesting?.glyphType && /DECIMAL|ALPHA|ROMAN/.test(nesting.glyphType);
        const n = counters.get(key) ?? nesting?.startNumber ?? 1;
        if (ordered) counters.set(key, n + 1);
        text = `${"  ".repeat(depth)}${ordered ? `${n}.` : "-"} ${text}`;
      }
      if (text) blocks.push(text);
    } else if (element.table) {
      const rows = (element.table.tableRows ?? []).map(row =>
        (row.tableCells ?? []).map(cell =>
          renderContent(cell.content ?? [], tab)
            .trim()
            .replaceAll("|", "\\|")
            .replaceAll("\n", "<br>"),
        ),
      );
      if (rows.length) {
        const width = Math.max(...rows.map(row => row.length));
        blocks.push(
          rows
            .map(
              (row, i) =>
                `${i === 1 ? `| ${Array(width).fill("---").join(" | ")} |\n` : ""}| ${Array.from({ length: width }, (_, col) => row[col] ?? "").join(" | ")} |`,
            )
            .join("\n") + (rows.length === 1 ? `\n| ${Array(width).fill("---").join(" | ")} |` : ""),
        );
      }
    } else if (!element.sectionBreak) throw new Error("Unsupported native block; source retained for agent review");
  }
  return blocks.join("\n\n");
}
export function nativeMarkdown(document: NativeDocument): string {
  const tabs: Tab[] = [];
  function visit(tab: Tab): void {
    tabs.push(tab);
    for (const child of tab.childTabs ?? []) visit(child);
  }
  for (const tab of document.tabs ?? []) visit(tab);
  if (!tabs.length) tabs.push(document);
  const rendered = tabs.map(tab => {
    const body = tab.documentTab ?? tab;
    const title = tab.tabProperties?.title ?? tab.title;
    let text = renderContent(body.body?.content ?? [], body);
    for (const [id, note] of Object.entries(body.footnotes ?? {}))
      text += `\n\n[^${id}]: ${renderContent(note.content ?? [], body).trim()}`;
    return tabs.length > 1 && title ? `## ${title}\n\n${text}` : text;
  });
  return normalizeMarkdown(rendered.join("\n\n"));
}
export function projectionMarkdown(document: NativeDocument, localMarkdown: string): string {
  const local = normalizeMarkdown(localMarkdown),
    remote = normalizeMarkdown(nativeMarkdown(document)),
    localFrontmatter = /^---\n[\s\S]*?\n---\n/.exec(local)?.[0] ?? "";
  // The Google Doc may contain the complete SOUL.md, including its YAML
  // frontmatter. Prefer it when present; only carry local profile metadata
  // forward when the remote Markdown has no frontmatter of its own.
  if (/^---\n[\s\S]*?\n---\n/.test(remote)) return remote;
  return normalizeMarkdown(`${localFrontmatter}${localFrontmatter ? "\n" : ""}${remote}`);
}
export function projectionAction(
  previous: { remoteHash: string; localHash: string } | undefined,
  remoteHash: string,
  localHash: string,
): "unchanged" | "local-ahead" | "stage" {
  if (!previous || previous.remoteHash !== remoteHash) return "stage";
  return previous.localHash === localHash ? "unchanged" : "local-ahead";
}
