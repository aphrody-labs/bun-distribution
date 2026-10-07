// SPDX-License-Identifier: Apache-2.0
import { createGame, pointerDirection, step } from "./engine.js";
import { drawAge1000Map } from "./age1000-map.js";
import { readGamepadInput } from "./gamepad.js";
import { loadAvatar, normalizeAvatar, saveAvatar } from "./avatar.js";
import { createWebGpuArena } from "./webgpu.js";
let initDragonPixelWasm = async () => {};
let RustGameSession = null;
try {
  ({ default: initDragonPixelWasm, Session: RustGameSession } =
    await import("./dragon-pixel-wasm.js"));
} catch {
  // The local source fallback remains available before the WASM package is built.
}
const canvas = document.querySelector("#arena"),
  ctx = canvas.getContext("2d");
const webGpuCanvas = document.querySelector("#arena-webgpu");
let webGpuArena = null;
createWebGpuArena(webGpuCanvas)
  .then((renderer) => {
    if (!renderer) return null;
    webGpuArena = renderer;
    canvas.hidden = true;
    webGpuCanvas.hidden = false;
    renderer.lost.then(() => {
      if (webGpuArena !== renderer) return false;
      webGpuArena = null;
      webGpuCanvas.hidden = true;
      canvas.hidden = false;
      return true;
    });
    return renderer;
  })
  .catch(() => {
    webGpuCanvas.hidden = true;
    return null;
  });
const hud = document.querySelector("#hud"),
  result = document.querySelector("#result");
const mapCanvas = document.querySelector("#world-map");
const mapContext = mapCanvas.getContext("2d");
const avatarFields = {
  name: document.querySelector("#avatar-name"),
  race: document.querySelector("#avatar-race"),
  hairstyle: document.querySelector("#avatar-hairstyle"),
  skin: document.querySelector("#avatar-skin"),
  hair: document.querySelector("#avatar-hair"),
  outfit: document.querySelector("#color"),
};
let avatar = loadAvatar(localStorage);
const loreForm = document.querySelector("#lore-search");
const loreStatus = document.querySelector("#lore-status");
const loreResults = document.querySelector("#lore-results");
const multiplayerStatus = document.querySelector("#multiplayer-status");
const roomName = document.querySelector("#room-name");
let multiplayerSocket = null,
  multiplayerPlayerId = null,
  multiplayerPlayers = [],
  lastNetworkSync = 0;
let game = createGame(),
  rustGame = null,
  active = false,
  paused = false,
  last = 0;
initDragonPixelWasm()
  .then(() => {
    if (RustGameSession) rustGame = new RustGameSession("balanced");
    return null;
  })
  .catch(() => {
    // A development checkout can run before its optional WASM package is built.
    return null;
  });
const held = new Set(),
  pointers = new Map();
let controllerConnected = false,
  gamepadStartWasPressed = false,
  mouseTarget = null;
