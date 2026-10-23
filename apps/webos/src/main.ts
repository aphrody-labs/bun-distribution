// SPDX-License-Identifier: Apache-2.0
import routeCatalog from "../../../infra/config/routes.catalog.json";
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
  craftHostForPackage,
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
import { initSounds, setSoundsEnabled, soundsEnabled } from "./sounds";
import { SEEDS, THEMES, themeCss } from "./themes";
import { mountWallpaper } from "./wallpaper";
import { WindowManager, type Layout } from "./wm";

interface Builtin {
  id: string;
  name: string;
  icon: string;
  desc: string;
  group: "core" | "advanced";
  width?: number;
  height?: number;
  /** Small tools float above tiled layouts. */
  float?: boolean;
  mount(root: HTMLElement): void;
}

const desk = h("main", { class: "desk" });
const wm = new WindowManager(desk, { defaultLayout: "dwindle" });
const craftHosts = new Map<string, CraftHost>();
const dock = h("nav", { class: "dock", "aria-label": "Dock" });
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
    desc: "Theme, colour, sounds and appearance",
    group: "core",
    width: 720,
    height: 620,
    float: true,
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
        storeApp(root, (kind, target) => {
          if (kind === "app") {
            const builtin = builtins.find((entry) => entry.id === target);
            if (builtin) launchBuiltin(builtin);
            return;
          }
          void window.open(
            target.startsWith("http")
              ? target
              : `https://github.com/aphrody-labs/bun-os/tree/os/apps/${target}`,
            "_blank",
            "noopener",
          );
        }),
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
    float: true,
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
    float: true,
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
    float: true,
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
    float: b.float,
    content,
  });
  if (!content.hasChildNodes()) b.mount(content);
}

// Installed packages (from the package manager) behave like any other app.
let registryEntries: RegistryEntry[] = [];
const installedEntries = () => registryEntries.filter((e) => installed()[e.id]);
interface PackageWindowOptions {
  id?: string;
  title?: string;
  documentPath?: string;
}
function launchPackage(
  e: RegistryEntry,
  options: PackageWindowOptions = {},
): CraftHost | undefined {
  const windowId = options.id ?? `pkg:${e.id}`;
  const title = options.title ?? e.name;
  const existing = wm.windows.get(windowId);
  if (existing) {
    wm.restore(existing);
    return craftHosts.get(windowId);
  }
  const content = h("div", { class: "fill" });
  let craftHost: CraftHost | undefined;
  wm.open({
    id: windowId,
    title,
    icon: e.category === "games" ? "game" : "app",
    width: 960,
    height: 640,
    content,
    onClose: () => {
      craftHost?.dispose();
      if (craftHosts.get(windowId) === craftHost) craftHosts.delete(windowId);
    },
  });
  if (!content.hasChildNodes()) {
    const hostId = craftHostForPackage(e.id);
    const frame = h("iframe", {
      class: "appframe",
      src: `/apps/${e.id}/${hostId ? "?host=parent" : ""}`,
      title: e.name,
      allow:
        "fullscreen; gamepad; autoplay; clipboard-read; clipboard-write; cross-origin-isolated",
    }) as HTMLIFrameElement;
    frame.title = title;
    if (hostId) {
      craftHost = attachCraftHost(frame, hostId, (name, bytes) =>
        saveCraftFile(hostId, name, bytes, options.documentPath),
      );
      craftHosts.set(windowId, craftHost);
    }
    content.append(frame);
  }
  return craftHost;
}

function openCraftFile(
  id: CraftHostId,
  path: string,
  name: string,
  bytes: Uint8Array,
): boolean {
  const packageId = `craft-${id}`;
  const entry = installedEntries().find((item) => item.id === packageId);
  if (!entry) {
    launchBuiltin(builtins.find((item) => item.id === "apps")!);
    return false;
  }
  const documentPath = path.replaceAll("\\", "/");
  const windowId = `craft-doc:${id}:${encodeURIComponent(documentPath)}`;
  const host = launchPackage(entry, {
    id: windowId,
    title: `${name} · ${entry.name}`,
    documentPath,
  });
  return host?.open(name, bytes) ?? false;
}

