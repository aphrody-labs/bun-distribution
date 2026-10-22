// Bun Engine frontend: systems -> games, launch routing, BIOS and installer screens. Navigable
// with the keyboard and any standard-mapping gamepad (spatial focus, A/B/X/Y, LB/RB, Start).

interface Route {
  id: string;
  kind: "native" | "bin" | "libretro";
  label: string;
  available: boolean;
  reason?: string;
  extensions?: string[];
}

interface SystemRow {
  id: string;
  name: string;
  manufacturer: string;
  year: number;
  extensions: string[];
  games: number;
  routes: Route[];
  defaultRoute: string | null;
}

interface Game {
  id: number;
  system: string;
  path: string;
  file: string;
  name: string;
  source: string;
  size: number;
  crc: string | null;
  md5: string | null;
  title: string | null;
  description: string | null;
  developer: string | null;
  year: string | null;
  region: string | null;
  dat: string | null;
  route: string | null;
  favorite: number;
  playCount: number;
  lastPlayed: string | null;
}

interface Job {
  id: number;
  title: string;
  status: "running" | "done" | "failed";
  result?: unknown;
  error?: string;
}

interface LaunchResult {
  ok: boolean;
  route: string;
  mode: string;
  pid?: number;
  exitCode?: number | null;
  alive?: boolean;
  ms: number;
  output?: string;
  error?: string;
  player?: string;
}

type Tab = "systems" | "games" | "bios" | "installer" | "sources";

const view = document.querySelector<HTMLElement>("#view")!;
const hints = document.querySelector<HTMLElement>("#hints")!;
const status = document.querySelector<HTMLElement>("#status")!;
const toastBox = document.querySelector<HTMLElement>("#toast")!;

const state: {
  tab: Tab;
  systems: SystemRow[];
  system?: SystemRow;
  games: Game[];
  game?: Game;
  lastSystem?: string;
  lastGame?: number;
  jobs: Job[];
  running: Array<{ pid: number; game: number; route: string }>;
} = { tab: "systems", systems: [], games: [], jobs: [], running: [] };

const h = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.json === undefined ? undefined : { "content-type": "application/json" },
    body: init?.json === undefined ? init?.body : JSON.stringify(init.json),
  });
  const value = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(value.error ?? response.statusText);
  return value;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(message: string, kind: "info" | "ok" | "error" = "info"): void {
  toastBox.textContent = message;
  toastBox.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastBox.className = "toast"), kind === "error" ? 7000 : 3500);
}

function setHints(items: Array<[string, string]>): void {
  hints.innerHTML = items.map(([key, label]) => `<span><kbd>${h(key)}</kbd>${h(label)}</span>`).join("");
}

const accents: Record<string, string> = {
  Nintendo: "#e4002b",
  Sony: "#3b6ef5",
  Sega: "#1c8cf0",
  Microsoft: "#16a34a",
  Various: "#a855f7",
  "Bun Engine": "#f5b300",
};

function routeChips(routes: Route[], defaultRoute: string | null): string {
  return routes
    .map(
      route =>
        `<span class="chip ${route.kind} ${route.available ? "on" : "off"}" title="${h(route.reason ?? "")}">${route.id === defaultRoute ? "★ " : ""}${h(route.label)}</span>`,
    )
    .join("");
}

