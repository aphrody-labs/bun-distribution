// SPDX-License-Identifier: Apache-2.0
/**
 * Bun OS Play client: one M3 single-page app over the merged gaming surfaces.
 *   /            library (public catalog of the Bun Engine frontend, free ROM packs)
 *   /play/<md5>  in-browser emulation (web emulation cores, WebGPU)
 *   /steam       Steam status, downloads, LAN cache and audit (signed in)
 *   /stream      gamestream client (WebRTC + WebCodecs + WebGPU FSR) (signed in)
 *   /engine      Bun Engine machines, jobs and the bun:nginx engine (signed in)
 */
import { observeWindowClass } from "@aphrody/m3-front/window-class";
import {
  coreFor,
  type CoreManifest,
  runCore,
  type RunningCore,
} from "./emulator";
import { icon, type IconName } from "./icons";
import { installSpatialNavigation } from "./spatial";

interface CatalogSystem {
  id: string;
  name: string;
  manufacturer: string;
  year: number;
  games: number;
  native: string | null;
}
interface CatalogGame {
  id: string;
  system: string;
  title: string;
  size: number;
  rom: string;
  source: string;
  license: string;
  description: string | null;
}
interface Catalog {
  generatedAt: string;
  systems: CatalogSystem[];
  games: CatalogGame[];
}
interface SessionInfo {
  authenticated: boolean;
  user: string | null;
  via: string | null;
  methods: { mesh: string; steam: string | null };
}

const main = document.getElementById("main") as HTMLElement;
const nav = document.getElementById("nav") as HTMLElement;
const account = document.getElementById("account") as HTMLElement;
const live = document.getElementById("live") as HTMLElement;
const signin = document.getElementById("signin") as HTMLDialogElement;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

const esc = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const bytes = (n: number | null | undefined) => {
  if (n == null) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { accept: "application/json", ...init?.headers },
  });
  if (response.status === 401)
    throw Object.assign(new Error("authentication required"), { status: 401 });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

// ------------------------------------------------------------------ state
let session: SessionInfo = {
  authenticated: false,
  user: null,
  via: null,
  methods: { mesh: "", steam: null },
};
let catalog: Catalog | null = null;
let cores: CoreManifest[] = [];
let running: RunningCore | null = null;
const listeners = new Map<string, Set<(data: unknown) => void>>();
const latest = new Map<string, unknown>();

function on(topic: string, listener: (data: unknown) => void): () => void {
  let set = listeners.get(topic);
  if (!set) listeners.set(topic, (set = new Set()));
  set.add(listener);
  if (latest.has(topic)) listener(latest.get(topic));
  return () => set.delete(listener);
}