async function saveCraftFile(
  id: CraftHostId,
  name: string,
  bytes: Uint8Array,
  documentPath?: string,
) {
  const os = await webos();
  const root = `${HOME}/Projects/Craft`;
  const normalizedPath = documentPath?.replaceAll("\\", "/");
  const lastSlash = normalizedPath?.lastIndexOf("/") ?? -1;
  const originalName =
    lastSlash >= 0 ? normalizedPath!.slice(lastSlash + 1) : undefined;
  const directory =
    normalizedPath && lastSlash >= 0
      ? normalizedPath.slice(0, lastSlash) || "/"
      : `${root}/${id}`;
  const savePath =
    normalizedPath && name === originalName
      ? normalizedPath
      : `${directory}/${name}`;
  if (!normalizedPath) {
    try {
      os.fs.stat(root);
    } catch {
      os.fs.mkdir(root);
    }
  }
  try {
    os.fs.stat(directory);
  } catch {
    os.fs.mkdir(directory);
  }
  os.fs.write(savePath, bytes);
  await os.flush();
}
function refreshApps() {
  renderDock();
  renderHome();
  if (launcher.open) renderLauncher();
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

// Appearance --------------------------------------------------------------------------------------
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const narrow = matchMedia("(max-width: 599px)");
let repaintWallpaper: () => void = () => {};

const currentTheme = () =>
  localStorage.getItem("aph.theme") ??
  (localStorage.getItem("aph.seed") ? "seed" : "aphrody");
const currentMode = () => localStorage.getItem("aph.mode") ?? "auto";

function applyPrefs(animate = false) {
  const run = () => {
    const mode = currentMode();
    if (mode === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.dataset.theme = mode;
    const style =
      document.getElementById("seed-css") ??
      document.head.appendChild(h("style", { id: "seed-css" }));
    const theme = currentTheme();
    style.textContent = themeCss(
      theme,
      localStorage.getItem("aph.seed") ?? undefined,
    );
    // src/boot.ts replays this before first paint on the next visit.
    try {
      if (theme === "aphrody") localStorage.removeItem("aph.themecss");
      else localStorage.setItem("aph.themecss", style.textContent);
    } catch {}
    repaintWallpaper();
    for (const fn of prefListeners) fn();
  };
  if (animate && document.startViewTransition && !reduceMotion.matches)
    document.startViewTransition(run);
  else run();
}
const prefListeners = new Set<() => void>();
function setPref(key: string, value: string | null) {
  if (value === null) localStorage.removeItem(key);
  else localStorage.setItem(key, value);
  applyPrefs(true);
}

/** Material Symbols ligature by glyph name. */
function sym(glyph: string) {
  const s = h("span", {
    class: "mi material-symbols-rounded",
    "aria-hidden": "true",
  });
  s.textContent = glyph;
  return s;
}

/** App icon tile, tinted by a role family so the grid reads by kind at a glance. */
const TONES: Record<string, string> = {
  files: "primary",
  drive: "primary",
  storage: "primary",
  "aphrody-workspace": "primary",
  browser: "secondary",
  webapps: "secondary",
  docs: "secondary",
  apps: "tertiary",
  creative: "tertiary",
  media: "tertiary",
};
function toneOf(id: string) {
  if (TONES[id]) return TONES[id]!;
  if (id.startsWith("pkg:") || id.startsWith("web:")) return "tertiary";
  return "neutral";
}
function appIcon(id: string, ic: string) {
  return h(
    "span",
    { class: `appicon tone-${toneOf(id)}`, "aria-hidden": "true" },
    icon(ic),
  );
}

function themeSwatch(
  theme: (typeof THEMES)[number],
  onPick: () => void,
  size = "",
) {
  const [bg, surface, a, b] = theme.preview;
  return h("button", {
    class: `theme-dot ${size}`.trim(),
    "aria-label": `${theme.name} theme`,
    "aria-pressed": String(currentTheme() === theme.id),
    "data-tip": theme.name,
    style: `--a:${a};--b:${b};--bg:${bg};--s:${surface}`,
    onclick: onPick,
  });
}

function settingsApp(root: HTMLElement) {
  const view = h("div", { class: "settings" });
  const render = () => {
    const theme = currentTheme();
    const mode = currentMode();
    view.replaceChildren(
      h("h2", {}, "Appearance"),
      h(
        "p",
        { class: "muted" },
        "Themes recolour every window, the bar, the dock and the wallpaper.",
      ),
      h(
        "div",
        { class: "theme-cards", role: "radiogroup", "aria-label": "Theme" },
        ...THEMES.map((t) => {
          const [bg, surface, a, b] = t.preview;
          return h(
            "button",
            {
              class: "theme-card",
              role: "radio",
              "aria-checked": String(theme === t.id),
              onclick: () => setPref("aph.theme", t.id),
            },
            h(
              "span",
              {
                class: "theme-preview",
                style: `--a:${a};--b:${b};--bg:${bg};--s:${surface}`,
                "aria-hidden": "true",
              },
              h("span", { class: "tp-bar" }),
              h("span", { class: "tp-win" }),
              h("span", { class: "tp-win two" }),
            ),
            h("span", { class: "theme-name" }, t.name),
            h("span", { class: "theme-mood" }, t.mood),
          );
        }),
      ),
      h("h3", {}, "Mode"),
      h(
        "div",
        { class: "seg", role: "radiogroup", "aria-label": "Mode" },
        ...(
          [
            ["auto", "Automatic", "brightness_auto"],
            ["light", "Light", "light_mode"],
            ["dark", "Dark", "dark_mode"],
          ] as const
        ).map(([m, label, glyph]) =>
          h(
            "button",
            {
              class: "segb",
              role: "radio",
              "aria-checked": String(mode === m),
              "aria-selected": String(mode === m),
              onclick: () => setPref("aph.mode", m === "auto" ? null : m),
            },
            sym(glyph),
            label,
          ),
        ),
      ),
      h("h3", {}, "Your colour"),
      h(
        "p",
        { class: "muted" },
        "Build a Material You scheme from one colour instead of a theme.",
      ),
      h(
        "div",
        { class: "swatches" },
        ...SEEDS.map(([name, hex]) =>
          h("button", {
            class: "swatch",
            "aria-label": name,
            "data-tip": name,
            "aria-pressed": String(
              theme === "seed" && localStorage.getItem("aph.seed") === hex,
            ),
            style: `background:${hex}`,
            onclick: () => {
              localStorage.setItem("aph.seed", hex);
              setPref("aph.theme", "seed");
            },
          }),
        ),
      ),
      h("h3", {}, "Sounds"),
      h(
        "button",
        {
          class: "switch-row",
          role: "switch",
          "aria-checked": String(soundsEnabled()),
          onclick: () => {
            setSoundsEnabled(!soundsEnabled());
            render();
            renderStatus();
          },
        },
        h(
          "span",
          {},
          h("strong", {}, "System sounds"),
          h(
            "span",
            { class: "muted" },
            "A soft cue when windows open and close",
          ),
        ),
        h("span", { class: "switch", "aria-hidden": "true" }),
      ),
      h(
        "div",
        { class: "row" },
        h(
          "button",
          {
            class: "btn tonal",
            onclick: () => {
              localStorage.removeItem("aph.seed");
              localStorage.removeItem("aph.mode");
              setPref("aph.theme", null);
            },
          },
          "Restore defaults",
        ),
      ),
    );
  };
  prefListeners.add(() => {
    if (view.isConnected) render();
  });
  render();
  root.append(view);
}

// Launcher: search-first, fuzzy, keyboard driven ---------------------------------------------------
interface LaunchItem {
  id: string;
  name: string;
  icon: string;
  desc: string;
  section: string;
  run(): void;
}
const launcher = h("dialog", {
  class: "launcher",
  closedby: "any",
  "aria-label": "Applications",
}) as HTMLDialogElement;
let launcherOpener: HTMLElement | null = null;
const lsearch = h("input", {
  class: "lsearch",
  type: "search",
  placeholder: "Search apps, tools and the web",
  "aria-label": "Search apps",
  autocomplete: "off",
  spellcheck: "false",
});
const lgrid = h("div", { class: "lgrid" });
launcher.append(
  h(
    "div",
    { class: "lbox" },
    h(
      "label",
      { class: "lsearch-wrap" },
      sym("search"),
      lsearch,
      h("kbd", { class: "lkbd" }, "Esc"),
    ),
    lgrid,
  ),
);
// Light dismiss where closedby is not supported yet.
if (!("closedBy" in HTMLDialogElement.prototype))
  launcher.addEventListener("click", (e) => {
    if (e.target === launcher) launcher.close();
  });

function launchItems(): LaunchItem[] {
  return [
    ...builtins.map((b) => ({
      id: b.id,
      name: b.name,
      icon: b.icon,
      desc: b.desc,
      section: b.group === "core" ? "Apps" : "Tools",
      run: () => launchBuiltin(b),
    })),
    ...installedEntries().map((e) => ({
      id: `pkg:${e.id}`,
      name: e.name,
      icon: e.category === "games" ? "game" : "app",
      desc: e.description,
      section: "Installed",
      run: () => void launchPackage(e),
    })),
    ...webApps().map((a) => ({
      id: `web:${a.url}`,
      name: a.name,
      icon: "globe",
      desc: new URL(a.url).hostname,
      section: "Web apps",
      run: () => openWebApp(a),
    })),
  ];
}

/** Fuzzy score: prefix beats word start beats substring beats an in-order subsequence; -1 is no match. */
function fuzzy(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.startsWith(q)) return 120 - t.length * 0.1;
  const at = t.indexOf(q);
  if (at >= 0) return (/[\s\-_.]/.test(t[at - 1] ?? "") ? 90 : 70) - at * 0.1;
  let score = 0;
  let from = 0;
  let last = -2;
  for (const ch of q) {
    if (ch === " ") continue;
    const pos = t.indexOf(ch, from);
    if (pos < 0) return -1;
    score += pos === last + 1 ? 4 : 1;
    if (pos === 0 || /[\s\-_.]/.test(t[pos - 1]!)) score += 3;
    last = pos;
    from = pos + 1;
  }
  return score;
}

function launchTile(item: LaunchItem) {
  return h(
    "button",
    {
      class: "ltile",
      title: item.desc,
      onclick: () => {
        launcher.close();
        item.run();
      },
    },
    appIcon(item.id, item.icon),
    h("span", { class: "lname" }, item.name),
  );
}

function renderLauncher() {
  const raw = lsearch.value.trim();
  const items = launchItems();
  const section = (title: string, tiles: HTMLElement[]) =>
    tiles.length
      ? [
          h("h3", { class: "lhead" }, title),
          h("div", { class: "lsection" }, ...tiles),
        ]
      : [];
  if (!raw) {
    const order = ["Apps", "Installed", "Web apps", "Tools"];
    lgrid.replaceChildren(
      ...order.flatMap((name) =>
        section(name, items.filter((i) => i.section === name).map(launchTile)),
      ),
    );
    return;
  }
  const ranked = items
    .map((item) => ({
      item,
      score: Math.max(
        fuzzy(raw, item.name),
        item.desc.toLowerCase().includes(raw.toLowerCase()) ? 30 : -1,
      ),
    }))
    .filter((r) => r.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((r) => launchTile(r.item));
  const web = h(
    "button",
    {
      class: "lweb",
      onclick: () => {
        launcher.close();
        const content = h("div", { class: "fill" });
        wm.open({
          title: "Browser",
          icon: "globe",
          width: 1000,
          height: 640,
          content,
        });
        browserApp(content, raw);
      },
    },
    sym("travel_explore"),
    h("span", {}, "Search the web for ", h("strong", {}, raw)),
  );
  lgrid.replaceChildren(
    ...(ranked.length
      ? section("Best matches", ranked)
      : [h("p", { class: "lempty" }, `No app is called “${raw}”.`)]),
    h("div", { class: "lwebrow" }, web),
  );
  ranked[0]?.classList.add("first");
}
function openLauncher(query = "") {
  if (!launcher.open) {
    launcherOpener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    launcher.showModal();
  }
  lsearch.value = query;
  renderLauncher();
  lsearch.focus();
}
function closeLauncher() {
  if (launcher.open) launcher.close();
}
function toggleLauncher() {
  if (launcher.open) closeLauncher();
  else openLauncher();
}
launcher.addEventListener("close", () => {
  if (launcherOpener?.isConnected) launcherOpener.focus();
  launcherOpener = null;
});
lsearch.addEventListener("input", renderLauncher);

/** Spatial arrow-key movement across the tiles of the launcher grid. */
function moveInGrid(from: HTMLElement, key: string) {
  const tiles = [...lgrid.querySelectorAll<HTMLElement>(".ltile, .lweb")];
  const i = tiles.indexOf(from);
  if (key === "ArrowRight") return tiles[i + 1]?.focus();
  if (key === "ArrowLeft")
    return i === 0 ? lsearch.focus() : tiles[i - 1]?.focus();
  const r = from.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  let best: HTMLElement | undefined;
  let bestScore = Infinity;
  for (const t of tiles) {
    if (t === from) continue;
    const b = t.getBoundingClientRect();
    const dy = key === "ArrowDown" ? b.top - r.bottom : r.top - b.bottom;
    if (dy < -2) continue;
    const score = dy * 4 + Math.abs(b.left + b.width / 2 - cx);
    if (score < bestScore) {
      bestScore = score;
      best = t;
    }
  }
  if (best) best.focus();
  else if (key === "ArrowUp") lsearch.focus();
}
launcher.addEventListener("keydown", (e) => {
  const active = document.activeElement as HTMLElement | null;
  if (active === lsearch) {
    if (e.key === "Enter") {
      e.preventDefault();
      lgrid.querySelector<HTMLElement>(".ltile, .lweb")?.click();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      lgrid.querySelector<HTMLElement>(".ltile, .lweb")?.focus();
    }
    return;
  }
  if (active && lgrid.contains(active)) {
    if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      moveInGrid(active, e.key);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Typing anywhere in the grid keeps searching.
      lsearch.focus();
    }
  }
});
window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    toggleLauncher();
  }
});