function formatSize(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

// ---- screens ------------------------------------------------------------------------------------

async function showSystems(): Promise<void> {
  state.tab = "systems";
  state.systems = await api<SystemRow[]>("/api/systems");
  const total = state.systems.reduce((sum, system) => sum + system.games, 0);
  view.innerHTML = `
    <section class="systems-head">
      <h1>Systems</h1>
      <p>${total} games across ${state.systems.filter(s => s.games).length} systems · ${state.systems.length} systems defined</p>
      <button data-nav data-action="scan" class="ghost">Rescan library</button>
    </section>
    <section class="systems">
      ${state.systems
        .map(system => {
          const available = system.routes.filter(route => route.available);
          return `<button data-nav class="system ${system.games ? "" : "dim"}" data-system="${h(system.id)}" style="--accent:${accents[system.manufacturer] ?? "#64748b"}">
            <span class="maker">${h(system.manufacturer)} · ${system.year}</span>
            <span class="name">${h(system.name)}</span>
            <span class="count">${system.games} ${system.games === 1 ? "game" : "games"}</span>
            <span class="routes">${available.length ? routeChips(available.slice(0, 3), system.defaultRoute) : '<span class="chip off">no emulator installed</span>'}</span>
          </button>`;
        })
        .join("")}
    </section>`;
  setHints([
    ["←↑→↓", "Move"],
    ["A / Enter", "Open"],
    ["LB RB / Q E", "Tabs"],
    ["Y / R", "Rescan"],
  ]);
  markTab();
  focusFirst(state.lastSystem ? `[data-system="${CSS.escape(state.lastSystem)}"]` : ".system");
}

async function showGames(systemId: string): Promise<void> {
  state.tab = "games";
  state.lastSystem = systemId;
  const [systems, games] = await Promise.all([
    api<SystemRow[]>("/api/systems"),
    api<Game[]>(`/api/systems/${systemId}/games`),
  ]);
  state.systems = systems;
  state.system = systems.find(system => system.id === systemId)!;
  state.games = games;
  const system = state.system;
  view.innerHTML = `
    <section class="games-head" style="--accent:${accents[system.manufacturer] ?? "#64748b"}">
      <button data-nav data-action="back" class="ghost">‹ Systems</button>
      <h1>${h(system.name)}</h1>
      <span class="sub">${games.length} games · ${h(system.extensions.map(ext => `.${ext}`).join(" "))}</span>
    </section>
    <section class="games">
      <div class="list" id="list">
        ${
          games.length
            ? games
                .map(
                  game => `<button data-nav class="game" data-game="${game.id}">
                    <span class="fav">${game.favorite ? "★" : ""}</span>
                    <span class="title">${h(game.title ?? game.name)}</span>
                    <span class="meta">${game.dat ? "DB" : ""}${game.playCount ? ` · ${game.playCount}×` : ""}</span>
                  </button>`,
                )
                .join("")
            : `<div class="empty">No games yet. Add a folder under Sources, or install free ROMs with <code>bep roms</code>.</div>`
        }
      </div>
      <aside class="detail" id="detail"></aside>
    </section>`;
  setHints([
    ["↑↓", "Games"],
    ["→", "Routes"],
    ["A / Enter", "Launch"],
    ["Y / C", "Check"],
    ["X / F", "Favorite"],
    ["Start / D", "Set default"],
    ["B / Esc", "Back"],
  ]);
  markTab("systems");
  if (!games.length) {
    renderDetail(undefined);
    focusFirst("[data-action=back]");
    return;
  }
  const target =
    state.lastGame && games.some(game => game.id === state.lastGame) ? `[data-game="${state.lastGame}"]` : ".game";
  focusFirst(target);
}

function renderDetail(game: Game | undefined): void {
  const detail = document.querySelector<HTMLElement>("#detail");
  const system = state.system;
  if (!detail || !system) return;
  state.game = game;
  const routes = system.routes;
  if (!game) {
    detail.innerHTML = `<h2>Launch routes</h2><div class="route-list">${routes.map(route => routeButton(route, system.defaultRoute, undefined)).join("")}</div>`;
    return;
  }
  const running = state.running.find(item => item.game === game.id);
  detail.innerHTML = `
    <h2>${h(game.title ?? game.name)}</h2>
    <dl>
      ${game.title && game.title !== game.name ? `<dt>File name</dt><dd>${h(game.name)}</dd>` : ""}
      ${game.developer ? `<dt>Developer</dt><dd>${h(game.developer)}</dd>` : ""}
      ${game.year ? `<dt>Year</dt><dd>${h(game.year)}</dd>` : ""}
      ${game.region ? `<dt>Region</dt><dd>${h(game.region)}</dd>` : ""}
      <dt>Source</dt><dd>${h(game.source)}</dd>
      <dt>Path</dt><dd class="path">${h(game.file)}</dd>
      <dt>Size</dt><dd>${formatSize(game.size)}</dd>
      <dt>CRC32 / MD5</dt><dd class="mono">${h(game.crc ?? "–")} / ${h(game.md5 ?? "–")}</dd>
      <dt>Database</dt><dd>${
        game.dat
          ? h(
              game.dat
                .split("/")
                .slice(1)
                .join(" / ")
                .replace(/\.dat$/, ""),
            )
          : "no libretro-database match"
      }</dd>
      ${game.lastPlayed ? `<dt>Last played</dt><dd>${new Date(game.lastPlayed).toLocaleString()} (${game.playCount}×)</dd>` : ""}
    </dl>
    ${game.description ? `<p class="desc">${h(game.description)}</p>` : ""}
    <div class="actions">
      <button data-nav data-action="launch" class="primary">▶ Launch</button>
      <button data-nav data-action="check">Check route</button>
      <button data-nav data-action="favorite">${game.favorite ? "★ Unfavorite" : "☆ Favorite"}</button>
      ${running ? `<button data-nav data-action="stop" data-pid="${running.pid}" class="danger">■ Stop</button>` : ""}
    </div>
    <h3>Launch routes</h3>
    <div class="route-list">${routes.map(route => routeButton(route, system.defaultRoute, game)).join("")}</div>
    <pre class="log" id="log" hidden></pre>`;
}

function routeButton(route: Route, defaultRoute: string | null, game: Game | undefined): string {
  const ext = game?.path.split(".").pop()?.toLowerCase();
  const fits = !route.extensions || !ext || route.extensions.includes(ext);
  const usable = route.available && fits;
  const reason = !route.available
    ? route.reason
    : fits
      ? ""
      : `loads ${route.extensions!.map(e => `.${e}`).join(" ")} only`;
  return `<button data-nav class="route ${route.kind} ${usable ? "on" : "off"}" data-route="${h(route.id)}" aria-disabled="${!usable}">
    <span class="kind">${route.kind}</span>
    <span class="label">${route.id === defaultRoute ? "★ " : ""}${h(route.label)}${game?.route === route.id ? " (game)" : ""}</span>
    <span class="why">${h(reason ?? "")}</span>
  </button>`;
}

async function showBios(): Promise<void> {
  state.tab = "bios";
  const bios = await api<{
    native: Array<{
      system: string;
      machine: string;
      console: string;
      required: boolean;
      freeFirmware: string;
      license?: string;
      status: string;
      images: Array<{ sha256: string; bytes: number }>;
    }>;
    libretro: Array<{
      core: string;
      file: string;
      desc: string;
      optional: boolean;
      md5?: string;
      status: string;
    }>;
    freeFirmware: Array<{
      id: string;
      console: string;
      file: string;
      license: string;
    }>;
    store: Array<{
      console: string;
      sha256: string;
      bytes: number;
      file: string;
    }>;
  }>("/api/bios");
  const cores = new Map<string, typeof bios.libretro>();
  for (const row of bios.libretro) cores.set(row.core, [...(cores.get(row.core) ?? []), row]);
  view.innerHTML = `
    <section class="page">
      <h1>BIOS</h1>
      <p class="lead">Native machines boot open-source firmware from the bep store; RetroArch cores are checked by MD5 like Recalbox does. Proprietary dumps stay user-supplied (<code>bep add firmware &lt;console&gt; &lt;dump&gt;</code>).</p>
      <h2>Native machines</h2>
      <div class="cards">
        ${bios.native
          .map(
            row => `<div class="card">
              <div class="row"><strong>${h(row.system.toUpperCase())}</strong><span class="badge ${row.status}">${h(row.status)}</span></div>
              <div class="muted">${h(row.console)} · ${row.required ? "required" : "optional"}</div>
              ${row.images.map(image => `<div class="mono small">${image.sha256.slice(0, 16)}… ${formatSize(image.bytes)}</div>`).join("")}
              <button data-nav data-install="free-firmware" data-id="${h(row.freeFirmware)}">${row.images.length ? "Reinstall" : "Install"} ${h(row.freeFirmware)}</button>
              <div class="muted small">${h(row.license ?? "")}</div>
            </div>`,
          )
          .join("")}
      </div>
      <h2>Free firmware</h2>
      <table><tbody>
        ${bios.freeFirmware
          .map(
            fw => `<tr><td><strong>${h(fw.id)}</strong></td><td>${h(fw.console)}</td><td class="muted">${h(fw.license)}</td>
              <td><button data-nav data-install="free-firmware" data-id="${h(fw.id)}">Install</button></td></tr>`,
          )
          .join("")}
      </tbody></table>
      <h2>RetroArch cores</h2>
      ${
        cores.size
          ? [...cores]
              .map(
                ([core, rows]) =>
                  `<h3>${h(core)}</h3><table><tbody>${rows
                    .map(
                      row => `<tr><td class="mono">${h(row.file)}</td><td>${h(row.desc)}</td><td class="mono small">${h(row.md5 ?? "")}</td>
                      <td><span class="badge ${row.status}${row.optional ? " optional" : ""}">${h(row.status)}${row.optional ? " (optional)" : ""}</span></td></tr>`,
                    )
                    .join("")}</tbody></table>`,
              )
              .join("")
          : '<p class="muted">No installed core declares BIOS files.</p>'
      }
      <h2>Firmware store</h2>
      <table><tbody>${bios.store.map(image => `<tr><td>${h(image.console)}</td><td class="mono">${h(image.file)}</td><td>${formatSize(image.bytes)}</td></tr>`).join("")}</tbody></table>
    </section>`;
  setHints([
    ["←↑→↓", "Move"],
    ["A / Enter", "Install"],
    ["LB RB / Q E", "Tabs"],
  ]);
  markTab();
  focusFirst("[data-nav]:not(.tabs *)");
}

async function showInstaller(): Promise<void> {
  state.tab = "installer";
  const data = await api<{
    project: string;
    binaries: Array<{
      id: string;
      console: string;
      repo: string;
      systems: string[];
      installed: { version: string } | null;
    }>;
    libretro: Array<{
      id: string;
      name: string;
      systems: string[];
      license: string;
      installed: boolean;
    }>;
    mirrors: Array<{
      service: string;
      endpoints: number;
      healthy: number;
      best?: string;
      latencyMs?: number | null;
    }>;
  }>("/api/installer");
  view.innerHTML = `
    <section class="page">
      <h1>Installer</h1>
      <p class="lead">bep project <code>${h(data.project)}</code>. Release emulators install into <code>usr/lib</code> with launchers in <code>usr/bin</code>; libretro cores into <code>usr/lib/libretro</code>.</p>
      <div class="toolbar">
        <button data-nav data-install="install">bep install</button>
        <button data-nav data-install="update">bep update</button>
        <button data-nav data-install="mirrors-index">Index mirrors</button>
        <button data-nav data-install="mirrors-probe">Probe mirrors</button>
      </div>
      <h2>Release emulators</h2>
      <table><tbody>
        ${data.binaries
          .map(
            bin => `<tr><td><strong>${h(bin.id)}</strong><div class="muted small">${h(bin.repo)}</div></td>
              <td>${bin.systems.map(id => `<span class="chip">${h(id)}</span>`).join("")}</td>
              <td>${bin.installed ? `<span class="badge present">${h(bin.installed.version)}</span>` : '<span class="badge missing">not installed</span>'}</td>
              <td class="buttons"><button data-nav data-install="bin" data-id="${h(bin.id)}">${bin.installed ? "Reinstall" : "Install"}</button>
              <button data-nav data-install="update" data-id="${h(bin.id)}">Update</button>
              <button data-nav data-install="remove" data-id="${h(bin.id)}" class="danger">Remove</button></td></tr>`,
          )
          .join("")}
      </tbody></table>
      <h2>libretro cores</h2>
      <table><tbody>
        ${data.libretro
          .map(
            core => `<tr><td><strong>${h(core.id)}</strong><div class="muted small">${h(core.name)} · ${h(core.license)}</div></td>
              <td>${core.systems.map(id => `<span class="chip">${h(id)}</span>`).join("")}</td>
              <td>${core.installed ? '<span class="badge present">installed</span>' : '<span class="badge missing">not installed</span>'}</td>
              <td class="buttons"><button data-nav data-install="libretro" data-id="${h(core.id)}">${core.installed ? "Reinstall" : "Install"}</button>
              <button data-nav data-install="remove" data-id="${h(core.id)}" class="danger">Remove</button></td></tr>`,
          )
          .join("")}
      </tbody></table>
      <h2>Mirrors</h2>
      ${
        data.mirrors.length
          ? `<table><tbody>${data.mirrors
              .map(
                row => `<tr><td><strong>${h(row.service)}</strong></td><td>${row.healthy}/${row.endpoints} healthy</td>
                  <td class="mono small">${h(row.best ?? "")}</td><td>${row.latencyMs == null ? "" : `${row.latencyMs} ms`}</td></tr>`,
              )
              .join("")}</tbody></table>`
          : '<p class="muted">No mirror index yet: run Index mirrors.</p>'
      }
      <h2>Jobs</h2>
      <div id="jobs">${jobsHtml()}</div>
    </section>`;
  setHints([
    ["←↑→↓", "Move"],
    ["A / Enter", "Run"],
    ["LB RB / Q E", "Tabs"],
  ]);
  markTab();
  focusFirst(".toolbar [data-nav]");
}

function jobsHtml(): string {
  if (!state.jobs.length) return '<p class="muted">No jobs yet.</p>';
  return `<table><tbody>${state.jobs
    .map(
      job => `<tr><td>#${job.id}</td><td>${h(job.title)}</td><td><span class="badge ${job.status === "done" ? "present" : job.status === "failed" ? "missing" : "running"}">${job.status}</span></td>
        <td class="mono small">${h(job.error ?? (job.result === undefined ? "" : JSON.stringify(job.result).slice(0, 160)))}</td></tr>`,
    )
    .join("")}</tbody></table>`;
}

async function showSources(): Promise<void> {
  state.tab = "sources";
  const sources =
    await api<Array<{ id: number; kind: string; path: string; system: string | null }>>("/api/library/sources");
  if (!state.systems.length) state.systems = await api<SystemRow[]>("/api/systems");
  const describe = (source: { kind: string; path: string }) =>
    source.kind === "bep"
      ? "bep project (package.json bunEngine + bep.lock)"
      : source.kind === "store"
        ? "content-addressed ROM store"
        : source.kind === "free"
          ? "free ROM packs (bep roms)"
          : source.path;
  view.innerHTML = `
    <section class="page">
      <h1>Sources</h1>
      <p class="lead">Folders are scanned recursively. Without a system, files are assigned by a <code>&lt;system&gt;/</code> directory (Recalbox layout) or an unambiguous extension.</p>
      <table><tbody>
        ${sources
          .map(
            source => `<tr><td><span class="chip">${h(source.kind)}</span></td><td>${h(describe(source))}</td><td>${h(source.system ?? "")}</td>
              <td><button data-nav data-remove-source="${source.id}" class="danger">Remove</button></td></tr>`,
          )
          .join("")}
      </tbody></table>
      <h2>Add folder</h2>
      <form class="add" id="add">
        <input data-nav name="path" placeholder="C:\\Games\\roms" autocomplete="off" />
        <select data-nav name="system"><option value="">auto-detect</option>${state.systems.map(s => `<option value="${h(s.id)}">${h(s.name)}</option>`).join("")}</select>
        <button data-nav type="submit">Add</button>
      </form>
      <div class="toolbar"><button data-nav data-action="scan" class="primary">Rescan library</button></div>
    </section>`;
  setHints([
    ["↑↓", "Move"],
    ["A / Enter", "Select"],
    ["LB RB / Q E", "Tabs"],
  ]);
  markTab();
  focusFirst("[data-action=scan]");
}

// ---- actions ------------------------------------------------------------------------------------

function show(tab: Tab): Promise<void> {
  const screens: Record<Exclude<Tab, "games">, () => Promise<void>> = {
    systems: showSystems,
    bios: showBios,
    installer: showInstaller,
    sources: showSources,
  };
  return tab === "games" ? showGames(state.lastSystem ?? "nes") : screens[tab]();
}

function markTab(active: Tab = state.tab): void {
  for (const button of document.querySelectorAll<HTMLElement>("[data-tab]"))
    button.classList.toggle("active", button.dataset.tab === (active === "games" ? "systems" : active));
}

async function runJob(action: string, id?: string): Promise<void> {
  const job = await api<Job>(`/api/installer/${action}`, {
    method: "POST",
    json: { id },
  });
  toast(`Started: ${job.title}`);
  await pollJobs();
}

async function scan(): Promise<void> {
  await api<Job>("/api/library/scan", { method: "POST" });
  toast("Scanning library…");
  await pollJobs();
}

async function launch(check: boolean, route?: string): Promise<void> {
  const game = state.game;
  if (!game) return;
  toast(check ? `Checking ${route ?? "default route"}…` : `Launching ${game.title ?? game.name}…`);
  const result = await api<LaunchResult>(`/api/games/${game.id}/launch`, {
    method: "POST",
    json: { route, check },
  });
  const log = document.querySelector<HTMLElement>("#log");
  if (log) {
    log.hidden = false;
    log.textContent = [
      `${result.mode} ${result.route}: ${result.ok ? "ok" : "failed"} in ${result.ms} ms`,
      result.alive
        ? "GUI still running at the deadline (stopped)"
        : result.exitCode === undefined
          ? ""
          : `exit code ${result.exitCode}`,
      result.error ?? "",
      result.output ?? "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  toast(
    result.error ??
      `${result.route}: ${result.ok ? (check ? "check passed" : `started (pid ${result.pid})`) : "failed"}`,
    result.ok ? "ok" : "error",
  );
  if (!check) await pollRunning();
  if (!check && result.ok && result.player) await openPlayer(result.player, result.pid);
}

// A game RetroArch runs in process plays in this window, so one kiosk window (gamescope) holds both.
let player: { frame: HTMLIFrameElement; pid?: number; returnTo: HTMLElement | null } | undefined;

async function openPlayer(url: string, pid?: number): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await fetch(url, { mode: "no-cors" }).then(() => true, () => false)) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const frame = document.createElement("iframe");
  frame.src = url;
  frame.allow = "autoplay; gamepad";
  frame.className = "player";
  frame.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;border:0;background:#000;z-index:100";
  document.body.append(frame);
  player = { frame, pid, returnTo };
  frame.addEventListener("load", () => frame.focus());
}

