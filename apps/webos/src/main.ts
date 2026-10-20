// SPDX-License-Identifier: Apache-2.0
import { cssFromSeed } from "@aphrody/m3-tokens/dynamic-color";
import { activityApp } from "./apps/activity";
import { appStore } from "./apps/appstore";
import { calculatorApp } from "./apps/calculator";
import { creativeApp } from "./apps/creative";
import { mediaApp } from "./apps/media";
import { storageApp } from "./apps/storage";
import { openWebApp, webApps, webAppsApp } from "./apps/webapps";
import { browserApp } from "./apps/browser";
import { editorApp } from "./apps/editor";
import { engineApp } from "./apps/engine";
import { filesApp } from "./apps/files";
import { docsApp } from "./apps/docs";
import { linuxApp } from "./apps/linux";
import { inspectorApp } from "./apps/inspector";
import { storeApp } from "./apps/store";
import { terminalApp } from "./apps/terminal";
import {
  attachCraftHost,
  type CraftHost,
  type CraftHostId,
} from "./apps/craft-host";
import { h, icon } from "./dom";
import { catalog, HOME, webos } from "./os";
import {
  installed,
  reconcile,
  registerServiceWorker,
  registry,
  type RegistryEntry,
} from "./pkg";
import { installKeys, shortcutsView } from "./keys";
import { WindowManager, type Layout } from "./wm";

interface Builtin {
  id: string;
  name: string;
  icon: string;
  desc: string;
  group: "core" | "advanced";
  width?: number;
  height?: number;
  mount(root: HTMLElement): void;
}

const desk = h("main", { class: "desk" });
const wm = new WindowManager(desk);
const craftHosts = new Map<string, CraftHost>();
const CRAFT_HOSTS: Record<string, CraftHostId> = {
  "craft-cad": "cad",
  "craft-grid": "grid",
  "craft-pdf": "pdf",
};
const dock = h("nav", { class: "dock", "aria-label": "Dock" });
const clock = h("time", { class: "clock" });
const bar = h("header", { class: "topbar" });

function loading(root: HTMLElement, task: Promise<unknown>) {
  const spin = h("div", { class: "empty" }, "Loading…");
  root.append(spin);
  task.then(
    () => spin.remove(),
    (error) => {
      spin.textContent = `This app could not start: ${String(error)}`;
    },
  );
}

function openEditor(path: string, text: string) {
  const content = h("div", { class: "fill" });
  void editorApp(content, path, text);
  wm.open({
    id: `edit:${path}`,
    title: path.split("/").pop() ?? path,
    icon: "doc",
    width: 640,
    height: 480,
    content,
  });
}