// Dock ---------------------------------------------------------------------------------------------
const PINNED = ["files", "browser", "terminal", "apps", "creative", "docs"];
function dockButton(
  id: string,
  label: string,
  ic: string,
  onclick: () => void,
) {
  const w = wm.windows.get(id);
  const state = w
    ? wm.activeId() === id
      ? " running current"
      : " running"
    : "";
  return h(
    "button",
    {
      class: `dbtn${state}`,
      "aria-label": w ? `${label}, open` : label,
      "data-tip": label,
      onclick,
    },
    appIcon(id, ic),
  );
}
function renderDock() {
  const toggle = (id: string) => {
    const w = wm.windows.get(id)!;
    if (w.minimized || wm.activeId() !== id) wm.restore(w);
    else wm.minimize(w);
  };
  const items: HTMLElement[] = [
    h(
      "button",
      {
        class: "dbtn launch",
        "aria-label": "Show all apps",
        "data-tip": "All apps",
        onclick: () => toggleLauncher(),
      },
      h("span", { class: "appicon" }, icon("grid")),
    ),
    h("span", { class: "dsep", "aria-hidden": "true" }),
  ];
  const seen = new Set<string>();
  for (const id of PINNED) {
    const b = builtins.find((entry) => entry.id === id)!;
    seen.add(id);
    items.push(
      dockButton(id, b.name, b.icon, () =>
        wm.windows.get(id) ? toggle(id) : launchBuiltin(b),
      ),
    );
  }
  const extra: HTMLElement[] = [];
  for (const e of installedEntries()) {
    const id = `pkg:${e.id}`;
    if (!wm.windows.get(id)) continue;
    seen.add(id);
    extra.push(
      dockButton(id, e.name, e.category === "games" ? "game" : "app", () =>
        toggle(id),
      ),
    );
  }
  for (const [id, w] of wm.windows) {
    if (seen.has(id)) continue;
    extra.push(dockButton(id, w.title, w.iconName, () => toggle(id)));
  }
  if (extra.length)
    items.push(h("span", { class: "dsep", "aria-hidden": "true" }), ...extra);
  dock.replaceChildren(...items);
}
wm.onChange(renderDock);