const keys = {
  ArrowLeft: "left",
  ArrowRight: "right",
  q: "left",
  d: "right",
  " ": "jump",
  j: "punch",
  k: "blast",
  l: "charge",
  t: "transform",
};
for (const [key, field] of Object.entries(avatarFields)) field.value = avatar[key];
for (const field of Object.values(avatarFields)) {
  field.addEventListener("input", () => {
    const values = Object.fromEntries(
      Object.entries(avatarFields).map(([key, control]) => [key, control.value]),
    );
    avatar = normalizeAvatar(values);
    try {
      avatar = saveAvatar(localStorage, avatar);
    } catch {
      // Keep the avatar usable if local storage is disabled or full.
    }
  });
}
function clear() {
  held.clear();
  pointers.clear();
  mouseTarget = null;
}
function pause(value) {
  paused = value;
  clear();
  document.querySelector("#pause").setAttribute("aria-pressed", String(paused));
  result.textContent = paused ? "Partie en pause." : "Combat en cours.";
}
document.querySelector("#start").addEventListener("click", () => {
  const style = document.querySelector("#style").value;
  game = createGame(style);
  if (RustGameSession) rustGame = new RustGameSession(style);
  active = true;
  pause(false);
});
document.querySelector("#pause").addEventListener("click", () => {
  if (active && game.status === "playing") pause(!paused);
});
document.querySelector("#join-room").addEventListener("click", () => {
  const room = roomName.value.trim();
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(room)) {
    multiplayerStatus.textContent = "Utilise 1 à 32 lettres, chiffres, tirets ou traits bas.";
    return;
  }
  multiplayerSocket?.close();
  multiplayerPlayers = [];
  multiplayerPlayerId = null;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${protocol}//${window.location.hostname || "127.0.0.1"}:4320/ws/${encodeURIComponent(room)}`;
  multiplayerStatus.textContent = "Connexion au serveur Rust…";
  const socket = new WebSocket(url);
  multiplayerSocket = socket;
  socket.addEventListener("open", () => {
    if (multiplayerSocket !== socket) return;
    document.querySelector("#join-room").disabled = true;
    document.querySelector("#leave-room").disabled = false;
    multiplayerStatus.textContent = `Connecté à la salle « ${room} »; synchronisation en cours.`;
  });
  socket.addEventListener("message", (event) => {
    if (multiplayerSocket !== socket) return;
    try {
      const message = JSON.parse(event.data);
      if (message.type === "joined") multiplayerPlayerId = message.player_id;
      if (message.type === "game") game = message.game;
      if (message.type === "joined" || message.type === "players") {
        multiplayerPlayers = (message.players || []).filter(
          (player) => player.id !== multiplayerPlayerId,
        );
        multiplayerStatus.textContent = `Salle « ${room} » · ${multiplayerPlayers.length + 1} joueur(s) connecté(s).`;
      }
    } catch {
      multiplayerStatus.textContent = "Réponse du serveur Rust illisible.";
    }
  });
  socket.addEventListener("error", () => {
    if (multiplayerSocket === socket)
      multiplayerStatus.textContent = "Serveur Rust indisponible; le mode solo reste actif.";
  });
  socket.addEventListener("close", () => {
    if (multiplayerSocket !== socket) return;
    multiplayerSocket = null;
    multiplayerPlayerId = null;
    multiplayerPlayers = [];
    document.querySelector("#join-room").disabled = false;
    document.querySelector("#leave-room").disabled = true;
    multiplayerStatus.textContent = "Déconnecté. Le mode solo reste actif.";
  });
});
document.querySelector("#leave-room").addEventListener("click", () => {
  multiplayerSocket?.close(1000, "player left room");
});
window.addEventListener("keydown", (e) => {
  if (["INPUT", "SELECT", "BUTTON"].includes(e.target.tagName)) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (keys[key]) {
    e.preventDefault();
    held.add(keys[key]);
  }
  if (key === "p" && !e.repeat && active) pause(!paused);
});
window.addEventListener("keyup", (e) =>
  held.delete(keys[e.key.length === 1 ? e.key.toLowerCase() : e.key]),
);
for (const arenaCanvas of [canvas, webGpuCanvas]) {
  arenaCanvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const bounds = arenaCanvas.getBoundingClientRect();
    mouseTarget = Math.max(0, Math.min(960, ((event.clientX - bounds.left) / bounds.width) * 960));
  });
  arenaCanvas.addEventListener("pointermove", (event) => {
    if (event.buttons & 1) {
      const bounds = arenaCanvas.getBoundingClientRect();
      mouseTarget = Math.max(
        0,
        Math.min(960, ((event.clientX - bounds.left) / bounds.width) * 960),
      );
    }
  });
}
window.addEventListener("gamepadconnected", () => {
  controllerConnected = true;
  result.textContent =
    "Manette connectée. Stick gauche ou croix pour bouger; A saute, X combo, B projectile, Y charge, LB transforme et Start met en pause.";
});
window.addEventListener("gamepaddisconnected", () => {
  controllerConnected = [...navigator.getGamepads()].some(Boolean);
  if (!controllerConnected) result.textContent = "Manette déconnectée.";
});
for (const button of document.querySelectorAll("[data-action]")) {
  button.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    button.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, button.dataset.action);
  });
  for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
    button.addEventListener(event, (e) => pointers.delete(e.pointerId));
  button.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      held.add(button.dataset.action);
    }
  });
  button.addEventListener("keyup", () => held.delete(button.dataset.action));
  button.addEventListener("blur", () => held.delete(button.dataset.action));
}
window.addEventListener("blur", () => {
  if (active) pause(true);
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && active) pause(true);
});
function fighter(x, y, color, transformed, facing = 1, customAvatar = null) {
  const outfit = transformed ? "#ffd475" : customAvatar?.outfit || color;
  const skin = customAvatar?.skin || outfit;
  ctx.fillStyle = outfit;
  if (transformed) {
    ctx.strokeStyle = "#ffd475";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(x, y - 18, 26, 42, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillRect(x - 10, y - 32, 20, 25);
  ctx.fillStyle = skin;
  ctx.fillRect(x - 9, y - 50, 18, 16);
  ctx.fillRect(x - 13, y - 7, 9, 15);
  ctx.fillRect(x + 4, y - 7, 9, 15);
  ctx.fillRect(x + facing * 15 - 4, y - 30, 8, 18);
  if (customAvatar?.race === "namekian") {
    ctx.strokeStyle = skin;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - 5, y - 48);
    ctx.lineTo(x - 12, y - 60);
    ctx.moveTo(x + 5, y - 48);
    ctx.lineTo(x + 12, y - 60);
    ctx.stroke();
  } else if (customAvatar?.race === "frieza") {
    ctx.fillStyle = customAvatar.skin;
    ctx.beginPath();
    ctx.moveTo(x - 8, y - 49);
    ctx.lineTo(x - 14, y - 62);
    ctx.lineTo(x - 3, y - 50);
    ctx.moveTo(x + 8, y - 49);
    ctx.lineTo(x + 14, y - 62);
    ctx.lineTo(x + 3, y - 50);
    ctx.fill();
  } else if (customAvatar?.race === "android") {
    ctx.fillStyle = "#98efff";
    ctx.fillRect(x - 13, y - 45, 4, 9);
    ctx.fillRect(x + 9, y - 45, 4, 9);
  }
  ctx.fillStyle = customAvatar?.hair || "#0b1020";
  if (customAvatar?.hairstyle === "short") ctx.fillRect(x - 9, y - 53, 18, 7);
  else if (customAvatar?.hairstyle === "crest") {
    ctx.fillRect(x - 3, y - 62, 7, 12);
    ctx.fillRect(x - 8, y - 55, 16, 5);
  } else {
    ctx.fillRect(x - 12, y - 56, 6, 10);
    ctx.fillRect(x - 6, y - 62, 7, 16);
    ctx.fillRect(x + 1, y - 58, 6, 12);
    ctx.fillRect(x + 7, y - 54, 5, 8);
  }
  if (customAvatar?.race === "majin") {
    ctx.fillRect(x - 2, y - 67, 4, 14);
    ctx.fillRect(x - 4, y - 67, 8, 4);
  }
  ctx.fillStyle = "#0b1020";
  ctx.fillRect(x + facing * 4 - 2, y - 45, 4, 4);
}
function draw2d() {
  ctx.clearRect(0, 0, 960, 400);
  const gradient = ctx.createLinearGradient(0, 0, 0, 400);
  gradient.addColorStop(0, "#171d43");
  gradient.addColorStop(1, "#24405e");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 960, 400);
  ctx.fillStyle = "#e9dfb4";
  ctx.beginPath();
  ctx.arc(780, 85, 33, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#18263d";
  for (let i = 0; i < 9; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 140 - 50, 330);
    ctx.lineTo(i * 140 + 60, 180 + (i % 3) * 30);
    ctx.lineTo(i * 140 + 180, 330);
    ctx.fill();
  }
  ctx.fillStyle = "#35475f";
  ctx.fillRect(0, 328, 960, 72);
  ctx.fillStyle = "#80a5b2";
  ctx.fillRect(0, 328, 960, 4);
  const p = game.player;
  fighter(p.x, p.y, avatar.outfit, p.transformed, p.facing, avatar);
  for (const e of game.enemies) {
    fighter(e.x, e.y, "#fc8b9c", false, Math.sign(p.x - e.x));
    ctx.fillStyle = "#fc8b9c";
    ctx.fillRect(e.x - 20, e.y - 65, (40 * e.hp) / (35 + game.wave * 8), 4);
  }
  for (const remote of multiplayerPlayers)
    fighter(
      remote.x,
      remote.y,
      remote.avatar.outfit,
      false,
      Math.sign(p.x - remote.x),
      remote.avatar,
    );
  ctx.fillStyle = "#77f3ff";
  for (const s of game.shots) {
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, 15, 8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}
function draw() {
  if (webGpuArena) webGpuArena.render(game, avatar, multiplayerPlayers);
  else draw2d();
  drawAge1000Map(mapContext, mapCanvas.width, mapCanvas.height);
}
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  const gamepad = [...navigator.getGamepads()].find(Boolean);
  controllerConnected = Boolean(gamepad);
  const { input: gamepadInput, startPressed: gamepadStartPressed } = readGamepadInput(gamepad);
  let networkInput = {};
  if (gamepadStartPressed && !gamepadStartWasPressed && active && game.status === "playing")
    pause(!paused);
  gamepadStartWasPressed = gamepadStartPressed;
  if (active && !paused) {
    const input = {};
    for (const action of [...held, ...pointers.values()]) input[action] = true;
    for (const [action, pressed] of Object.entries(gamepadInput)) input[action] ||= pressed;
    networkInput = input;
    const mouseDirection = pointerDirection(mouseTarget, game.player.x);
    if (mouseDirection) input[mouseDirection] = true;
    else mouseTarget = null;
    if (multiplayerSocket?.readyState === WebSocket.OPEN) {
      // The Rust room snapshot drives combat while connected; never advance a second local world.
    } else if (rustGame) {
      const state = JSON.parse(rustGame.step(JSON.stringify(input), dt));
      state.player.style = game.player.style;
      game = state;
    } else {
      step(game, input, dt);
    }
    if (game.status !== "playing") {
      active = false;
      clear();
      result.textContent =
        game.status === "won"
          ? `Victoire ! Les cinq vagues sont vaincues. Score : ${game.score}.`
          : `Défaite. Score : ${game.score}. Recommence pour tenter un autre style.`;
    }
  }
  const p = game.player;
  hud.textContent = `${avatar.name} · Vie ${Math.ceil(p.hp)} / 100 · Énergie ${Math.floor(p.energy)} / 100 · Vague ${game.wave} / 5 · Score ${game.score}${p.transformed ? " · Transformation active" : ""} · ${webGpuArena ? "3D WebGPU" : "Canvas 2D"}`;
  if (multiplayerSocket?.readyState === WebSocket.OPEN && now - lastNetworkSync >= 50) {
    multiplayerSocket.send(
      JSON.stringify({
        type: "frame",
        player: { x: p.x, y: p.y, avatar },
        input: networkInput,
        dt,
      }),
    );
    lastNetworkSync = now;
  }
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function renderLoreResults(payload) {
  loreResults.replaceChildren();
  const entries = payload.results || payload.hits || [];
  if (!entries.length) {
    loreStatus.textContent = "Aucun passage trouvé pour cette recherche.";
    return;
  }
  for (const entry of entries) {
    const item = document.createElement("li");
    const article = document.createElement("article");
    const title = document.createElement("h3");
    const kind = document.createElement("small");
    const passage = document.createElement("p");
    const source = document.createElement("a");
    title.textContent = entry.title || entry.entity || "Passage Dragon Ball";
    kind.textContent = entry.kind || entry.sourceId || "archive";
    passage.textContent = entry.snippet || entry.content || "Aucun extrait disponible.";
    source.href = entry.url || "https://dragonballfr.com/";
    source.textContent = "Ouvrir la source";
    source.target = "_blank";
    source.rel = "noopener noreferrer";
    article.append(title, kind, passage, source);
    item.append(article);
    loreResults.append(item);
  }
  loreStatus.textContent = `${entries.length} passage(s) sourcé(s) trouvé(s).`;
}

loreForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(loreForm);
  const query = form.get("q").trim();
  const sourceId = form.get("sourceId");
  loreStatus.textContent = "Recherche dans les archives…";
  loreResults.replaceChildren();
  try {
    const params = new URLSearchParams({ q: query });
    if (sourceId) params.set("sourceId", sourceId);
    const response = await fetch(`/api/lore/search?${params}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "La recherche a échoué.");
    renderLoreResults(payload);
  } catch (error) {
    loreStatus.textContent = error.message || "Les archives sont momentanément indisponibles.";
  }
});