const builtins: Builtin[] = [
  {
    id: "aphrody-workspace",
    name: "Aphrody Workspace",
    icon: "app",
    desc: "Files, conversations, models and settings in your shared workspace",
    group: "core",
    width: 1100,
    height: 720,
    mount: (root) =>
      root.append(
        h("iframe", {
          class: "appframe",
          src: "/workspace/os",
          title: "Aphrody Workspace",
          allow:
            "clipboard-read; clipboard-write; fullscreen; cross-origin-isolated",
        }),
      ),
  },
  {
    id: "files",
    name: "Files",
    icon: "folder",
    desc: "Your files, saved in this browser",
    group: "core",
    mount: (root) =>
      loading(root, filesApp(root, openEditor, { openCraft: openCraftFile })),
  },
  {
    id: "browser",
    name: "Browser",
    icon: "globe",
    desc: "Browse the web in tabs",
    group: "core",
    width: 1000,
    height: 640,
    mount: (root) => browserApp(root),
  },
  {
    id: "apps",
    name: "Apps",
    icon: "store",
    desc: "Install games and creative apps",
    group: "core",
    width: 860,
    height: 600,
    mount: (root) => loading(root, appStore(root, refreshApps, launchPackage)),
  },
  {
    id: "creative",
    name: "Aphrody Creative",
    icon: "pen",
    desc: "Creative apps, projects and shared Drive files",
    group: "core",
    width: 980,
    height: 680,
    mount: (root) =>
      loading(
        root,
        creativeApp(root, refreshApps, launchPackage, () =>
          launchBuiltin(builtins.find((entry) => entry.id === "drive")!),
        ),
      ),
  },
  {
    id: "drive",
    name: "Aphrody Drive",
    icon: "folder",
    desc: "Creative projects and assets in the shared WebOS workspace",
    group: "core",
    width: 1120,
    height: 740,
    // Keep browser Drive on the same Rust VFS as Files. Projects saved here
    // remain available in both windows across WebOS sessions.
    mount: (root) =>
      loading(
        root,
        filesApp(root, openEditor, {
          start: `${HOME}/Projects`,
          openCraft: openCraftFile,
        }),
      ),
  },
  {
    id: "settings",
    name: "Settings",
    icon: "gear",
    desc: "Theme and appearance",
    group: "core",
    width: 520,
    height: 520,
    mount: (root) => settingsApp(root),
  },
  {
    id: "linux",
    name: "Alpine Linux",
    icon: "cube",
    desc: "A real Linux machine in your browser",
    group: "core",
    width: 900,
    height: 620,
    mount: (root) => loading(root, linuxApp(root)),
  },
  {
    id: "docs",
    name: "Docs",
    icon: "doc",
    desc: "Bun, the Bun fork and Bun OS documentation, searchable",
    group: "core",
    width: 980,
    height: 640,
    mount: (root) => loading(root, docsApp(root)),
  },
  {
    id: "terminal",
    name: "Terminal",
    icon: "terminal",
    desc: "Command line (Rust shell in WebAssembly)",
    group: "advanced",
    width: 760,
    height: 460,
    mount: (root) => loading(root, terminalApp(root)),
  },
  {
    id: "inspector",
    name: "Inspector",
    icon: "cube",
    desc: "Analyse any file: format, sections, hashes",
    group: "advanced",
    width: 760,
    height: 560,
    mount: (root) => loading(root, inspectorApp(root)),
  },
  {
    id: "engine",
    name: "Bun Engine",
    icon: "bolt",
    desc: "Run JavaScript in an isolated worker",
    group: "advanced",
    width: 820,
    height: 560,
    mount: (root) => loading(root, engineApp(root)),
  },
  {
    id: "workspace",
    name: "Source catalog",
    icon: "code",
    desc: "Every Bun OS app, package and crate",
    group: "advanced",
    width: 920,
    height: 600,
    mount: (root) =>
      loading(
        root,
        storeApp(
          root,
          (_kind, target) =>
            void window.open(
              target.startsWith("http")
                ? target
                : `https://github.com/aphrody-labs/bun-os/tree/os/apps/${target}`,
              "_blank",
              "noopener",
            ),
        ),
      ),
  },
  {
    id: "media",
    name: "Media",
    icon: "film",
    desc: "Play videos, music and pictures",
    group: "core",
    width: 820,
    height: 560,
    mount: (root) => loading(root, mediaApp(root)),
  },
  {
    id: "webapps",
    name: "Web Apps",
    icon: "globe",
    desc: "Sites pinned as apps",
    group: "core",
    width: 760,
    height: 520,
    mount: (root) => webAppsApp(root, () => renderLauncher()),
  },
  {
    id: "calculator",
    name: "Calculator",
    icon: "table",
    desc: "Calculator",
    group: "core",
    width: 320,
    height: 480,
    mount: (root) => calculatorApp(root),
  },
  {
    id: "storage",
    name: "Disk Usage",
    icon: "folder",
    desc: "What takes space in your files",
    group: "core",
    width: 760,
    height: 520,
    mount: (root) => loading(root, storageApp(root)),
  },
  {
    id: "activity",
    name: "Activity",
    icon: "bolt",
    desc: "Windows, memory and storage in use",
    group: "advanced",
    width: 640,
    height: 520,
    mount: (root) => activityApp(root, wm),
  },
  {
    id: "keys",
    name: "Keyboard",
    icon: "gear",
    desc: "Keyboard shortcuts and navigation",
    group: "core",
    width: 560,
    height: 560,
    mount: (root) => root.append(shortcutsView()),
  },
  {
    id: "about",
    name: "About",
    icon: "info",
    desc: "About this system",
    group: "core",
    width: 520,
    height: 420,
    mount: (root) => loading(root, aboutApp(root)),
  },
];

function launchBuiltin(b: Builtin) {
  const existing = wm.windows.get(b.id);
  if (existing) {
    wm.restore(existing);
    return;
  }
  const content = h("div", { class: "fill" });
  wm.open({
    id: b.id,
    title: b.name,
    icon: b.icon,
    width: b.width,
    height: b.height,
    content,
  });
  if (!content.hasChildNodes()) b.mount(content);
}