// Mobile home: on narrow screens the launcher grid is the desktop --------------------------------
const home = h("section", { class: "home", "aria-label": "Home" });
function renderHome() {
  const now = new Date();
  home.replaceChildren(
    h(
      "div",
      { class: "home-head" },
      h(
        "div",
        { class: "home-time" },
        now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      ),
      h(
        "div",
        { class: "home-date" },
        now.toLocaleDateString([], {
          weekday: "long",
          day: "numeric",
          month: "long",
        }),
      ),
    ),
    h(
      "button",
      { class: "home-search", onclick: () => openLauncher() },
      sym("search"),
      "Search apps and the web",
    ),
    h(
      "div",
      { class: "home-grid" },
      ...launchItems()
        .filter((i) => i.section !== "Tools" && i.id !== "about")
        .map((item) =>
          h(
            "button",
            { class: "ltile", onclick: () => item.run() },
            appIcon(item.id, item.icon),
            h("span", { class: "lname" }, item.name),
          ),
        ),
    ),
  );
}
desk.append(home);

// Welcome card: first visit only, centred, dismissible ----------------------------------------------
function showWelcome() {
  if (localStorage.getItem("aph.welcome") === "done" || narrow.matches) return;
  const card = h("section", {
    class: "welcome",
    role: "dialog",
    "aria-labelledby": "welcome-title",
    tabindex: -1,
  });
  const dismiss = () => {
    localStorage.setItem("aph.welcome", "done");
    card.classList.add("leaving");
    const done = () => card.remove();
    if (reduceMotion.matches) done();
    else card.addEventListener("animationend", done, { once: true });
  };
  const quick = ["files", "browser", "terminal", "apps", "creative", "docs"];
  const swatches = h("div", { class: "welcome-themes" });
  const paintSwatches = () =>
    swatches.replaceChildren(
      ...THEMES.map((t) => themeSwatch(t, () => setPref("aph.theme", t.id))),
    );
  prefListeners.add(() => {
    if (card.isConnected) paintSwatches();
  });
  paintSwatches();
  const kbd = (keys: string[], label: string) =>
    h(
      "span",
      { class: "hint" },
      ...keys.map((k) => h("kbd", {}, k)),
      h("span", {}, label),
    );
  card.append(
    h(
      "div",
      { class: "welcome-top" },
      h("img", {
        src: "/brand/64.png",
        alt: "",
        width: 44,
        height: 44,
        class: "welcome-logo",
      }),
      h(
        "button",
        {
          class: "tbtn",
          "aria-label": "Close welcome",
          onclick: dismiss,
        },
        icon("close"),
      ),
    ),
    h("h1", { id: "welcome-title" }, "Welcome to Bun OS"),
    h(
      "p",
      { class: "welcome-lede" },
      "A tiling desktop in your browser. Apps open side by side, and your files stay on this device.",
    ),
    h(
      "button",
      {
        class: "welcome-search",
        onclick: () => {
          dismiss();
          openLauncher();
        },
      },
      sym("search"),
      h("span", {}, "Search apps and the web"),
      h("kbd", {}, "Alt"),
      h("kbd", {}, "Space"),
    ),
    h(
      "div",
      { class: "welcome-apps" },
      ...quick.map((id) => {
        const b = builtins.find((entry) => entry.id === id)!;
        return h(
          "button",
          {
            class: "ltile",
            onclick: () => {
              dismiss();
              launchBuiltin(b);
            },
          },
          appIcon(b.id, b.icon),
          h("span", { class: "lname" }, b.name),
        );
      }),
    ),
    h(
      "div",
      { class: "welcome-row" },
      h("span", { class: "welcome-label" }, "Pick a look"),
      swatches,
    ),
    h(
      "div",
      { class: "welcome-foot" },
      h(
        "div",
        { class: "hints" },
        kbd(["Alt", "Enter"], "Terminal"),
        kbd(["Alt", "1–5"], "Workspaces"),
        kbd(["Alt", "/"], "All shortcuts"),
      ),
      h("button", { class: "btn", onclick: dismiss }, "Start"),
    ),
  );
  card.addEventListener("keydown", (e) => {
    if (e.key === "Escape") dismiss();
  });
  desk.append(card);
  queueMicrotask(() => card.focus({ preventScroll: true }));
}