async function closePlayer(): Promise<void> {
  if (!player) return;
  const { frame, pid, returnTo } = player;
  player = undefined;
  frame.remove();
  // the focused iframe took the focus with it: give it back so A / Enter work without a direction first
  if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
  else focusFirst(".system, .game, [data-nav]");
  if (pid !== undefined) await api(`/api/running/${pid}`, { method: "DELETE" }).catch(() => undefined);
  await pollRunning();
}

// Escape in the player, or the pad chord Select+Start, comes back to the library.
window.addEventListener("message", event => {
  if (event.data === "retroarch-exit") void closePlayer();
});

async function activate(element: HTMLElement): Promise<void> {
  const data = element.dataset;
  if (data.tab) return show(data.tab as Tab);
  if (data.system) return showGames(data.system);
  if (data.action === "back") return showSystems();
  if (data.action === "scan") return scan();
  if (data.action === "launch") return launch(false);
  if (data.action === "check") return launch(true);
  if (data.action === "favorite") return toggleFavorite();
  if (data.action === "stop") {
    await api(`/api/running/${data.pid}`, { method: "DELETE" });
    return pollRunning();
  }
  if (data.route) {
    if (element.getAttribute("aria-disabled") === "true") {
      toast(element.querySelector(".why")?.textContent || "route unavailable", "error");
      return;
    }
    return launch(false, data.route);
  }
  if (data.game) {
    renderDetail(state.games.find(game => game.id === Number(data.game)));
    return launch(false);
  }
  if (data.install) return runJob(data.install, data.id);
  if (data.removeSource) {
    await api(`/api/library/sources/${data.removeSource}`, {
      method: "DELETE",
    });
    return showSources();
  }
  element.click();
}

