// SPDX-License-Identifier: Apache-2.0
import { h } from "../dom";
import "../m3";
import { catalog, type Catalog } from "../os";
import { sourceUrl } from "../config";

type Tab = "all" | "apps" | "packages" | "crates" | "wasm" | "ui";
type Kind = "apps" | "packages" | "crates";
interface Row {
  id: string;
  d: string;
  kind: Kind;
  /** Desktop app or package a member is (apps only). */
  opens?: string;
}
const TABS: Tab[] = ["all", "apps", "packages", "crates", "wasm", "ui"];
const WASM = /wasm|(^|[-_])web($|[-_])|wgpu|webgpu|webos|trunk/i;
const UI =
  /(^|[-_])(ui|m3|egui|gui|components?|widgets?|design|theme|icons?|fonts?|tokens|react|tauri|material|shell|explorer)($|[-_])|craft-web/i;
const PAGE = 200;

export async function storeApp(
  root: HTMLElement,
  launch: (kind: "app" | "url", target: string) => void,
) {
  const data: Catalog = await catalog();
  const rows: Row[] = [
    ...data.apps.map((e) => ({ ...e, kind: "apps" as const })),
    ...data.packages.map((e) => ({ ...e, kind: "packages" as const })),
    ...data.crates.map((e) => ({ ...e, kind: "crates" as const })),
  ];
  const inTab = (r: Row, t: Tab) => {
    if (t === "all") return true;
    if (t === "wasm") return WASM.test(r.id) || WASM.test(r.d);
    if (t === "ui")
      return (
        UI.test(r.id) ||
        /user interface|component|design system|material/i.test(r.d)
      );
    return r.kind === t;
  };
  let tab: Tab = "all";
  let limit = PAGE;
  const search = h("input", {
    class: "fld grow",
    type: "search",
    placeholder: "Search every app, package and crate",
    "aria-label": "Search",
  });
  const out = h("div", { class: "store-list" });
  const count = h("div", { class: "files-status" });
  const tabsEl = document.createElement("md-tabs");
  const counts = new Map(
    TABS.map((t) => [t, rows.filter((r) => inTab(r, t)).length]),
  );
  const buttons = TABS.map((t) =>
    h(
      "md-primary-tab" as "button",
      {
        onclick: () => {
          tab = t;
          limit = PAGE;
          render();
        },
      },
      `${t[0]!.toUpperCase()}${t.slice(1)} · ${counts.get(t)}`,
    ),
  );
  tabsEl.append(...buttons);

  function render() {
    const q = search.value.trim().toLowerCase();
    const matches = rows.filter(
      (r) =>
        inTab(r, tab) &&
        (!q || r.id.toLowerCase().includes(q) || r.d.toLowerCase().includes(q)),
    );
    const shown = matches.slice(0, limit).map((r) => {
      const actions: HTMLElement[] = [];
      const source = sourceUrl(`${r.kind}/${r.id}`);
      actions.push(
        h(
          "button",
          {
            class: r.kind === "apps" ? "btn tonal" : "btn",
            onclick: () => launch("url", source),
          },
          "Source",
        ),
      );
      if (r.kind === "apps") {
        // Every app opens in the desktop: its browser build, or the member window of a native app.
        actions.unshift(
          h(
            "button",
            {
              class: "btn",
              onclick: () => launch("app", r.opens ?? `src:${r.id}`),
            },
            "Open",
          ),
        );
      }
      return h(
        "article",
        { class: "scard" },
        h("div", { class: "sname" }, r.id),
        h("div", { class: "sdesc" }, r.d || "No description"),
        h(
          "div",
          { class: "sact" },
          h("span", { class: "chip" }, r.kind.slice(0, -1)),
          ...actions,
        ),
      );
    });
    out.replaceChildren(...shown);
    if (matches.length > limit) {
      out.append(
        h(
          "button",
          {
            class: "btn wide",
            onclick: () => {
              limit += PAGE;
              render();
            },
          },
          `Show more (${matches.length - limit} left)`,
        ),
      );
    }
    count.textContent = `${matches.length} of ${rows.length} items · catalog generated ${data.generated.slice(0, 10)}`;
  }
  search.addEventListener("input", () => {
    limit = PAGE;
    render();
  });
  root.append(
    h(
      "div",
      { class: "store" },
      h(
        "header",
        { class: "catalog-intro" },
        h("h1", {}, "Build, create, explore."),
        h(
          "p",
          {},
          "The Bun OS source catalog: real applications, packages and Rust crates from this release. Installable browser apps are available in Apps.",
        ),
        h(
          "div",
          { class: "sact" },
          h(
            "button",
            { class: "btn", onclick: () => launch("app", "apps") },
            "Browse installable apps",
          ),
          h(
            "button",
            { class: "btn tonal", onclick: () => launch("app", "creative") },
            "Creative workspace",
          ),
          h(
            "button",
            { class: "btn tonal", onclick: () => launch("app", "linux") },
            "Start Alpine Linux",
          ),
        ),
      ),
      h("div", { class: "files-bar" }, search),
      tabsEl,
      out,
      count,
    ),
  );
  render();
}