// Top bar: workspaces left, clock centre, status right (waybar layout) ------------------------------
const wsBar = h("nav", { class: "wsbar", "aria-label": "Workspaces" });
const activeApp = h("span", { class: "active-app", "aria-live": "polite" });
const timeEl = h("time", { class: "bar-time" });
const dateEl = h("span", { class: "bar-date" });
const LAYOUT_GLYPH: Record<Layout, string> = {
  dwindle: "dashboard",
  scrolling: "view_column",
  floating: "filter_none",
};
const LAYOUT_NAME: Record<Layout, string> = {
  dwindle: "Tiled",
  scrolling: "Scrolling columns",
  floating: "Floating",
};
const layoutBtn = h("button", {
  class: "tbtn",
  onclick: () => wm.cycleLayout(),
});
const netIcon = sym("wifi");
const volIcon = sym("volume_up");
const batIcon = sym("battery_full");
batIcon.hidden = true;
const statusBtn = h(
  "button",
  {
    class: "status",
    popovertarget: "quick",
    "aria-label": "Quick settings",
    "data-tip": "Quick settings",
  },
  netIcon,
  volIcon,
  batIcon,
);
const quick = h("div", {
  id: "quick",
  class: "quick",
  popover: "auto",
  role: "dialog",
  "aria-label": "Quick settings",
});