async function toggleFavorite(): Promise<void> {
  const game = state.game;
  if (!game) return;
  await api(`/api/games/${game.id}/favorite`, {
    method: "POST",
    json: { favorite: !game.favorite },
  });
  game.favorite = game.favorite ? 0 : 1;
  const row = document.querySelector(`[data-game="${game.id}"] .fav`);
  if (row) row.textContent = game.favorite ? "★" : "";
  renderDetail(game);
  focusFirst("[data-action=favorite]");
}

async function setDefault(): Promise<void> {
  const route = (document.activeElement as HTMLElement | null)?.dataset.route;
  if (!route || !state.system) {
    toast("Focus a launch route to make it the system default");
    return;
  }
  await api(`/api/systems/${state.system.id}/default`, {
    method: "PUT",
    json: { route },
  });
  state.system.defaultRoute = route;
  toast(`${state.system.name}: default route ${route}`, "ok");
  renderDetail(state.game);
  focusFirst(`[data-route="${CSS.escape(route)}"]`);
}

// ---- polling ------------------------------------------------------------------------------------

let jobTimer: ReturnType<typeof setTimeout> | undefined;
async function pollJobs(): Promise<void> {
  clearTimeout(jobTimer);
  const before = new Map(state.jobs.map(job => [job.id, job.status]));
  state.jobs = await api<Job[]>("/api/jobs");
  for (const job of state.jobs) {
    const was = before.get(job.id);
    if (job.status !== "running" && was !== job.status && (was === "running" || was === undefined)) {
      toast(
        job.status === "done" ? `Done: ${job.title}` : `Failed: ${job.title}: ${job.error}`,
        job.status === "done" ? "ok" : "error",
      );
      if (job.title === "Scan library" && (state.tab === "systems" || state.tab === "sources")) void show(state.tab);
      if (state.tab === "bios" && job.status === "done") void showBios();
    }
  }
  const jobs = document.querySelector("#jobs");
  if (jobs) jobs.innerHTML = jobsHtml();
  renderStatus();
  if (state.jobs.some(job => job.status === "running")) jobTimer = setTimeout(pollJobs, 1500);
}

