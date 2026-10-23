// SPDX-License-Identifier: Apache-2.0
import { h, icon } from "./dom";

export type Layout = "floating" | "dwindle" | "scrolling";
export type Direction = "left" | "right" | "up" | "down";
export const LAYOUTS: Layout[] = ["dwindle", "scrolling", "floating"];
export const WORKSPACES = 10;

export interface AppWindow {
  id: string;
  title: string;
  iconName: string;
  el: HTMLElement;
  minimized: boolean;
  maximized: boolean;
  /** Workspace number 1-10. */
  ws: number;
  /** Lives in the scratchpad instead of a workspace. */
  scratch: boolean;
  /** Stays floating above tiled layouts (dialogs, small tools), like a Hyprland float rule. */
  floating: boolean;
  close(): void;
  focus(): void;
  setTitle(title: string): void;
}

export interface OpenOptions {
  id?: string;
  title: string;
  icon: string;
  width?: number;
  height?: number;
  content: HTMLElement;
  onClose?: () => void;
  /** Keep this window floating even when its workspace tiles. */
  float?: boolean;
}

export interface WindowManagerOptions {
  /** Layout of workspaces without a saved choice (default floating). */
  defaultLayout?: Layout;
}

type Listener = () => void;
const GAP = 10;
/** Space kept free at the bottom of the desktop for the dock. */
const DOCK = 84;
const LAYOUT_KEY = "aph.layouts";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Windows on the desktop, after the Omarchy navigation model: ten workspaces, a layout per workspace
 * (dwindle tiling, scrolling columns or floating), a scratchpad, directional focus and swap.
 */