interface BatteryLike extends EventTarget {
  level: number;
  charging: boolean;
}
let battery: BatteryLike | undefined;
const batteryGlyph = (b: BatteryLike) =>
  b.charging
    ? "battery_charging_full"
    : b.level > 0.9
      ? "battery_full"
      : b.level > 0.6
        ? "battery_5_bar"
        : b.level > 0.3
          ? "battery_3_bar"
          : "battery_1_bar";

function renderStatus() {
  netIcon.textContent = navigator.onLine ? "wifi" : "wifi_off";
  volIcon.textContent = soundsEnabled() ? "volume_up" : "volume_off";
  if (battery) {
    batIcon.hidden = false;
    batIcon.textContent = batteryGlyph(battery);
  }
  statusBtn.setAttribute(
    "aria-label",
    `Quick settings. ${navigator.onLine ? "Online" : "Offline"}, sounds ${soundsEnabled() ? "on" : "off"}${battery ? `, battery ${Math.round(battery.level * 100)}%` : ""}`,
  );
}
addEventListener("online", renderStatus);
addEventListener("offline", renderStatus);
(navigator as Navigator & { getBattery?: () => Promise<BatteryLike> })
  .getBattery?.()
  .then((b) => {
    battery = b;
    b.addEventListener("levelchange", renderStatus);
    b.addEventListener("chargingchange", renderStatus);
    renderStatus();
  })
  .catch(() => {});

