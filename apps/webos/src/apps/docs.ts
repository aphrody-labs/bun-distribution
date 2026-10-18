// SPDX-License-Identifier: Apache-2.0
// Docs app: the Bun fork documentation and the Bun OS documentation, built into dist/docs by docs.ts.
import { h } from "../dom";

interface Page {
  id: string;
  title: string;
  description: string;
  group: string;
  bytes: number;
  text: string;
}
interface Collection {
  id: string;
  label: string;
  pages: Page[];
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Minimal, safe Markdown renderer: headings, lists, emphasis, inline code, links (text only), tables as rows. */
export function renderMarkdown(src: string): string {
  const out: string[] = [];
  let inCode = false;
  let inList = false;
  for (const raw of src.split("\n")) {
    if (raw.trimStart().startsWith("```")) {
      out.push(inCode ? "</code></pre>" : "<pre><code>");
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(esc(raw));
      continue;
    }
    const line = esc(raw);
    const h2 = /^(#{1,4})\s+(.*)$/.exec(line);
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (inList && !li) {
      out.push("</ul>");
      inList = false;
    }
    if (h2) out.push(`<h${h2[1]!.length + 1}>${inline(h2[2]!)}</h${h2[1]!.length + 1}>`);
    else if (li) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(li[1]!)}</li>`);
    } else if (line.trim() === "") out.push("");
    else out.push(`<p>${inline(line)}</p>`);
  }
  if (inList) out.push("</ul>");
  if (inCode) out.push("</code></pre>");
  return out.join("\n");
}

function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, t: string, u: string) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`)
    .replace(/\[([^\]]+)\]\((?!https?:)[^)]+\)/g, "$1");
}

export async function docsApp(root: HTMLElement) {
  const meta = (await (await fetch("/docs/collections.json")).json()) as { id: string; label: string }[];
  const cols = new Map<string, Collection>();
  await Promise.all(
    meta.map(async m => {
      cols.set(m.id, (await (await fetch(`/docs/${m.id}/index.json`)).json()) as Collection);
    }),
  );
  let current = meta[0]?.id ?? "bunos";
  let query = "";
  const tabs = h("div", { class: "seg", role: "tablist" });
  const search = h("input", { class: "fld grow", type: "search", placeholder: "Search every page", "aria-label": "Search docs" });
  const list = h("nav", { class: "docs-list", "aria-label": "Pages" });
  const view = h("article", { class: "docs-view", tabindex: -1 });
  const count = h("div", { class: "files-status" });

  function pages(): Page[] {
    const all = cols.get(current)?.pages ?? [];
    const q = query.toLowerCase().trim();
    if (!q) return all;
    const terms = q.split(/\s+/);
    return all
      .map(p => {
        const hay = `${p.title} ${p.description} ${p.id} ${p.text}`.toLowerCase();
        const score = terms.reduce((s, t) => s + (p.title.toLowerCase().includes(t) ? 5 : 0) + (hay.includes(t) ? 1 : 0), 0);
        return { p, score };
      })
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(x => x.p);
  }

  function renderList() {
    const items = pages();
    const groups = new Map<string, Page[]>();
    for (const p of items) groups.set(p.group, [...(groups.get(p.group) ?? []), p]);
    list.replaceChildren(
      ...[...groups].flatMap(([g, ps]) => [
        h("h3", { class: "docs-group" }, g),
        ...ps.map(p => h("button", { class: "docs-link", onclick: () => void open(p) }, p.title)),
      ]),
    );
    count.textContent = `${items.length} page${items.length === 1 ? "" : "s"} · ${cols.get(current)?.label ?? current}`;
  }

  async function open(p: Page) {
    const res = await fetch(`/docs/${current}/${p.id}.md`);
    const md = await res.text();
    view.innerHTML = renderMarkdown(md);
    view.scrollTop = 0;
    for (const b of list.querySelectorAll(".docs-link")) b.classList.toggle("sel", b.textContent === p.title);
  }

  for (const m of meta) {
    tabs.append(
      h(
        "button",
        {
          role: "tab",
          class: "segb",
          onclick: () => {
            current = m.id;
            renderList();
          },
        },
        m.label,
      ),
    );
  }
  search.addEventListener("input", () => {
    query = search.value;
    renderList();
  });
  root.append(
    h(
      "div",
      { class: "docs" },
      h("div", { class: "files-bar" }, tabs, search),
      h("div", { class: "docs-main" }, list, view),
      count,
    ),
  );
  renderList();
  const first = cols.get(current)?.pages[0];
  if (first) void open(first);
}
