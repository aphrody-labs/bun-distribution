// SPDX-License-Identifier: Apache-2.0
import { createGame, step } from "./engine.js";
import { drawAge1000Map } from "./age1000-map.js";
const canvas = document.querySelector("#arena"),
  ctx = canvas.getContext("2d");
const hud = document.querySelector("#hud"),
  result = document.querySelector("#result");
const mapCanvas = document.querySelector("#world-map");
const mapContext = mapCanvas.getContext("2d");
const loreForm = document.querySelector("#lore-search");
const loreStatus = document.querySelector("#lore-status");
const loreResults = document.querySelector("#lore-results");
let game = createGame(),
  active = false,
  paused = false,
  last = 0;
const held = new Set(),
  pointers = new Map();
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
function clear() {
  held.clear();
  pointers.clear();
}
function pause(value) {
  paused = value;
  clear();
  document.querySelector("#pause").setAttribute("aria-pressed", String(paused));
  result.textContent = paused ? "Partie en pause." : "Combat en cours.";
}
document.querySelector("#start").addEventListener("click", () => {
  game = createGame(document.querySelector("#style").value);
  active = true;
  pause(false);
});
document.querySelector("#pause").addEventListener("click", () => {
  if (active && game.status === "playing") pause(!paused);
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
function fighter(x, y, color, transformed, facing = 1) {
  ctx.fillStyle = transformed ? "#ffd475" : color;
  if (transformed) {
    ctx.strokeStyle = "#ffd475";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(x, y - 18, 26, 42, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillRect(x - 10, y - 32, 20, 25);
  ctx.fillRect(x - 9, y - 50, 18, 16);
  ctx.fillRect(x - 13, y - 7, 9, 15);
  ctx.fillRect(x + 4, y - 7, 9, 15);
  ctx.fillRect(x + facing * 15 - 4, y - 30, 8, 18);
  ctx.fillStyle = "#0b1020";
  ctx.fillRect(x + facing * 4 - 2, y - 45, 4, 4);
}
function draw() {
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
  fighter(p.x, p.y, document.querySelector("#color").value, p.transformed, p.facing);
  for (const e of game.enemies) {
    fighter(e.x, e.y, "#fc8b9c", false, Math.sign(p.x - e.x));
    ctx.fillStyle = "#fc8b9c";
    ctx.fillRect(e.x - 20, e.y - 65, (40 * e.hp) / (35 + game.wave * 8), 4);
  }
  ctx.fillStyle = "#77f3ff";
  for (const s of game.shots) {
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, 15, 8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  drawAge1000Map(mapContext, mapCanvas.width, mapCanvas.height);
}
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (active && !paused) {
    const input = {};
    for (const action of [...held, ...pointers.values()]) input[action] = true;
    step(game, input, dt);
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
  hud.textContent = `Vie ${Math.ceil(p.hp)} / 100 · Énergie ${Math.floor(p.energy)} / 100 · Vague ${game.wave} / 5 · Score ${game.score}${p.transformed ? " · Transformation active" : ""}`;
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
    const passage = document.createElement("p");
    const source = document.createElement("a");
    title.textContent = entry.title || entry.entity || "Passage Dragon Ball";
    passage.textContent = entry.snippet || entry.content || "Aucun extrait disponible.";
    source.href = entry.url || "https://dragonballfr.com/";
    source.textContent = "Ouvrir la source";
    source.target = "_blank";
    source.rel = "noopener noreferrer";
    article.append(title, passage, source);
    item.append(article);
    loreResults.append(item);
  }
  loreStatus.textContent = `${entries.length} passage(s) sourcé(s) trouvé(s).`;
}

loreForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = new FormData(loreForm).get("q").trim();
  loreStatus.textContent = "Recherche dans les archives…";
  loreResults.replaceChildren();
  try {
    const response = await fetch(`/api/lore/search?q=${encodeURIComponent(query)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "La recherche a échoué.");
    renderLoreResults(payload);
  } catch (error) {
    loreStatus.textContent = error.message || "Les archives sont momentanément indisponibles.";
  }
});