// Installed packages (from the package manager) behave like any other app.
let registryEntries: RegistryEntry[] = [];
const installedEntries = () => registryEntries.filter((e) => installed()[e.id]);
function launchPackage(e: RegistryEntry) {
  const existing = wm.windows.get(`pkg:${e.id}`);
  if (existing) {
    wm.restore(existing);
    return;
  }
  const content = h("div", { class: "fill" });
  let craftHost: CraftHost | undefined;
  wm.open({
    id: `pkg:${e.id}`,
    title: e.name,
    icon: e.category === "games" ? "game" : "app",
    width: 960,
    height: 640,
    content,
    onClose: () => {
      craftHost?.dispose();
      if (craftHosts.get(e.id) === craftHost) craftHosts.delete(e.id);
    },
  });
  if (!content.hasChildNodes()) {
    const hostId = CRAFT_HOSTS[e.id];
    const frame = h("iframe", {
      class: "appframe",
      src: `/apps/${e.id}/${hostId ? "?host=parent" : ""}`,
      title: e.name,
      allow:
        "fullscreen; gamepad; autoplay; clipboard-read; clipboard-write; cross-origin-isolated",
    }) as HTMLIFrameElement;
    if (hostId) {
      craftHost = attachCraftHost(frame, hostId, (name, bytes) =>
        saveCraftFile(hostId, name, bytes),
      );
      craftHosts.set(e.id, craftHost);
    }
    content.append(frame);
  }
}

function openCraftFile(
  id: CraftHostId,
  name: string,
  bytes: Uint8Array,
): boolean {
  const packageId = `craft-${id}`;
  const entry = installedEntries().find((item) => item.id === packageId);
  if (!entry) {
    launchBuiltin(builtins.find((item) => item.id === "apps")!);
    return false;
  }
  launchPackage(entry);
  return craftHosts.get(packageId)?.open(name, bytes) ?? false;
}

async function saveCraftFile(id: CraftHostId, name: string, bytes: Uint8Array) {
  const os = await webos();
  const root = `${HOME}/Projects/Craft`;
  const directory = `${root}/${id}`;
  try {
    os.fs.stat(root);
  } catch {
    os.fs.mkdir(root);
  }
  try {
    os.fs.stat(directory);
  } catch {
    os.fs.mkdir(directory);
  }
  os.fs.write(`${directory}/${name}`, bytes);
  await os.flush();
}
function refreshApps() {
  renderDock();
  renderDesktopIcons();
}

async function aboutApp(root: HTMLElement) {
  const data = await catalog();
  const health = await fetch("/api/health").then(
    (r) => r.json() as Promise<{ colo?: string }>,
    () => ({}) as { colo?: string },
  );
  root.append(
    h(
      "div",
      { class: "detail" },
      h("h2", {}, "Aphrody Bun OS"),
      h(
        "p",
        {},
        "A complete desktop that runs in your browser. Your files stay on your device.",
      ),
      h(
        "dl",
        { class: "kv" },
        h("dt", {}, "Workspace"),
        h(
          "dd",
          {},
          `${data.counts.apps} apps · ${data.counts.packages} packages · ${data.counts.crates} crates`,
        ),
        h("dt", {}, "Installed apps"),
        h("dd", {}, String(Object.keys(installed()).length)),
        h("dt", {}, "Browser"),
        h(
          "dd",
          {},
          navigator.userAgent.replace(/^Mozilla\/5.0 /, "").slice(0, 80),
        ),
        h("dt", {}, "Cores"),
        h("dd", {}, String(navigator.hardwareConcurrency ?? "n/a")),
        h("dt", {}, "Language"),
        h("dd", {}, navigator.language),
        h("dt", {}, "Edge location"),
        h("dd", {}, health.colo ?? "n/a"),
        h("dt", {}, "Built"),
        h("dd", {}, data.generated.slice(0, 16).replace("T", " ")),
      ),
    ),
  );
}

