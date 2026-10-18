// SPDX-License-Identifier: Apache-2.0
import { h } from "../dom";
import { installed } from "../pkg";
import type { WindowManager } from "../wm";

const mb = (n: number) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : `${(n / 1048576).toFixed(0)} MB`);

interface Perf extends Performance {
  memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
}
interface Nav extends Navigator {
  deviceMemory?: number;
  connection?: { effectiveType?: string; downlink?: number };
}

/** Activity monitor (btop in Omarchy): open windows with End, memory, storage and network of this session. */
export function activityApp(root: HTMLElement, wm: WindowManager) {
  const body = h("div", { class: "activity" });
  root.append(body);
  async function render() {
    const nav = navigator as Nav;
    const perf = performance as Perf;
    const est = await navigator.storage?.estimate?.().catch(() => undefined);
    const rows: [string, string][] = [
      ["Logical cores", String(navigator.hardwareConcurrency ?? "n/a")],
      ["Device memory", nav.deviceMemory ? `${nav.deviceMemory} GB` : "n/a"],
      [
        "Page memory",
        perf.memory
          ? `${mb(perf.memory.usedJSHeapSize)} of ${mb(perf.memory.jsHeapSizeLimit)}`
          : "n/a (not exposed by this browser)",
      ],
      ["Browser storage", est?.usage !== undefined ? `${mb(est.usage)} of ${mb(est.quota ?? 0)}` : "n/a"],
      [
        "Network",
        nav.connection?.effectiveType
          ? `${nav.connection.effectiveType} · ${nav.connection.downlink ?? "?"} Mb/s`
          : navigator.onLine
            ? "online"
            : "offline",
      ],
      ["Isolated (threads, SharedArrayBuffer)", String(crossOriginIsolated)],
      ["Installed apps", `${Object.keys(installed()).length}`],
    ];
    const list = [...wm.windows.values()].map(w =>
      h(
        "tr",
        {},
        h("td", {}, w.title),
        h("td", {}, w.scratch ? "scratchpad" : `workspace ${w.ws}`),
        h("td", {}, w.minimized ? "minimized" : "running"),
        h("td", {}, h("button", { class: "btn tonal", onclick: () => w.close() }, "End")),
      ),
    );
    body.replaceChildren(
      h("dl", { class: "kv" }, ...rows.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])),
      h("h3", {}, "Windows"),
      h(
        "table",
        { class: "act-table" },
        h("thead", {}, h("tr", {}, h("th", {}, "Name"), h("th", {}, "Where"), h("th", {}, "State"), h("th", {}))),
        h("tbody", {}, ...list),
      ),
    );
  }
  void render();
  const timer = setInterval(() => (root.isConnected ? void render() : clearInterval(timer)), 2000);
}