async function pollRunning(): Promise<void> {
  state.running = await api<typeof state.running>("/api/running").catch(() => state.running);
  renderStatus();
}

function renderStatus(): void {
  const running = state.jobs.filter(job => job.status === "running").length;
  status.innerHTML = [
    state.running.length ? `<span class="pill play">▶ ${state.running.length} running</span>` : "",
    running ? `<span class="pill busy">⟳ ${running} job${running > 1 ? "s" : ""}</span>` : "",
    `<span class="pill" id="pad">${navigator.getGamepads?.().some(Boolean) ? "🎮 gamepad" : "⌨ keyboard"}</span>`,
  ].join("");
}

// ---- spatial navigation ---------------------------------------------------------------------------

function focusable(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[data-nav]")].filter(element => element.offsetParent !== null);
}

function focusFirst(selector: string): void {
  const element = document.querySelector<HTMLElement>(selector) ?? focusable().find(item => !item.closest(".tabs"));
  element?.focus({ preventScroll: true });
  element?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

type Direction = "up" | "down" | "left" | "right";

function move(direction: Direction): void {
  const items = focusable();
  const current = document.activeElement as HTMLElement | null;
  if (!current || !items.includes(current)) {
    focusFirst(".system, .game, [data-nav]");
    return;
  }
  const from = current.getBoundingClientRect();
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  let best: HTMLElement | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const item of items) {
    if (item === current) continue;
    const to = item.getBoundingClientRect();
    const dx = to.left + to.width / 2 - cx;
    const dy = to.top + to.height / 2 - cy;
    const [main, cross] =
      direction === "left" ? [-dx, dy] : direction === "right" ? [dx, dy] : direction === "up" ? [-dy, dx] : [dy, dx];
    if (main <= 1) continue;
    const overlap =
      direction === "left" || direction === "right"
        ? Math.min(from.bottom, to.bottom) - Math.max(from.top, to.top) > 0
        : Math.min(from.right, to.right) - Math.max(from.left, to.left) > 0;
    const score = main + Math.abs(cross) * (overlap ? 0.5 : 3);
    if (score < bestScore) {
      bestScore = score;
      best = item;
    }
  }
  if (!best) return;
  best.focus({ preventScroll: true });
  best.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function back(): void {
  if (state.tab === "games") void showSystems();
  else if (state.tab !== "systems") void showSystems();
}

function cycleTab(step: number): void {
  const order: Tab[] = ["systems", "bios", "installer", "sources"];
  const index = order.indexOf(state.tab === "games" ? "systems" : state.tab);
  void show(order[(index + step + order.length) % order.length]!);
}

function guarded(action: () => Promise<void> | void): void {
  Promise.resolve()
    .then(action)
    .catch(error => toast(error instanceof Error ? error.message : String(error), "error"));
}

document.addEventListener("focusin", event => {
  const target = event.target as HTMLElement;
  if (target.dataset.game) {
    state.lastGame = Number(target.dataset.game);
    renderDetail(state.games.find(game => game.id === state.lastGame));
  }
});

document.addEventListener("click", event => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-nav]");
  if (!target || target.matches("input, select, button[type=submit]")) return;
  event.preventDefault();
  guarded(() => activate(target));
});

