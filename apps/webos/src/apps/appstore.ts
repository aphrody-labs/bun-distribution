// SPDX-License-Identifier: Apache-2.0
import { h } from "../dom";
import "../m3";
import { install, installed, needsUpdate, registry, uninstall, type RegistryEntry } from "../pkg";

const CATEGORIES: { id: RegistryEntry["category"] | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "create", label: "Create" },
  { id: "games", label: "Games" },
  { id: "tools", label: "Tools" },
];

const fmt = (n: number) => (n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** App store backed by the package manager: verified installs, offline use, updates, removal. */
export async function appStore(root: HTMLElement, onChange: () => void, launch: (entry: RegistryEntry) => void) {
  const entries = await registry();
  const requestedCategory = new URLSearchParams(location.search).get("category");
  let category: (typeof CATEGORIES)[number]["id"] = CATEGORIES.find(entry => entry.id === requestedCategory)?.id ?? "all";
  const grid = h("div", { class: "store-list" });
  const tabs = document.createElement("md-tabs");
  const buttons = CATEGORIES.map(c =>
    h(
      "md-primary-tab" as "button",
      {
        onclick: () => {
          category = c.id;
          render();
        },
      },
      c.label,
    ),
  );
  tabs.append(...buttons);
  tabs.setAttribute("active-tab-index", String(CATEGORIES.findIndex(entry => entry.id === category)));

  function card(e: RegistryEntry) {
    const have = installed()[e.id];
    const action = h("div", { class: "sact" });
    const status = h(
      "div",
      { class: "muted pkg-status" },
      have ? `Installed · v${have.version}` : `${fmt(e.size)} download`,
    );
    const progress = document.createElement("md-linear-progress") as HTMLElement & { value: number };
    progress.value = 0;
    progress.hidden = true;
    const run = (fn: () => Promise<void>) => async (ev: Event) => {
      const btn = ev.currentTarget as HTMLButtonElement;
      btn.disabled = true;
      progress.hidden = false;
      try {
        await fn();
        onChange();
      } catch (error) {
        status.textContent = `Failed: ${String((error as Error).message ?? error)}`;
        status.classList.add("err");
        btn.disabled = false;
        progress.hidden = true;
        return;
      }
      render();
    };
    const doInstall = run(() =>
      install(e, (d, t) => {
        progress.value = d / t;
        status.textContent = `Downloading… ${Math.round((d / t) * 100)}%`;
      }),
    );
    if (!have) action.append(h("button", { class: "btn", onclick: doInstall }, "Install"));
    else {
      action.append(h("button", { class: "btn", onclick: () => launch(e) }, "Open"));
      if (needsUpdate(e)) action.append(h("button", { class: "btn tonal", onclick: doInstall }, "Update"));
      action.append(h("button", { class: "btn tonal", onclick: run(() => uninstall(e.id)) }, "Remove"));
    }
    return h(
      "article",
      { class: "scard" },
      h(
        "div",
        { class: "pkg-head" },
        h("span", { class: "licon" }, e.glyph),
        h(
          "div",
          {},
          h("div", { class: "sname" }, e.name),
          h("div", { class: "muted" }, `v${e.version} · ${e.license}`),
        ),
      ),
      h("div", { class: "sdesc" }, e.description),
      status,
      progress,
      action,
    );
  }

  function render() {
    const shown = entries.filter(e => category === "all" || e.category === category);
    grid.replaceChildren(...(shown.length ? shown.map(card) : [h("div", { class: "empty" }, "Nothing here yet.")]));
  }
  root.append(h("div", { class: "store" }, tabs, grid));
  render();
}