function renderQuick() {
  const mode = currentMode();
  const tile = (
    glyph: string,
    title: string,
    sub: string,
    on: boolean,
    onclick?: () => void,
  ) =>
    h(
      onclick ? "button" : "div",
      {
        class: `qtile${on ? " on" : ""}`,
        ...(onclick
          ? { onclick, role: "switch", "aria-checked": String(on) }
          : {}),
      },
      sym(glyph),
      h("span", {}, h("strong", {}, title), h("span", { class: "qsub" }, sub)),
    );
  const storage = h("div", { class: "qstorage" });
  void navigator.storage?.estimate?.().then(({ usage = 0, quota = 0 }) => {
    if (!quota) return;
    const mb = (n: number) =>
      n > 1e9
        ? `${(n / 1e9).toFixed(1)} GB`
        : `${Math.max(1, Math.round(n / 1e6))} MB`;
    storage.replaceChildren(
      h(
        "div",
        { class: "qstorage-label" },
        sym("hard_drive"),
        h("span", {}, `${mb(usage)} of ${mb(quota)} used on this device`),
      ),
      h("progress", { max: quota, value: usage, "aria-label": "Storage used" }),
    );
  });
  quick.replaceChildren(
    h(
      "div",
      { class: "qhead" },
      h(
        "div",
        {},
        h(
          "strong",
          {},
          new Date().toLocaleDateString([], {
            weekday: "long",
            day: "numeric",
            month: "long",
          }),
        ),
        battery
          ? h(
              "span",
              { class: "qsub" },
              `Battery ${Math.round(battery.level * 100)}%${battery.charging ? ", charging" : ""}`,
            )
          : null,
      ),
      h(
        "button",
        {
          class: "tbtn",
          "aria-label": "All settings",
          "data-tip": "All settings",
          onclick: () => {
            quick.hidePopover();
            launchBuiltin(builtins.find((b) => b.id === "settings")!);
          },
        },
        icon("gear"),
      ),
    ),
    h(
      "div",
      { class: "qgrid" },
      tile(
        navigator.onLine ? "wifi" : "wifi_off",
        "Network",
        navigator.onLine ? "Online" : "Offline, apps keep working",
        navigator.onLine,
      ),
      tile(
        soundsEnabled() ? "volume_up" : "volume_off",
        "Sounds",
        soundsEnabled() ? "On" : "Off",
        soundsEnabled(),
        () => {
          setSoundsEnabled(!soundsEnabled());
          renderStatus();
          renderQuick();
        },
      ),
      tile(
        mode === "dark"
          ? "dark_mode"
          : mode === "light"
            ? "light_mode"
            : "brightness_auto",
        "Appearance",
        mode === "auto" ? "Automatic" : mode === "dark" ? "Dark" : "Light",
        mode !== "light",
        () => {
          const next =
            mode === "auto" ? "dark" : mode === "dark" ? "light" : null;
          setPref("aph.mode", next);
        },
      ),
      tile(
        LAYOUT_GLYPH[wm.layout()],
        "Tiling",
        LAYOUT_NAME[wm.layout()],
        wm.layout() !== "floating",
        () => wm.toggleTiled(),
      ),
    ),
    h(
      "div",
      { class: "qthemes" },
      ...THEMES.map((t) =>
        themeSwatch(t, () => setPref("aph.theme", t.id), "lg"),
      ),
    ),
    storage,
  );
}
quick.addEventListener("beforetoggle", (e) => {
  if ((e as ToggleEvent).newState === "open") renderQuick();
});
prefListeners.add(() => {
  if (quick.matches(":popover-open")) renderQuick();
});
wm.onChange(() => {
  if (quick.matches(":popover-open")) renderQuick();
});

