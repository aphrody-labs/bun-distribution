// SPDX-License-Identifier: Apache-2.0
// Web apps (Omarchy 25-web-apps): sites pinned to the launcher that open in their own app window.
import { ask, h } from "../dom";
import { DEFAULT_WEBAPPS, type WebApp } from "../config";

export type { WebApp };

const KEY = "aph.webapps";
/** Default pins come from apps/webos/apps.json. */
export { DEFAULT_WEBAPPS };

export function webApps(): WebApp[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as WebApp[]) : DEFAULT_WEBAPPS;
  } catch {
    return DEFAULT_WEBAPPS;
  }
}
const save = (list: WebApp[]) => localStorage.setItem(KEY, JSON.stringify(list));

/** Sites refuse to be framed, so each app gets its own app-style browser window. */
export function openWebApp(app: WebApp) {
  const w = 1100;
  const hh = 760;
  const left = Math.max(0, (screen.width - w) / 2);
  const top = Math.max(0, (screen.height - hh) / 2);
  window.open(app.url, `aph-web-${app.id}`, `popup=yes,noopener,width=${w},height=${hh},left=${left},top=${top}`);
}

export function normalizeUrl(input: string): string | undefined {
  const text = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  try {
    const u = new URL(text);
    return u.hostname.includes(".") ? u.href : undefined;
  } catch {
    return undefined;
  }
}

export function webAppsApp(root: HTMLElement, onChange: () => void) {
  const list = h("div", { class: "store-list" });
  const status = h(
    "div",
    { class: "files-status" },
    "Sign in with the regular browser first. Each app opens in its own window.",
  );
  function render() {
    const apps = webApps();
    list.replaceChildren(
      ...apps.map(a =>
        h(
          "article",
          { class: "scard" },
          h("div", { class: "sname" }, a.name),
          h(
            "div",
            { class: "sdesc mono" },
            new URL(a.url).hostname + (a.key ? `  ·  Alt+Shift+${a.key.replace("Key", "")}` : ""),
          ),
          h(
            "div",
            { class: "sact" },
            h("button", { class: "btn", onclick: () => openWebApp(a) }, "Open"),
            h(
              "button",
              {
                class: "btn tonal",
                onclick: () => {
                  save(webApps().filter(x => x.id !== a.id));
                  onChange();
                  render();
                },
              },
              "Remove",
            ),
          ),
        ),
      ),
    );
    if (!apps.length) list.append(h("div", { class: "empty" }, "No web apps. Add one above."));
  }
  async function add() {
    const name = await ask("New web app", "Name");
    if (!name) return;
    const raw = await ask("New web app", "Address (for example example.com)");
    const url = raw ? normalizeUrl(raw) : undefined;
    if (!url) {
      status.textContent = "That address is not valid.";
      return;
    }
    save([
      ...webApps(),
      { id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`, name, url },
    ]);
    onChange();
    render();
  }
  root.append(
    h(
      "div",
      { class: "store" },
      h(
        "div",
        { class: "files-bar" },
        h("button", { class: "btn", onclick: () => void add() }, "Add web app"),
        h(
          "button",
          {
            class: "btn tonal",
            onclick: () => {
              save(DEFAULT_WEBAPPS);
              onChange();
              render();
            },
          },
          "Restore defaults",
        ),
      ),
      list,
      status,
    ),
  );
  render();
}
