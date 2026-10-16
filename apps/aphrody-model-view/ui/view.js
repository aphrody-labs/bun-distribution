// Input for the native 3D layer: the page is transparent, the model is drawn
// natively underneath. Left drag orbits, right drag moves the window, the
// wheel zooms, double click re-frames, Escape closes.
const { invoke } = window.__TAURI__.core;
const win = window.__TAURI__.window.getCurrentWindow();

let last = null;
let pending = { dx: 0, dy: 0, zoom: 0 };
let scheduled = false;

function flush() {
  scheduled = false;
  const { dx, dy, zoom } = pending;
  pending = { dx: 0, dy: 0, zoom: 0 };
  if (dx || dy || zoom) invoke("plugin:aphrody-3d|orbit", { dx, dy, zoom }).catch(console.error);
}

function queue(dx, dy, zoom) {
  pending.dx += dx;
  pending.dy += dy;
  pending.zoom += zoom;
  if (!scheduled) {
    scheduled = true;
    requestAnimationFrame(flush);
  }
}

window.addEventListener("pointerdown", (e) => {
  if (e.button === 2) {
    win.startDragging();
    return;
  }
  if (e.button === 0) {
    last = { x: e.clientX, y: e.clientY };
    document.body.classList.add("dragging");
    document.body.setPointerCapture(e.pointerId);
  }
});
window.addEventListener("pointermove", (e) => {
  if (!last) return;
  queue(e.clientX - last.x, e.clientY - last.y, 0);
  last = { x: e.clientX, y: e.clientY };
});
window.addEventListener("pointerup", () => {
  last = null;
  document.body.classList.remove("dragging");
});
window.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    queue(0, 0, e.deltaY);
  },
  { passive: false },
);
window.addEventListener("dblclick", () => {
  invoke("plugin:aphrody-3d|orbit", { dx: 0, dy: 0, zoom: 0, reset: true }).catch(console.error);
});
window.addEventListener("contextmenu", (e) => e.preventDefault());
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") win.close();
});