function tick() {
  const d = new Date();
  timeEl.textContent = d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  timeEl.dateTime = d.toISOString();
  dateEl.textContent = d.toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  if (narrow.matches) renderHome();
}

function renderBar() {
  const active = wm.active();
  activeApp.replaceChildren(
    ...(active
      ? [icon(active.iconName), h("span", {}, active.title)]
      : [h("span", {}, "Desktop")]),
  );
  activeApp.classList.toggle("idle", !active);
  const occupied = wm.occupied();
  const shown = Math.max(5, wm.workspace, ...occupied);
  wsBar.replaceChildren(
    ...Array.from({ length: shown }, (_, i) => {
      const n = i + 1;
      const label = String(n === 10 ? 0 : n);
      return h(
        "button",
        {
          class: `ws${wm.workspace === n ? " cur" : ""}${occupied.has(n) ? " occ" : ""}`,
          "aria-label": `Workspace ${label}${occupied.has(n) ? ", has windows" : ""}`,
          "aria-current": wm.workspace === n ? "true" : undefined,
          "data-tip": `Workspace ${label}`,
          onclick: () => wm.goTo(n),
        },
        h("span", { class: "ws-mark" }, wm.workspace === n ? label : ""),
      );
    }),
  );
  const layout = wm.layout();
  layoutBtn.replaceChildren(sym(LAYOUT_GLYPH[layout]));
  layoutBtn.setAttribute(
    "aria-label",
    `Layout: ${LAYOUT_NAME[layout]}. Change layout`,
  );
  layoutBtn.dataset.tip = `${LAYOUT_NAME[layout]} (Alt+L)`;
}
wm.onChange(renderBar);

bar.append(
  h(
    "div",
    { class: "bar-left" },
    h(
      "button",
      {
        class: "brand",
        onclick: () => toggleLauncher(),
        "aria-label": "Show all apps",
        "data-tip": "All apps (Alt+Space)",
      },
      h("img", { src: "/brand/64.png", alt: "", width: 22, height: 22 }),
    ),
    wsBar,
    activeApp,
  ),
  h(
    "button",
    {
      class: "bar-clock",
      popovertarget: "quick",
      title: "Date and quick settings",
    },
    timeEl,
    dateEl,
  ),
  h(
    "div",
    { class: "bar-right" },
    layoutBtn,
    h(
      "button",
      {
        class: "tbtn",
        "aria-label": "Search",
        "data-tip": "Search (Ctrl+K)",
        onclick: () => openLauncher(),
      },
      icon("search"),
    ),
    statusBtn,
    h(
      "button",
      {
        class: "tbtn",
        "aria-label": "Open settings",
        "data-tip": "Settings",
        onclick: () =>
          launchBuiltin(builtins.find((b) => b.id === "settings")!),
      },
      icon("gear"),
    ),
  ),
);

// Boot ---------------------------------------------------------------------------------------------
desk.id = "desk";
desk.tabIndex = -1;
document.body.append(
  h("a", { class: "skip", href: "#desk" }, "Skip to desktop"),
  bar,
  desk,
  dock,
  launcher,
  quick,
);
repaintWallpaper = mountWallpaper();
applyPrefs();
tick();
setInterval(tick, 15_000);
refreshApps();
renderBar();
renderStatus();
initSounds();
installKeys(wm, {
  launcher: toggleLauncher,
  launch: (id) => launchBuiltin(builtins.find((b) => b.id === id)!),
  help: () => launchBuiltin(builtins.find((b) => b.id === "keys")!),
  webHotkey: (code) => {
    const app = webApps().find((a) => a.key === code);
    if (app) openWebApp(app);
    return !!app;
  },
});

void registerServiceWorker();
// /?app=<package> (legacy) or a catalog path such as /pdf both select the package to open.
const wanted =
  new URLSearchParams(location.search).get("app") ??
  (routeCatalog.apps as Record<string, string>)[
    location.pathname.replace(/\/+$/, "")
  ] ??
  null;
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

// A requested app opens directly; a plain visit lands on a calm desktop (welcome card on the first one).
const target = builtins.find((x) => x.id === wanted);
if (target) launchBuiltin(target);
else if (!wanted) showWelcome();