document.addEventListener("submit", event => {
  event.preventDefault();
  const form = event.target as HTMLFormElement;
  const values = Object.fromEntries(new FormData(form)) as {
    path: string;
    system: string;
  };
  guarded(async () => {
    await api("/api/library/sources", { method: "POST", json: values });
    toast(`Added ${values.path}`, "ok");
    await showSources();
    await scan();
  });
});

document.addEventListener("keydown", event => {
  if (player) {
    if (event.key === "Escape") void closePlayer();
    return;
  }
  const target = event.target as HTMLElement;
  const typing = target.matches("input, select");
  const keys: Record<string, () => void> = {
    ArrowUp: () => move("up"),
    ArrowDown: () => move("down"),
    ArrowLeft: () => !typing && move("left"),
    ArrowRight: () => !typing && move("right"),
    Escape: back,
    Backspace: () => !typing && back(),
    q: () => !typing && cycleTab(-1),
    e: () => !typing && cycleTab(1),
    PageUp: () => cycleTab(-1),
    PageDown: () => cycleTab(1),
    c: () =>
      !typing &&
      state.tab === "games" &&
      guarded(() => launch(true, (document.activeElement as HTMLElement)?.dataset.route)),
    f: () => !typing && state.tab === "games" && guarded(toggleFavorite),
    d: () => !typing && state.tab === "games" && guarded(setDefault),
    r: () => !typing && guarded(scan),
  };
  const handler = keys[event.key];
  if (handler) {
    event.preventDefault();
    handler();
  } else if (event.key === "Enter" && !typing && target.dataset.nav !== undefined) {
    event.preventDefault();
    guarded(() => activate(target));
  }
});