const SEEDS: [string, string][] = [
  ["Violet", "#6750a4"],
  ["Ocean", "#0b6bcb"],
  ["Forest", "#2e7d32"],
  ["Sunset", "#d84315"],
  ["Rose", "#c2185b"],
  ["Slate", "#455a64"],
];
function applyPrefs() {
  const mode = localStorage.getItem("aph.mode") ?? "auto";
  if (mode === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = mode;
  const seed = localStorage.getItem("aph.seed");
  let style = document.getElementById("seed-css");
  if (seed && seed !== "#6750a4") {
    style ??= document.head.appendChild(h("style", { id: "seed-css" }));
    style.textContent = cssFromSeed(seed, { variant: "expressive" });
  } else style?.remove();
}
function settingsApp(root: HTMLElement) {
  const set = (k: string, v: string) => {
    localStorage.setItem(k, v);
    applyPrefs();
  };
  root.append(
    h(
      "div",
      { class: "detail" },
      h("h2", {}, "Appearance"),
      h(
        "div",
        { class: "seg" },
        ...["auto", "light", "dark"].map((m) =>
          h(
            "button",
            {
              class: "segb",
              "aria-selected": String(
                (localStorage.getItem("aph.mode") ?? "auto") === m,
              ),
              onclick: (e: Event) => {
                set("aph.mode", m);
                for (const b of (e.currentTarget as HTMLElement).parentElement!
                  .children)
                  b.setAttribute(
                    "aria-selected",
                    String(b === e.currentTarget),
                  );
              },
            },
            m[0]!.toUpperCase() + m.slice(1),
          ),
        ),
      ),
      h("h3", {}, "Colour"),
      h(
        "div",
        { class: "swatches" },
        ...SEEDS.map(([name, hex]) =>
          h("button", {
            class: "swatch",
            title: name,
            "aria-label": name,
            style: `background:${hex}`,
            onclick: () => set("aph.seed", hex),
          }),
        ),
      ),
      h(
        "button",
        {
          class: "btn tonal",
          onclick: () => {
            localStorage.removeItem("aph.seed");
            localStorage.removeItem("aph.mode");
            applyPrefs();
          },
        },
        "Reset",
      ),
    ),
  );
}

// Launcher: your apps first, then installed packages, then advanced tools.
const launcher = h("div", {
  class: "launcher",
  hidden: true,
  role: "dialog",
  "aria-modal": "true",
  "aria-label": "Applications",
});
let launcherOpener: HTMLElement | null = null;
const lsearch = h("input", {
  class: "lsearch",
  type: "search",
  placeholder: "Search apps and the web",
  "aria-label": "Search",
  autocomplete: "off",
});
const lgrid = h("div", { class: "lgrid" });
launcher.append(
  h(
    "div",
    { class: "lbox" },
    h(
      "div",
      { class: "launcher-heading" },
      h(
        "div",
        {},
        h("strong", {}, "Aphrody"),
        h("span", {}, "Your apps, one workspace."),
      ),
      h(
        "button",
        {
          class: "tbtn",
          "aria-label": "Close applications",
          onclick: () => closeLauncher(),
        },
        icon("close"),
      ),
    ),
    lsearch,
    lgrid,
  ),
);

function renderLauncher() {
  const q = lsearch.value.trim().toLowerCase();
  const match = (name: string, desc: string) =>
    !q || name.toLowerCase().includes(q) || desc.toLowerCase().includes(q);
  const tile = (name: string, ic: string, fn: () => void, sub = "") =>
    h(
      "button",
      {
        class: "ltile",
        onclick: () => {
          closeLauncher();
          fn();
        },
      },
      h("span", { class: "licon" }, icon(ic)),
      h("span", { class: "lname" }, name),
      sub ? h("span", { class: "lsub" }, sub) : null,
    );
  const section = (title: string, tiles: HTMLElement[]) =>
    tiles.length
      ? [
          h("h3", { class: "lhead" }, title),
          h("div", { class: "lsection" }, ...tiles),
        ]
      : [];
  const core = builtins
    .filter((b) => b.group === "core" && match(b.name, b.desc))
    .map((b) => tile(b.name, b.icon, () => launchBuiltin(b), b.desc));
  const pkgs = installedEntries()
    .filter((e) => match(e.name, e.description))
    .map((e) =>
      tile(
        e.name,
        e.category === "games" ? "game" : "app",
        () => launchPackage(e),
        e.category,
      ),
    );
  const web = webApps()
    .filter((a) => match(a.name, a.url))
    .map((a) =>
      tile(a.name, "globe", () => openWebApp(a), new URL(a.url).hostname),
    );
  const adv = builtins
    .filter((b) => b.group === "advanced" && match(b.name, b.desc))
    .map((b) => tile(b.name, b.icon, () => launchBuiltin(b), b.desc));
  const search = q
    ? [
        tile(`Search the web for “${lsearch.value.trim()}”`, "globe", () => {
          const content = h("div", { class: "fill" });
          wm.open({
            title: "Browser",
            icon: "globe",
            width: 1000,
            height: 640,
            content,
          });
          browserApp(content, lsearch.value.trim());
        }),
      ]
    : [];
  lgrid.replaceChildren(
    ...section("Apps", core),
    ...section("Installed", pkgs),
    ...section("Web apps", web),
    ...section("Advanced", adv),
    ...section("Web", search),
  );
}
function openLauncher() {
  if (launcher.hidden)
    launcherOpener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  launcher.hidden = false;
  lsearch.value = "";
  renderLauncher();
  lsearch.focus();
}
function closeLauncher() {
  launcher.hidden = true;
  if (launcherOpener?.isConnected) launcherOpener.focus();
  else bar.querySelector<HTMLElement>(".brand")?.focus();
}
lsearch.addEventListener("input", renderLauncher);
launcher.addEventListener("pointerdown", (e) => {
  if (e.target === launcher) closeLauncher();
});
window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (launcher.hidden) openLauncher();
    else closeLauncher();
  }
  if (e.key === "Escape" && !launcher.hidden) closeLauncher();
  if (
    e.key === "Enter" &&
    !launcher.hidden &&
    document.activeElement === lsearch
  )
    lgrid.querySelector<HTMLElement>(".ltile")?.click();
  if (
    !launcher.hidden &&
    e.key === "ArrowDown" &&
    document.activeElement === lsearch
  ) {
    e.preventDefault();
    lgrid.querySelector<HTMLElement>(".ltile")?.focus();
  }
  if (!launcher.hidden && e.key === "Tab") {
    const controls = [
      ...launcher.querySelectorAll<HTMLElement>("button, input"),
    ];
    const first = controls[0];
    const last = controls.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  }
});