export class WindowManager {
  readonly windows = new Map<string, AppWindow>();
  workspace = 1;
  scratchOpen = false;
  private layouts: Record<number, Layout>;
  private z = 10;
  private seq = 0;
  private listeners = new Set<Listener>();
  /** Window order per workspace, used by the tiled layouts. */
  private order = new Map<number, string[]>();
  private readonly fallbackLayout: Layout;
  constructor(
    private readonly desk: HTMLElement,
    options: WindowManagerOptions = {},
  ) {
    this.fallbackLayout = options.defaultLayout ?? "floating";
    this.layouts = {};
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem(LAYOUT_KEY) ?? "{}",
      );
      if (saved && typeof saved === "object") {
        for (const [workspace, layout] of Object.entries(saved)) {
          const ws = Number(workspace);
          if (
            Number.isInteger(ws) &&
            ws >= 1 &&
            ws <= WORKSPACES &&
            LAYOUTS.includes(layout as Layout)
          )
            this.layouts[ws] = layout as Layout;
        }
      }
    } catch {
      this.layouts = {};
    }
    new ResizeObserver(() => this.arrange()).observe(desk);
  }

  onChange(fn: Listener) {
    this.listeners.add(fn);
  }
  private emit() {
    for (const fn of this.listeners) fn();
  }

  layout(ws = this.workspace): Layout {
    return this.layouts[ws] ?? this.fallbackLayout;
  }
  setLayout(layout: Layout, ws = this.workspace) {
    this.layouts[ws] = layout;
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(this.layouts));
    this.arrange();
    this.emit();
  }
  cycleLayout(step = 1) {
    const i = LAYOUTS.indexOf(this.layout());
    this.setLayout(LAYOUTS[(i + step + LAYOUTS.length) % LAYOUTS.length]!);
  }
  toggleTiled() {
    this.setLayout(this.layout() === "floating" ? "dwindle" : "floating");
  }

  open(o: OpenOptions): AppWindow {
    const existing = o.id ? this.windows.get(o.id) : undefined;
    if (existing) {
      if (!existing.scratch) this.goTo(existing.ws);
      this.restore(existing);
      return existing;
    }
    const id = o.id ?? `w${++this.seq}`;
    const titleEl = h("span", { class: "win-title" }, o.title);
    const mk = (cls: string, name: string, label: string, fn: () => void) =>
      h(
        "button",
        {
          class: `win-btn ${cls}`,
          "aria-label": label,
          title: label,
          onclick: fn,
        },
        icon(name),
      );
    const bar = h(
      "div",
      { class: "win-bar" },
      icon(o.icon),
      titleEl,
      mk("min", "min", "Minimize", () => this.minimize(win)),
      mk("max", "max", "Maximize", () => this.toggleMax(win)),
      mk("close", "close", "Close", () => win.close()),
    );
    const body = h("div", { class: "win-body" }, o.content);
    const el = h(
      "section",
      { class: "win", role: "dialog", "aria-label": o.title, tabindex: -1 },
      bar,
      body,
      h("div", { class: "win-resize", "aria-hidden": "true" }),
    );
    // Floating windows open centred on the free desktop, each new one stepped down and right.
    const n = this.windows.size % 6;
    const dw = this.desk.clientWidth;
    const dh = this.desk.clientHeight - DOCK;
    const w = Math.min(o.width ?? 880, dw - GAP * 2);
    const hh = Math.min(o.height ?? 560, dh - GAP * 2);
    el.style.width = `${w}px`;
    el.style.height = `${hh}px`;
    el.style.left = `${Math.max(GAP, Math.min(dw - w - GAP, (dw - w) / 2 + n * 28))}px`;
    el.style.top = `${Math.max(GAP, Math.min(dh - hh - GAP, (dh - hh) / 2 + n * 24))}px`;
    if (o.float) el.classList.add("floating");

    const win: AppWindow = {
      id,
      title: o.title,
      iconName: o.icon,
      el,
      minimized: false,
      maximized: false,
      ws: this.workspace,
      scratch: false,
      floating: !!o.float,
      close: () => {
        o.onClose?.();
        el.remove();
        this.windows.delete(id);
        const list = this.order.get(win.ws);
        if (list)
          this.order.set(
            win.ws,
            list.filter((x) => x !== id),
          );
        this.arrange();
        this.emit();
      },
      focus: () => this.focus(win),
      setTitle: (t) => {
        win.title = t;
        titleEl.textContent = t;
        el.setAttribute("aria-label", t);
        this.emit();
      },
    };
    this.windows.set(id, win);
    this.order.set(win.ws, [...(this.order.get(win.ws) ?? []), id]);
    this.desk.append(el);
    el.addEventListener("pointerdown", () => this.focus(win), true);
    bar.addEventListener("dblclick", (e) => {
      if (!(e.target as HTMLElement).closest(".win-btn")) this.toggleMax(win);
    });
    this.drag(win, bar);
    this.resize(win, el.querySelector(".win-resize") as HTMLElement);
    this.altGestures(win);
    if (matchMedia("(max-width: 720px)").matches) this.toggleMax(win);
    this.focus(win);
    this.arrange();
    this.emit();
    return win;
  }

  private visible(w: AppWindow): boolean {
    if (w.minimized) return false;
    return w.scratch ? this.scratchOpen : w.ws === this.workspace;
  }
  private applyVisibility() {
    for (const w of this.windows.values()) w.el.hidden = !this.visible(w);
  }

  focus(win: AppWindow) {
    // Floating windows stay above tiled ones, as Hyprland keeps floats on top.
    win.el.style.zIndex = String(++this.z + (win.floating ? 100_000 : 0));
    for (const w of this.windows.values())
      w.el.classList.toggle("active", w === win);
    this.emit();
  }
  restore(win: AppWindow) {
    if (!win.scratch && win.ws !== this.workspace) this.goTo(win.ws);
    if (win.scratch) this.scratchOpen = true;
    win.minimized = false;
    this.applyVisibility();
    this.arrange();
    this.focus(win);
    win.el.focus({ preventScroll: true });
  }
  minimize(win: AppWindow) {
    win.minimized = true;
    win.el.classList.remove("active");
    this.applyVisibility();
    this.arrange();
    this.emit();
  }
  toggleMax(win: AppWindow) {
    win.maximized = !win.maximized;
    win.el.classList.toggle("maximized", win.maximized);
    this.emit();
  }
  active(): AppWindow | undefined {
    return [...this.windows.values()].find(
      (w) =>
        w.el.classList.contains("active") && !w.minimized && this.visible(w),
    );
  }
  activeId(): string | undefined {
    return this.active()?.id;
  }
  closeAll() {
    for (const w of Array.from(this.windows.values())) w.close();
  }

  // Workspaces ---------------------------------------------------------------------------------
  goTo(ws: number) {
    if (ws < 1 || ws > WORKSPACES) return;
    this.workspace = ws;
    this.scratchOpen = false;
    this.applyVisibility();
    this.arrange();
    const top = this.visibleWindows().at(-1);
    if (top) this.focus(top);
    this.emit();
  }
  cycleWorkspace(step = 1) {
    this.goTo(((this.workspace - 1 + step + WORKSPACES) % WORKSPACES) + 1);
  }
  moveToWorkspace(win: AppWindow, ws: number, follow: boolean) {
    if (ws < 1 || ws > WORKSPACES) return;
    const from = this.order.get(win.ws);
    if (from)
      this.order.set(
        win.ws,
        from.filter((x) => x !== win.id),
      );
    win.ws = ws;
    win.scratch = false;
    this.order.set(ws, [...(this.order.get(ws) ?? []), win.id]);
    if (follow) this.goTo(ws);
    else {
      this.applyVisibility();
      this.arrange();
      this.emit();
    }
  }
  /** Workspaces that currently hold at least one window. */
  occupied(): Set<number> {
    return new Set(
      [...this.windows.values()].filter((w) => !w.scratch).map((w) => w.ws),
    );
  }

  // Scratchpad ---------------------------------------------------------------------------------
  toggleScratchpad() {
    this.scratchOpen = !this.scratchOpen;
    this.applyVisibility();
    this.arrange();
    if (this.scratchOpen) {
      const top = [...this.windows.values()].filter((w) => w.scratch).at(-1);
      if (top) this.focus(top);
    }
    this.emit();
  }
  sendToScratchpad(win: AppWindow) {
    win.scratch = !win.scratch;
    if (win.scratch) this.scratchOpen = false;
    else win.ws = this.workspace;
    this.applyVisibility();
    this.arrange();
    this.emit();
  }

  // Layout -------------------------------------------------------------------------------------
  private visibleWindows(): AppWindow[] {
    const ids = this.order.get(this.workspace) ?? [];
    return ids
      .map((id) => this.windows.get(id)!)
      .filter((w) => w && this.visible(w));
  }

  private save(w: AppWindow) {
    if (w.el.dataset.float) return;
    w.el.dataset.float = JSON.stringify([
      w.el.style.left,
      w.el.style.top,
      w.el.style.width,
      w.el.style.height,
    ]);
  }
  private place(w: AppWindow, r: Rect) {
    this.save(w);
    w.el.classList.add("tiled");
    w.el.style.left = `${Math.round(r.x)}px`;
    w.el.style.top = `${Math.round(r.y)}px`;
    w.el.style.width = `${Math.max(120, Math.round(r.w))}px`;
    w.el.style.height = `${Math.max(120, Math.round(r.h))}px`;
  }
  private unplace(w: AppWindow) {
    w.el.classList.remove("tiled");
    const saved = w.el.dataset.float;
    if (!saved) return;
    const [l, t, wd, ht] = JSON.parse(saved) as string[];
    Object.assign(w.el.style, { left: l, top: t, width: wd, height: ht });
    delete w.el.dataset.float;
  }

  /** Lay out the windows of the current workspace according to its layout. */
  arrange() {
    const layout = this.layout();
    const all = [...this.windows.values()];
    if (layout === "floating") {
      for (const w of all) {
        this.unplace(w);
        if (w.maximized || !this.visible(w)) continue;
        const width = this.desk.clientWidth;
        const height = this.desk.clientHeight;
        if (width <= 0 || height <= 0) continue;
        const availableWidth = Math.max(120, width - GAP * 2);
        const availableHeight = Math.max(120, height - DOCK - GAP);
        const ww = Math.min(w.el.offsetWidth, availableWidth);
        const wh = Math.min(w.el.offsetHeight, availableHeight);
        Object.assign(w.el.style, {
          width: `${ww}px`,
          height: `${wh}px`,
          left: `${Math.max(0, Math.min(w.el.offsetLeft, width - ww))}px`,
          top: `${Math.max(0, Math.min(w.el.offsetTop, height - wh - DOCK))}px`,
        });
      }
      return;
    }
    const tiled = this.visibleWindows().filter(
      (w) => !w.scratch && !w.maximized && !w.floating,
    );
    for (const w of all) if (!tiled.includes(w)) this.unplace(w);
    const area: Rect = {
      x: GAP,
      y: GAP,
      w: this.desk.clientWidth - GAP * 2,
      h: this.desk.clientHeight - GAP - DOCK,
    };
    if (!tiled.length || area.w <= 0) return;
    if (layout === "dwindle") this.dwindle(tiled, area);
    else this.scrolling(tiled, area);
  }

  private dwindle(list: AppWindow[], r: Rect) {
    const [first, ...rest] = list;
    if (!first) return;
    if (!rest.length) return this.place(first, r);
    const horizontal = r.w >= r.h;
    const half: Rect = horizontal
      ? { ...r, w: (r.w - GAP) / 2 }
      : { ...r, h: (r.h - GAP) / 2 };
    this.place(first, half);
    const next: Rect = horizontal
      ? { x: r.x + half.w + GAP, y: r.y, w: half.w, h: r.h }
      : { x: r.x, y: r.y + half.h + GAP, w: r.w, h: half.h };
    this.dwindle(rest, next);
  }

  /** Columns of 70% width, the focused one centred, neighbours peeking in from the sides. */
  private scrolling(list: AppWindow[], r: Rect) {
    const colW = list.length === 1 ? r.w : r.w * 0.7;
    const focused = Math.max(
      0,
      list.findIndex((w) => w.el.classList.contains("active")),
    );
    const start = r.x + (r.w - colW) / 2 - focused * (colW + GAP);
    list.forEach((w, i) =>
      this.place(w, { x: start + i * (colW + GAP), y: r.y, w: colW, h: r.h }),
    );
  }

  // Directional focus and swap -------------------------------------------------------------------
  private neighbour(from: AppWindow, dir: Direction): AppWindow | undefined {
    const c = (w: AppWindow) => ({
      x: w.el.offsetLeft + w.el.offsetWidth / 2,
      y: w.el.offsetTop + w.el.offsetHeight / 2,
    });
    const a = c(from);
    let best: AppWindow | undefined;
    let score = Infinity;
    for (const w of this.visibleWindows()) {
      if (w === from) continue;
      const b = c(w);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const along =
        dir === "left" ? -dx : dir === "right" ? dx : dir === "up" ? -dy : dy;
      if (along <= 0) continue;
      const across =
        dir === "left" || dir === "right" ? Math.abs(dy) : Math.abs(dx);
      const s = along + across * 2;
      if (s < score) {
        score = s;
        best = w;
      }
    }
    return best;
  }
  focusDirection(dir: Direction) {
    const cur = this.active();
    if (!cur) {
      const first = this.visibleWindows()[0];
      if (first) this.focus(first);
      return;
    }
    const next = this.neighbour(cur, dir);
    if (next) {
      this.focus(next);
      if (this.layout() === "scrolling") this.arrange();
    }
  }
  /** Tiled: swap positions with the neighbour. Floating: snap to a half or the full desktop. */
  swapDirection(dir: Direction) {
    const cur = this.active();
    if (!cur) return;
    if (this.layout() === "floating") return this.snap(cur, dir);
    const next = this.neighbour(cur, dir);
    const list = this.order.get(this.workspace);
    if (!next || !list) return;
    const i = list.indexOf(cur.id);
    const j = list.indexOf(next.id);
    [list[i], list[j]] = [list[j]!, list[i]!];
    this.arrange();
  }
  private snap(w: AppWindow, dir: Direction) {
    const dw = this.desk.clientWidth;
    const dh = this.desk.clientHeight - DOCK;
    const r: Rect =
      dir === "left"
        ? { x: GAP, y: GAP, w: dw / 2 - GAP * 1.5, h: dh - GAP }
        : dir === "right"
          ? { x: dw / 2 + GAP / 2, y: GAP, w: dw / 2 - GAP * 1.5, h: dh - GAP }
          : dir === "up"
            ? { x: GAP, y: GAP, w: dw - GAP * 2, h: dh - GAP }
            : { x: dw * 0.2, y: dh * 0.15, w: dw * 0.6, h: dh * 0.7 };
    w.maximized = false;
    w.el.classList.remove("maximized");
    Object.assign(w.el.style, {
      left: `${r.x}px`,
      top: `${r.y}px`,
      width: `${r.w}px`,
      height: `${r.h}px`,
    });
  }

  // Pointer gestures ----------------------------------------------------------------------------
  private drag(win: AppWindow, bar: HTMLElement) {
    bar.addEventListener("pointerdown", (e) => {
      if (win.maximized || (e.target as HTMLElement).closest(".win-btn"))
        return;
      this.startMove(win, e, bar);
    });
  }
  private startMove(win: AppWindow, e: PointerEvent, target: HTMLElement) {
    const el = win.el;
    if (el.classList.contains("tiled") && !win.floating) {
      // Dragging a tiled window pops it out as floating, like Super+O.
      this.setLayout("floating");
    }
    const sx = e.clientX - el.offsetLeft;
    const sy = e.clientY - el.offsetTop;
    target.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent) => {
      el.style.left = `${Math.max(-el.offsetWidth + 80, Math.min(this.desk.clientWidth - 80, m.clientX - sx))}px`;
      el.style.top = `${Math.max(0, Math.min(this.desk.clientHeight - 40, m.clientY - sy))}px`;
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      target.removeEventListener("lostpointercapture", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
    target.addEventListener("lostpointercapture", up);
  }

  private resize(win: AppWindow, grip: HTMLElement) {
    grip.addEventListener("pointerdown", (e) => {
      if (win.maximized) return;
      this.startResize(win, e, grip);
    });
  }
  private startResize(win: AppWindow, e: PointerEvent, grip: HTMLElement) {
    e.preventDefault();
    const el = win.el;
    const sw = el.offsetWidth - e.clientX;
    const sh = el.offsetHeight - e.clientY;
    grip.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent) => {
      el.style.width = `${Math.max(320, m.clientX + sw)}px`;
      el.style.height = `${Math.max(220, m.clientY + sh)}px`;
    };
    const up = () => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", up);
      grip.removeEventListener("lostpointercapture", up);
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", up);
    grip.addEventListener("lostpointercapture", up);
  }

  /** Alt+drag moves a window from anywhere, Alt+right-drag resizes it (Super+drag in Omarchy). */
  private altGestures(win: AppWindow) {
    win.el.addEventListener(
      "pointerdown",
      (e) => {
        if (!(e.altKey || e.metaKey) || win.maximized) return;
        e.preventDefault();
        e.stopPropagation();
        this.focus(win);
        if (e.button === 2) this.startResize(win, e, win.el);
        else if (e.button === 0) this.startMove(win, e, win.el);
      },
      true,
    );
    win.el.addEventListener("contextmenu", (e) => {
      if (e.altKey || e.metaKey) e.preventDefault();
    });
  }
}