// ------------------------------------------------------------------ realtime
let socket: WebSocket | null = null;
let retry = 0;
function connectRealtime(): void {
  if (!session.authenticated || socket) return;
  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?topics=steam,downloads,lancache,stream,engine,nginx`;
  const ws = new WebSocket(url);
  socket = ws;
  ws.onopen = () => {
    retry = 0;
    live.hidden = false;
  };
  ws.onmessage = (event) => {
    const message = JSON.parse(String(event.data)) as {
      type: string;
      topic: string;
      data: unknown;
    };
    if (message.type !== "event") return;
    latest.set(message.topic, message.data);
    for (const listener of listeners.get(message.topic) ?? [])
      listener(message.data);
  };
  ws.onclose = () => {
    socket = null;
    live.hidden = true;
    if (session.authenticated)
      setTimeout(connectRealtime, Math.min(30_000, 1000 * 2 ** retry++));
  };
}

// ------------------------------------------------------------------ shell
const ROUTES: {
  path: string;
  label: string;
  icon: IconName;
  private?: boolean;
}[] = [
  { path: "/", label: "Library", icon: "library" },
  { path: "/steam", label: "Steam", icon: "download", private: true },
  { path: "/stream", label: "Stream", icon: "stream", private: true },
  { path: "/engine", label: "Engine", icon: "memory", private: true },
];

function renderShell(): void {
  const current = location.pathname.startsWith("/play/")
    ? "/"
    : location.pathname;
  nav.innerHTML = ROUTES.map(
    (
      route,
    ) => `<a class="nav-item" href="${route.path}" data-link ${current === route.path ? 'aria-current="page"' : ""}>
      <span class="indicator">${icon(route.icon)}</span>
      <span>${route.label}${route.private && !session.authenticated ? ` ${icon("lock").replace('class="icon"', 'class="icon lock"')}` : ""}</span>
    </a>`,
  ).join("");
  account.innerHTML = session.authenticated
    ? `<span class="status ok" title="Signed in via ${esc(session.via)}">${esc(session.user)}</span>
       <button class="btn text" id="logout">${icon("logout")}Sign out</button>`
    : `<button class="btn tonal" id="login">${icon("login")}Sign in</button>`;
  document.getElementById("login")?.addEventListener("click", openSignin);
  document.getElementById("logout")?.addEventListener("click", async () => {
    await fetch("/auth/logout", { method: "POST" });
    session = { ...session, authenticated: false, user: null, via: null };
    socket?.close();
    route();
  });
}

function openSignin(): void {
  const methods = document.getElementById("signin-methods") as HTMLElement;
  methods.innerHTML = `
    <a class="btn filled" href="${esc(session.methods.mesh)}">${icon("lock")}Aphrody mesh (WireGuard)</a>
    ${session.methods.steam ? `<a class="btn outlined" href="${esc(session.methods.steam)}">${icon("gamepad")}Sign in through Steam</a>` : ""}
    <p class="hint">The mesh link works from a device on the Aphrody WireGuard network; the server mints a one-time code there and returns here signed in.</p>`;
  signin.showModal();
}

function locked(title: string): void {
  main.innerHTML = `<section class="locked">
    ${icon("lock")}
    <h1>${esc(title)}</h1>
    <p class="hint">This surface controls the VPS (Steam, streaming, installs). Sign in with an Aphrody identity.</p>
    <button class="btn filled" id="locked-signin">${icon("login")}Sign in</button>
  </section>`;
  document
    .getElementById("locked-signin")
    ?.addEventListener("click", openSignin);
}

// ------------------------------------------------------------------ library
const SYSTEM_TINT: Record<string, string> = {
  nes: "var(--md-sys-color-error)",
  gba: "var(--md-sys-color-primary)",
  nds: "var(--md-sys-color-tertiary)",
  psx: "var(--md-sys-color-secondary)",
};
let filter = { system: "all", query: "" };

async function renderLibrary(): Promise<void> {
  catalog ??= await api<Catalog>("/catalog.json");
  const systems = catalog.systems;
  const withGames = systems.filter((system) => system.games > 0);
  const playable = new Set(
    catalog.games
      .filter((game) => coreFor(cores, game.system))
      .map((game) => game.id),
  );
  main.innerHTML = `
    <section class="hero" id="hero">
      <div class="layer layer-1"></div><div class="layer layer-2"></div><div class="layer layer-3"></div>
      <div class="hero-content">
        <h1>Play <span>anywhere</span> on Bun OS</h1>
        <p>The Bun Engine library in the browser: emulation on WebGPU, Steam on the gaming host, and low-latency streaming.</p>
        <a class="btn filled" href="#games">${icon("gamepad")}Browse games</a>
        <div class="hero-stats">
          <div><strong>${systems.length}</strong>systems</div>
          <div><strong>${catalog.games.length}</strong>free games</div>
          <div><strong>${cores.filter((core) => !core.stub).length}</strong>web cores</div>
        </div>
      </div>
    </section>
    <div class="section-head" id="games"><h2>Library</h2><span class="hint">${playable.size} playable in the browser</span></div>
    <div class="toolbar">
      <label class="search">${icon("search")}<input id="query" type="search" placeholder="Search games" aria-label="Search games" value="${esc(filter.query)}" /></label>
      <div class="chips" role="group" aria-label="Systems">
        <button class="chip" data-system="all" aria-pressed="${filter.system === "all"}">All <span class="count">${catalog.games.length}</span></button>
        ${withGames.map((system) => `<button class="chip" data-system="${esc(system.id)}" aria-pressed="${filter.system === system.id}">${esc(system.name)} <span class="count">${system.games}</span></button>`).join("")}
      </div>
    </div>
    <div class="grid stagger" id="grid"></div>
    <div class="section-head"><h2>Systems</h2><span class="hint">Bun Engine frontend: ${systems.length} systems</span></div>
    <div class="panel table-wrap"><table class="table">
      <thead><tr><th>System</th><th>Manufacturer</th><th>Year</th><th>Native machine</th><th class="num">Free games</th></tr></thead>
      <tbody>${systems.map((system) => `<tr><td>${esc(system.name)}</td><td>${esc(system.manufacturer)}</td><td>${system.year}</td><td>${esc(system.native ?? "-")}</td><td class="num">${system.games}</td></tr>`).join("")}</tbody>
    </table></div>`;

  const grid = document.getElementById("grid") as HTMLElement;
  const paint = () => {
    const query = filter.query.trim().toLowerCase();
    const games = catalog!.games.filter(
      (game) =>
        (filter.system === "all" || game.system === filter.system) &&
        (!query || game.title.toLowerCase().includes(query)),
    );
    const systemName = new Map(
      systems.map((system) => [system.id, system.name]),
    );
    grid.innerHTML = games.length
      ? games
          .map(
            (
              game,
              index,
            ) => `<button class="game" style="--i:${index};--tint:${SYSTEM_TINT[game.system] ?? "var(--md-sys-color-primary)"}" data-play="${esc(game.id)}" aria-label="${esc(game.title)}, ${esc(systemName.get(game.system))}">
          <span class="cover"><span class="badge">${esc(game.system)}</span>${esc(
            game.title
              .replace(/[^A-Za-z0-9]/g, "")
              .slice(0, 2)
              .toUpperCase(),
          )}${playable.has(game.id) ? `<span class="playable">${icon("play")}</span>` : ""}</span>
          <span class="meta"><span class="title">${esc(game.title)}</span><span class="sub">${esc(systemName.get(game.system))} &middot; ${bytes(game.size)}</span></span>
        </button>`,
          )
          .join("")
      : `<p class="empty">No game matches.</p>`;
  };
  paint();
  document.getElementById("query")?.addEventListener("input", (event) => {
    filter.query = (event.target as HTMLInputElement).value;
    grid.classList.remove("stagger");
    paint();
  });
  main.querySelectorAll<HTMLButtonElement>("[data-system]").forEach((chip) =>
    chip.addEventListener("click", () => {
      filter.system = chip.dataset.system!;
      main
        .querySelectorAll("[data-system]")
        .forEach((other) =>
          other.setAttribute("aria-pressed", String(other === chip)),
        );
      grid.classList.add("stagger");
      paint();
    }),
  );
  grid.addEventListener("click", (event) => {
    const card = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-play]",
    );
    if (card) navigate(`/play/${card.dataset.play}`);
  });

  // Parallax on the hero only (pointer position), disabled for reduced motion.
  const hero = document.getElementById("hero") as HTMLElement;
  if (!reducedMotion.matches)
    hero.addEventListener("pointermove", (event) => {
      const rect = hero.getBoundingClientRect();
      hero.style.setProperty(
        "--px",
        String((event.clientX - rect.left) / rect.width - 0.5),
      );
      hero.style.setProperty(
        "--py",
        String((event.clientY - rect.top) / rect.height - 0.5),
      );
    });
}

// ------------------------------------------------------------------ emulator page
async function renderPlay(id: string): Promise<void> {
  catalog ??= await api<Catalog>("/catalog.json");
  const game = catalog.games.find((item) => item.id === id);
  if (!game) {
    main.innerHTML = `<p class="empty">Unknown game.</p>`;
    return;
  }
  const core = coreFor(cores, game.system);
  const system = catalog.systems.find((item) => item.id === game.system);
  main.innerHTML = `<section class="player">
    <div class="player-head">
      <button class="btn text" id="back" aria-label="Back to the library">${icon("back")}Library</button>
      <h1>${esc(game.title)}</h1>
    </div>
    <div class="screen" id="screen"><canvas id="canvas" width="256" height="240" tabindex="0" aria-label="${esc(game.title)} game screen"></canvas></div>
    <div class="panels">
      <div class="panel"><h3>${icon("memory")}Core</h3><dl class="kv">
        <dt>System</dt><dd>${esc(system?.name ?? game.system)}</dd>
        <dt>Core</dt><dd>${esc(core ? `${core.name} ${core.version ?? ""}` : "none published")}</dd>
        <dt>Renderer</dt><dd>${esc(core?.renderer ?? "-")}</dd>
        <dt>Isolation</dt><dd>${crossOriginIsolated ? "cross-origin isolated (threads available)" : "not isolated"}</dd>
        <dt>WebGPU</dt><dd>${"gpu" in navigator ? "available" : "unavailable"}</dd>
        <dt>Status</dt><dd id="core-status">idle</dd>
      </dl></div>
      <div class="panel"><h3>${icon("gamepad")}Controls</h3><p class="controls">
        <kbd>Arrows</kbd> D-pad &middot; <kbd>X</kbd> A &middot; <kbd>Z</kbd> B &middot; <kbd>Enter</kbd> Start &middot; <kbd>Backspace</kbd> Select &middot; <kbd>A</kbd>/<kbd>S</kbd> L/R. Gamepads use the standard mapping.</p>
        <p class="hint">${esc(game.license)}</p>
        <button class="btn tonal" id="fullscreen">${icon("fullscreen")}Fullscreen</button>
      </div>
    </div>
  </section>`;
  document
    .getElementById("back")
    ?.addEventListener("click", () => navigate("/"));
  const canvas = document.getElementById("canvas") as HTMLCanvasElement;
  document
    .getElementById("fullscreen")
    ?.addEventListener(
      "click",
      () => void document.getElementById("screen")?.requestFullscreen(),
    );
  const status = document.getElementById("core-status") as HTMLElement;
  if (game.system === "nds")
    document
      .getElementById("screen")
      ?.style.setProperty("--aspect", String(256 / 384));
  if (!core) {
    status.textContent =
      "No web core for this system is published yet (dist/web-emulation).";
    return;
  }
  try {
    const rom = new Uint8Array(await (await fetch(game.rom)).arrayBuffer());
    running = await runCore(
      core,
      canvas,
      rom,
      game.system,
      (text) => (status.textContent = text),
    );
    canvas.focus();
  } catch (error) {
    status.textContent = `Failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ------------------------------------------------------------------ steam
type SteamStatus = {
  available: boolean;
  root?: string;
  libraries?: {
    path: string;
    apps: number;
    freeBytes: number | null;
    totalBytes: number | null;
  }[];
  games?: {
    appId: number;
    name: string;
    sizeOnDisk: number;
    stateFlags: number;
    buildId: string | null;
  }[];
  compatTools?: {
    internalName: string;
    displayName: string;
    kind: string;
    version: string | null;
  }[];
  remotePlay?: {
    clients: {
      id: string;
      hostname: string | null;
      lastResult: string | null;
    }[];
    connections: string[];
  };
};
type Downloads = {
  rateMbps: number | null;
  rateAt: string | null;
  apps: {
    appId: number;
    name: string | null;
    state: string;
    update: string;
    updatedAt: string;
    finished: boolean;
  }[];
};
type Lancache = {
  generatedAt: string;
  root: string;
  totals: {
    requests: number;
    bytes: number;
    hitBytes: number;
    missBytes: number;
    errors: number;
    hitRatio: number;
  };
  throughput: { missMBps: number | null; hitMBps: number | null };
  depots: {
    depot: number;
    chunks: number;
    bytes: number;
    hits: number;
    misses: number;
  }[];
};

function renderSteam(): () => void {
  if (!session.authenticated) {
    locked("Steam");
    return () => {};
  }
  main.innerHTML = `
    <div class="section-head"><h2>Steam on the gaming host</h2><span class="status" id="steam-state">loading</span></div>
    <div class="panels">
      <div class="panel" id="downloads"><h3>${icon("download")}Downloads</h3><p class="hint">Waiting for content_log...</p></div>
      <div class="panel" id="lancache"><h3>${icon("storage")}LAN cache</h3><p class="hint">Waiting for the cache audit...</p></div>
    </div>
    <div class="section-head"><h2>Installed games</h2></div>
    <div class="panel table-wrap" id="steam-games"></div>
    <div class="section-head"><h2>Libraries, Proton and Remote Play</h2></div>
    <div class="panels">
      <div class="panel table-wrap" id="steam-libraries"></div>
      <div class="panel table-wrap" id="steam-tools"></div>
      <div class="panel" id="steam-remote"></div>
    </div>
    <div class="section-head"><h2>Network audit</h2><button class="btn tonal" id="audit">${icon("refresh")}Run audit</button></div>
    <div class="panel" id="audit-result"><p class="hint">bun-steam audit: content servers, CM servers, resolver and the client logs.</p></div>`;

  const offSteam = on("steam", (data) => {
    const steam = data as SteamStatus;
    const state = document.getElementById("steam-state");
    if (!state) return;
    state.className = `status ${steam.available ? "ok" : "warn"}`;
    state.textContent = steam.available
      ? `client at ${steam.root}`
      : "no Steam client";
    if (!steam.available) return;
    (document.getElementById("steam-games") as HTMLElement).innerHTML =
      `<table class="table"><thead><tr><th>Game</th><th>App ID</th><th class="num">Size</th><th>Build</th></tr></thead><tbody>${(steam.games ?? []).map((game) => `<tr><td>${esc(game.name)}</td><td>${game.appId}</td><td class="num">${bytes(game.sizeOnDisk)}</td><td>${esc(game.buildId ?? "-")}</td></tr>`).join("") || `<tr><td colspan="4">No installed game</td></tr>`}</tbody></table>`;
    (document.getElementById("steam-libraries") as HTMLElement).innerHTML =
      `<h3>${icon("storage")}Libraries</h3><table class="table"><tbody>${(steam.libraries ?? []).map((library) => `<tr><td>${esc(library.path)}</td><td class="num">${library.apps} apps</td><td class="num">${bytes(library.freeBytes)} free</td></tr>`).join("")}</tbody></table>`;
    (document.getElementById("steam-tools") as HTMLElement).innerHTML =
      `<h3>${icon("memory")}Compatibility tools</h3><table class="table"><tbody>${(steam.compatTools ?? []).map((tool) => `<tr><td>${esc(tool.displayName)}</td><td>${esc(tool.kind)}</td><td>${esc(tool.version ?? "")}</td></tr>`).join("") || "<tr><td>None</td></tr>"}</tbody></table>`;
    const remote = steam.remotePlay ?? { clients: [], connections: [] };
    (document.getElementById("steam-remote") as HTMLElement).innerHTML =
      `<h3>${icon("stream")}Remote Play</h3><dl class="kv">${remote.clients.map((client) => `<dt>${esc(client.hostname ?? client.id)}</dt><dd>${esc(client.lastResult ?? "-")}</dd>`).join("") || "<dt>Peers</dt><dd>none</dd>"}</dl>${remote.connections.length ? `<pre class="log">${esc(remote.connections.join("\n"))}</pre>` : ""}`;
  });
  const offDownloads = on("downloads", (data) => {
    const downloads = data as Downloads;
    const panel = document.getElementById("downloads");
    if (!panel) return;
    panel.innerHTML = `<h3>${icon("download")}Downloads</h3>
      <dl class="kv"><dt>Rate</dt><dd>${downloads.rateMbps == null ? "-" : `${downloads.rateMbps.toFixed(2)} Mbps`} <span class="hint">${esc(downloads.rateAt ?? "")}</span></dd></dl>
      <table class="table"><thead><tr><th>App</th><th>State</th><th>Update</th></tr></thead><tbody>${
        downloads.apps
          .slice(0, 8)
          .map(
            (app) =>
              `<tr><td>${esc(app.name ?? app.appId)}</td><td>${esc(app.state)}</td><td>${app.finished ? `<span class="status ok">done</span>` : esc(app.update || "-")}</td></tr>`,
          )
          .join("") || `<tr><td colspan="3">No recent update</td></tr>`
      }</tbody></table>`;
  });
  const offLancache = on("lancache", (data) => {
    const cache = data as Lancache;
    const panel = document.getElementById("lancache");
    if (!panel || !cache?.totals) return;
    const ratio = Math.round(cache.totals.hitRatio * 100);
    panel.innerHTML = `<h3>${icon("storage")}LAN cache</h3>
      <dl class="kv"><dt>Served</dt><dd>${bytes(cache.totals.bytes)} in ${cache.totals.requests} requests</dd>
      <dt>Hit ratio</dt><dd>${ratio}% (${bytes(cache.totals.hitBytes)} hit / ${bytes(cache.totals.missBytes)} miss)</dd>
      <dt>Miss rate</dt><dd>${cache.throughput.missMBps == null ? "-" : `${cache.throughput.missMBps.toFixed(1)} MB/s`}</dd>
      <dt>Errors</dt><dd>${cache.totals.errors}</dd></dl>
      <div class="bar" role="progressbar" aria-label="Cache hit ratio" aria-valuenow="${ratio}" aria-valuemin="0" aria-valuemax="100"><span style="width:${ratio}%"></span></div>
      <table class="table"><thead><tr><th>Depot</th><th class="num">Chunks</th><th class="num">Bytes</th></tr></thead><tbody>${cache.depots
        .slice(0, 6)
        .map(
          (depot) =>
            `<tr><td>${depot.depot}</td><td class="num">${depot.chunks}</td><td class="num">${bytes(depot.bytes)}</td></tr>`,
        )
        .join("")}</tbody></table>`;
  });
  const showAudit = (result: {
    running: boolean;
    last: {
      at: string;
      report: {
        findings?: { severity: string; message: string }[];
        durationMs?: number;
      };
    } | null;
  }) => {
    const panel = document.getElementById("audit-result");
    if (!panel) return;
    const findings = result.last?.report.findings ?? [];
    panel.innerHTML = result.last
      ? `<p class="hint">Last audit ${esc(result.last.at)}${result.running ? " (running again)" : ""}</p><table class="table"><tbody>${findings.map((finding) => `<tr><td>${esc(finding.severity)}</td><td>${esc(finding.message)}</td></tr>`).join("") || "<tr><td>No finding</td></tr>"}</tbody></table>`
      : `<p class="hint">${result.running ? "Audit running (about a minute)..." : "No audit yet."}</p>`;
  };
  void api<Parameters<typeof showAudit>[0]>("/api/steam/audit").then(
    showAudit,
    () => undefined,
  );
  document.getElementById("audit")?.addEventListener("click", async () => {
    showAudit(await api("/api/steam/audit", { method: "POST" }));
    const poll = setInterval(async () => {
      const result =
        await api<Parameters<typeof showAudit>[0]>("/api/steam/audit");
      showAudit(result);
      if (!result.running) clearInterval(poll);
    }, 5000);
  });
  return () => {
    offSteam();
    offDownloads();
    offLancache();
  };
}

// ------------------------------------------------------------------ stream
function renderStream(): () => void {
  if (!session.authenticated) {
    locked("Stream");
    return () => {};
  }
  main.innerHTML = `
    <div class="section-head"><h2>Game stream</h2><span class="status" id="stream-state">checking sender</span></div>
    <div class="screen"><iframe id="stream-frame" title="Game stream" allow="gamepad; fullscreen; autoplay; pointer-lock"></iframe></div>
    <div class="panels" style="margin-top:var(--space-md)">
      <div class="panel" id="stream-info"><h3>${icon("stream")}Sender</h3><p class="hint">WebRTC (H.264) to WebCodecs, presented with WebGPU FSR 1. Media flows over the Aphrody mesh (wg1).</p></div>
      <div class="panel"><h3>${icon("gamepad")}Session</h3><p class="hint">Keyboard, mouse and gamepads are sent over the WebRTC data channel. Click the stream to capture the pointer.</p>
        <button class="btn tonal" id="stream-full">${icon("fullscreen")}Fullscreen</button> <button class="btn text" id="stream-reconnect">${icon("refresh")}Reconnect</button></div>
    </div>`;
  const frame = document.getElementById("stream-frame") as HTMLIFrameElement;
  frame.src = "/stream-client/index.html";
  document
    .getElementById("stream-full")
    ?.addEventListener("click", () => void frame.requestFullscreen());
  document.getElementById("stream-reconnect")?.addEventListener("click", () => {
    frame.src = "/stream-client/index.html";
  });
  document.body.dataset.gamepadCapture = "stream";
  const off = on("stream", (data) => {
    const stream = data as {
      reachable?: boolean;
      sender?: {
        width: number;
        height: number;
        fps: number;
        codec: string;
        bitrateKbps: number;
      } | null;
      sessions?: { user: string; since: string; ice: string }[];
    };
    const state = document.getElementById("stream-state");
    const info = document.getElementById("stream-info");
    if (!state || !info || stream.reachable === undefined) return;
    state.className = `status ${stream.sender ? "ok" : "warn"}`;
    state.textContent = !stream.reachable
      ? "stream server unreachable"
      : stream.sender
        ? "sender ready"
        : "no sender running";
    const sender = stream.sender;
    info.innerHTML = `<h3>${icon("stream")}Sender</h3><dl class="kv">
      <dt>Server</dt><dd>${stream.reachable ? "reachable" : "down"}</dd>
      <dt>Video</dt><dd>${sender ? `${sender.width}x${sender.height}@${sender.fps} ${esc(sender.codec)} ${sender.bitrateKbps} kbps` : "-"}</dd>
      <dt>Sessions</dt><dd>${(stream.sessions ?? []).map((item) => `${esc(item.user)} (${esc(item.ice)})`).join(", ") || "none"}</dd></dl>`;
  });
  return () => {
    off();
    delete document.body.dataset.gamepadCapture;
  };
}

// ------------------------------------------------------------------ engine
function renderEngine(): () => void {
  if (!session.authenticated) {
    locked("Engine");
    return () => {};
  }
  main.innerHTML = `
    <div class="section-head"><h2>NGINX engine (bun:nginx)</h2><button class="btn tonal" id="reload">${icon("refresh")}Validate and reload</button></div>
    <div class="panel" id="nginx"><p class="hint">Loading...</p></div>
    <div class="section-head"><h2>Running machines</h2></div>
    <div class="panel" id="running"><p class="hint">Loading...</p></div>
    <div class="section-head"><h2>Systems and launch routes</h2><button class="btn text" id="scan">${icon("refresh")}Scan library</button></div>
    <div class="panel table-wrap" id="engine-systems"><p class="hint">Loading...</p></div>
    <div class="section-head"><h2>Jobs</h2></div>
    <div class="panel table-wrap" id="jobs"></div>`;
  const offNginx = on("nginx", (data) => {
    const engine = data as {
      running: boolean;
      pid: number | null;
      version: string | null;
      capabilities: Record<string, boolean> | null;
      module: Record<string, unknown> | null;
      lastReload: string | null;
      error: string | null;
    };
    const panel = document.getElementById("nginx");
    if (!panel) return;
    panel.innerHTML = `<dl class="kv">
      <dt>State</dt><dd><span class="status ${engine.running ? "ok" : "warn"}">${engine.running ? `running, master ${engine.pid}` : "stopped"}</span></dd>
      <dt>Version</dt><dd>${esc(engine.version ?? "-")}</dd>
      <dt>Capabilities</dt><dd>${esc(
        Object.entries(engine.capabilities ?? {})
          .filter(([, value]) => value === true)
          .map(([key]) => key)
          .join(", "),
      )}</dd>
      <dt>Rust module</dt><dd>${engine.module ? esc(`${engine.module.module} nginx ${engine.module.nginxVersion} worker ${engine.module.workerPID} (${engine.module.eventLoop})`) : "-"}</dd>
      <dt>Sources</dt><dd>${engine.module ? esc(`nginx ${String(engine.module.nginxSourceRevision).slice(0, 12)} / ngx-rust ${String(engine.module.ngxRustRevision).slice(0, 12)}`) : "-"}</dd>
      <dt>Last reload</dt><dd>${esc(engine.lastReload ?? "-")}</dd>
      ${engine.error ? `<dt>Error</dt><dd>${esc(engine.error)}</dd>` : ""}</dl>`;
  });
  const offRunning = on("engine", (data) => {
    const panel = document.getElementById("running");
    const items = (
      data as {
        running: {
          pid: number;
          title?: string;
          route?: string;
          system?: string;
        }[];
      }
    ).running;
    if (panel)
      panel.innerHTML = items.length
        ? `<table class="table"><tbody>${items.map((item) => `<tr><td>${item.pid}</td><td>${esc(item.title ?? "")}</td><td>${esc(item.system ?? "")}</td><td>${esc(item.route ?? "")}</td></tr>`).join("")}</tbody></table>`
        : `<p class="hint">No native machine running on the host.</p>`;
  });
  void api<
    {
      id: string;
      name: string;
      games: number;
      routes: { id: string; kind: string; available: boolean }[];
      defaultRoute: string | null;
    }[]
  >("/api/engine/systems").then(
    (systems) => {
      const panel = document.getElementById("engine-systems");
      if (panel)
        panel.innerHTML = `<table class="table"><thead><tr><th>System</th><th class="num">Games</th><th>Routes</th><th>Default</th></tr></thead><tbody>${systems.map((system) => `<tr><td>${esc(system.name)}</td><td class="num">${system.games}</td><td>${system.routes.map((route) => `<span class="status ${route.available ? "ok" : ""}">${esc(route.id)}</span>`).join(" ")}</td><td>${esc(system.defaultRoute ?? "auto")}</td></tr>`).join("")}</tbody></table>`;
    },
    (error) => {
      const panel = document.getElementById("engine-systems");
      if (panel) panel.innerHTML = `<p class="hint">${esc(error.message)}</p>`;
    },
  );
  const jobs = async () => {
    const list = await api<
      {
        id: number;
        title: string;
        status: string;
        startedAt: string;
        error?: string;
      }[]
    >("/api/engine/jobs").catch(() => []);
    const panel = document.getElementById("jobs");
    if (panel)
      panel.innerHTML = list.length
        ? `<table class="table"><tbody>${list.map((job) => `<tr><td>${job.id}</td><td>${esc(job.title)}</td><td><span class="status ${job.status === "done" ? "ok" : job.status === "failed" ? "warn" : ""}">${esc(job.status)}</span></td><td>${esc(job.error ?? job.startedAt)}</td></tr>`).join("")}</tbody></table>`
        : `<p class="hint">No job.</p>`;
  };
  void jobs();
  const timer = setInterval(jobs, 4000);
  document
    .getElementById("scan")
    ?.addEventListener(
      "click",
      () => void api("/api/engine/library/scan", { method: "POST" }).then(jobs),
    );
  document
    .getElementById("reload")
    ?.addEventListener("click", async (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
      try {
        const engine = await api("/api/nginx/reload", { method: "POST" });
        latest.set("nginx", engine);
        for (const listener of listeners.get("nginx") ?? []) listener(engine);
      } finally {
        button.disabled = false;
      }
    });
  return () => {
    offNginx();
    offRunning();
    clearInterval(timer);
  };
}

// ------------------------------------------------------------------ router
let cleanup: () => void = () => {};
function navigate(path: string): void {
  history.pushState(null, "", path);
  route();
}

async function route(): Promise<void> {
  cleanup();
  cleanup = () => {};
  running?.stop();
  running = null;
  renderShell();
  const path = location.pathname;
  try {
    if (path === "/") await renderLibrary();
    else if (path.startsWith("/play/"))
      await renderPlay(decodeURIComponent(path.slice(6)));
    else if (path === "/steam") cleanup = renderSteam();
    else if (path === "/stream") cleanup = renderStream();
    else if (path === "/engine") cleanup = renderEngine();
    else main.innerHTML = `<p class="empty">Not found.</p>`;
  } catch (error) {
    main.innerHTML = `<p class="empty">${icon("warning")} ${esc(error instanceof Error ? error.message : String(error))}</p>`;
  }
  main.focus({ preventScroll: true });
}

document.addEventListener("click", (event) => {
  const link = (event.target as HTMLElement).closest<HTMLAnchorElement>(
    "a[data-link]",
  );
  if (!link || event.ctrlKey || event.metaKey || event.shiftKey) return;
  event.preventDefault();
  navigate(link.getAttribute("href")!);
});
addEventListener("popstate", () => void route());

observeWindowClass();
installSpatialNavigation();
[session, cores] = await Promise.all([
  api<SessionInfo>("/api/session").catch(() => session),
  api<CoreManifest[]>("/api/emulation").catch(() => []),
]);
connectRealtime();
await route();
if (new URLSearchParams(location.search).get("auth") === "denied") openSignin();