function renderDock() {
  const items: HTMLElement[] = [
    h(
      "button",
      {
        class: "dbtn launch",
        title: "Launcher (Ctrl+K)",
        "aria-label": "Open launcher",
        onclick: openLauncher,
      },
      icon("grid"),
    ),
    h("span", { class: "dsep" }),
  ];
  const toggle = (id: string) => {
    const w = wm.windows.get(id)!;
    if (w.minimized || wm.activeId() !== id) wm.restore(w);
    else wm.minimize(w);
  };
  const pinned = ["files", "browser", "terminal", "linux", "apps"].map((id) =>
    builtins.find((b) => b.id === id)!,
  );
  const seen = new Set<string>();
  for (const b of pinned) {
    seen.add(b.id);
    const w = wm.windows.get(b.id);
    items.push(
      h(
        "button",
        {
          class: `dbtn${w ? " running" : ""}${w && wm.activeId() === b.id ? " current" : ""}`,
          title: b.name,
          "aria-label": b.name,
          onclick: () => (w ? toggle(b.id) : launchBuiltin(b)),
        },
        icon(b.icon),
      ),
    );
  }
  for (const e of installedEntries()) {
    const id = `pkg:${e.id}`;
    seen.add(id);
    const w = wm.windows.get(id);
    items.push(
      h(
        "button",
        {
          class: `dbtn${w ? " running" : ""}${w && wm.activeId() === id ? " current" : ""}`,
          title: e.name,
          "aria-label": e.name,
          onclick: () => (w ? toggle(id) : launchPackage(e)),
        },
        icon(e.category === "games" ? "game" : "app"),
      ),
    );
  }
  for (const [id, w] of wm.windows) {
    if (seen.has(id)) continue;
    items.push(
      h(
        "button",
        {
          class: `dbtn running${wm.activeId() === id ? " current" : ""}`,
          title: w.title,
          "aria-label": w.title,
          onclick: () => toggle(id),
        },
        icon(w.iconName),
      ),
    );
  }
  dock.replaceChildren(...items);
}
wm.onChange(renderDock);

const icons = h("div", { class: "icons" });
function renderDesktopIcons() {
  const tiles = [
    ...builtins
      .filter((b) => b.group === "core" && b.id !== "about")
      .map((b) => ({ name: b.name, ic: b.icon, fn: () => launchBuiltin(b) })),
    ...installedEntries().map((e) => ({
      name: e.name,
      ic: e.category === "games" ? "game" : "app",
      fn: () => launchPackage(e),
    })),
  ];
  icons.replaceChildren(
    ...tiles.map((t) =>
      h(
        "button",
        {
          class: "dicon",
          onclick: (e: MouseEvent) => {
            if (
              e.detail === 0 ||
              matchMedia("(pointer: coarse)").matches ||
              e.detail >= 2
            )
              t.fn();
          },
        },
        h("span", { class: "licon" }, icon(t.ic)),
        h("span", {}, t.name),
      ),
    ),
  );
}
desk.append(icons);