// ---- gamepad (standard mapping) ---------------------------------------------------------------

const held = new Map<number, number>();
let axisAt = 0;
function pollGamepad(time: number): void {
  const pad = navigator.getGamepads?.().find(Boolean);
  if (player) {
    // the game owns the pad; only the exit chord is ours
    if (pad?.buttons[8]?.pressed && pad.buttons[9]?.pressed) void closePlayer();
  } else if (pad) {
    const press = (index: number, action: () => void) => {
      const pressed = pad.buttons[index]?.pressed ?? false;
      const since = held.get(index);
      if (!pressed) held.delete(index);
      else if (since === undefined) {
        held.set(index, time);
        action();
      } else if (index >= 12 && time - since > 350) {
        held.set(index, time - 260);
        action();
      }
    };
    press(12, () => move("up"));
    press(13, () => move("down"));
    press(14, () => move("left"));
    press(15, () => move("right"));
    press(0, () => {
      const active = document.activeElement as HTMLElement | null;
      if (active?.dataset.nav !== undefined) guarded(() => activate(active));
    });
    press(1, back);
    press(2, () => state.tab === "games" && guarded(toggleFavorite));
    press(3, () =>
      state.tab === "games"
        ? guarded(() => launch(true, (document.activeElement as HTMLElement)?.dataset.route))
        : guarded(scan),
    );
    press(4, () => cycleTab(-1));
    press(5, () => cycleTab(1));
    press(9, () => state.tab === "games" && guarded(setDefault));
    const [x = 0, y = 0] = pad.axes;
    if (time - axisAt > 180 && Math.max(Math.abs(x), Math.abs(y)) > 0.6) {
      axisAt = time;
      move(Math.abs(x) > Math.abs(y) ? (x > 0 ? "right" : "left") : y > 0 ? "down" : "up");
    }
  }
  requestAnimationFrame(pollGamepad);
}

window.addEventListener("gamepadconnected", () => {
  renderStatus();
  toast("Gamepad connected", "ok");
});
window.addEventListener("gamepaddisconnected", renderStatus);
requestAnimationFrame(pollGamepad);

// ---- boot -------------------------------------------------------------------------------------

async function boot(): Promise<void> {
  state.jobs = await api<Job[]>("/api/jobs");
  await pollRunning();
  const systems = await api<SystemRow[]>("/api/systems");
  if (!systems.some(system => system.games)) await scan();
  await showSystems();
  document.body.dataset.ready = "1";
  setInterval(() => void pollRunning(), 4000);
}

guarded(boot);