function tick() {
  const d = new Date();
  clock.textContent = d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  clock.dateTime = d.toISOString();
}

const wsBar = h("nav", { class: "wsbar", "aria-label": "Workspaces" });
const workspaceStatus = h("button", {
  class: "workspace-status",
  "aria-label": "Switch workspace",
  onclick: () => wm.cycleWorkspace(),
});
const activeApp = h("span", { class: "active-app", "aria-live": "polite" });
const layoutBtn = h("button", {
  class: "tbtn layout",
  title: "Layout (Alt+L)",
  "aria-label": "Cycle layout",
  onclick: () => wm.cycleLayout(),
});
const MARK: Record<Layout, string> = {
  dwindle: "■",
  scrolling: "●",
  floating: "▲",
};
function renderBar() {
  workspaceStatus.textContent = `Space ${wm.workspace}`;
  workspaceStatus.title = `Workspace ${wm.workspace}. Switch to the next workspace`;
  activeApp.textContent = wm.active()?.title ?? "Desktop";
  const occupied = wm.occupied();
  wsBar.replaceChildren(
    ...Array.from({ length: 10 }, (_, i) => {
      const n = i + 1;
      return h(
        "button",
        {
          class: `ws${wm.workspace === n ? " cur" : ""}${occupied.has(n) ? " occ" : ""}`,
          "aria-label": `Workspace ${n}`,
          "aria-current": wm.workspace === n ? "true" : undefined,
          onclick: () => wm.goTo(n),
        },
        String(n === 10 ? 0 : n),
      );
    }),
  );
  layoutBtn.textContent = MARK[wm.layout()];
  layoutBtn.setAttribute("aria-label", `Layout: ${wm.layout()}. Cycle layout`);
}
wm.onChange(renderBar);
bar.append(
  h(
    "button",
    { class: "brand", onclick: openLauncher, "aria-label": "Open launcher" },
    h("img", { src: "/brand/32.png", alt: "", width: 22, height: 22 }),
    "Aphrody",
  ),
  wsBar,
  workspaceStatus,
  activeApp,
  h("span", { class: "grow" }),
  layoutBtn,
  h(
    "button",
    {
      class: "tbtn",
      title: "Search (Ctrl+K)",
      "aria-label": "Search",
      onclick: openLauncher,
    },
    icon("search"),
  ),
  clock,
  h(
    "button",
    {
      class: "tbtn",
      title: "Settings",
      "aria-label": "Open settings",
      onclick: () => launchBuiltin(builtins.find((b) => b.id === "settings")!),
    },
    icon("gear"),
  ),
);
desk.id = "desk";
desk.tabIndex = -1;
document.body.append(
  h("a", { class: "skip", href: "#desk" }, "Skip to desktop"),
  bar,
  desk,
  dock,
  launcher,
);
applyPrefs();
tick();
setInterval(tick, 15_000);
refreshApps();
renderBar();
installKeys(wm, {
  launcher: () => (launcher.hidden ? openLauncher() : closeLauncher()),
  launch: (id) => launchBuiltin(builtins.find((b) => b.id === id)!),
  help: () => launchBuiltin(builtins.find((b) => b.id === "keys")!),
  webHotkey: (code) => {
    const app = webApps().find((a) => a.key === code);
    if (app) openWebApp(app);
    return !!app;
  },
});

void registerServiceWorker();
const wanted = new URLSearchParams(location.search).get("app");
void reconcile()
  .then(registry)
  .then((entries) => {
    registryEntries = entries;
    refreshApps();
    // Old product links (?app=craft-pdf): open the installed package, or the store to install it.
    const entry = entries.find((e) => e.id === wanted);
    if (entry) {
      if (installed()[entry.id]) launchPackage(entry);
      else launchBuiltin(builtins.find((b) => b.id === "apps")!);
    }
  })
  .catch(() => {});

const target = builtins.find((x) => x.id === wanted);
if (target || !wanted || !wanted.includes("-"))
  launchBuiltin(target ?? builtins.find((b) => b.id === "files")!);
