// SPDX-License-Identifier: Apache-2.0
// <aphrody-pet>: the Aphrody pet as a framework-free Custom Element. One <div> in a shadow root
// carrying the `.nie-sprite .nie-c<i>` classes of the crate's sprite sheet (aphrody-sprite-sheet
// CSS from web.json); the clock is src/runtime.ts and wakes only when the frame changes (one
// setTimeout per frame, never a fixed rate). `prefers-reduced-motion: reduce` shows the first
// frame of the current animation and schedules nothing.
//
//   <aphrody-pet src="/spritesheet.webp" size="104"></aphrody-pet>
//   pet.setState("running")  pet.clearState()  pet.play("waving")  pet.play(null)
//
// Attributes: `src` (atlas URL, required), `size` (height in CSS px, default 208), `state`,
// `animation`, `label`, `no-gaze`. Registration is explicit: `defineAphrodyPet()`.
import {
  Ambient,
  gaze,
  PET_WEB,
  type PetWebData,
  resolve,
  type Tick,
} from "./runtime";
import { publicPetAtlas } from "./public-assets";

/** Pointer distance (CSS px at scale 1) beyond which the pet stops following it. */
const GAZE_RADIUS = 480;
/** The pet looks back at its own business this long after the pointer stopped moving. */
const GAZE_HOLD_MS = 2000;
/** Eyes height, as a fraction of the cell height (measured on the neutral pose). */
const EYES_Y = 0.42;

const HostBase: typeof HTMLElement =
  typeof HTMLElement === "undefined"
    ? (function HostFallback() {} as unknown as typeof HTMLElement)
    : HTMLElement;

let sheet: CSSStyleSheet | undefined;
function spriteSheet(data: PetWebData): CSSStyleSheet | string {
  const css = `:host{display:inline-block;position:relative;overflow:hidden;vertical-align:middle}
.nie-sprite{position:absolute;left:0;top:0;transform-origin:0 0}
${data.css}`;
  if (
    typeof CSSStyleSheet === "undefined" ||
    !("replaceSync" in CSSStyleSheet.prototype)
  )
    return css;
  if (!sheet) {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
  }
  return sheet;
}

export class AphrodyPetElement extends HostBase {
  static observedAttributes = [
    "src",
    "size",
    "state",
    "animation",
    "label",
    "no-gaze",
  ];

  readonly data: PetWebData = PET_WEB;
  #sprite: HTMLDivElement | null = null;
  #ambient = new Ambient(0, this.data.states);
  #played: { name: string; start: number } | null = null;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #shown = -1;
  #pointer: { x: number; y: number; at: number } | null = null;
  #motion: MediaQueryList | null = null;
  #onMotion = () => this.#render();
  #onPointer = (e: PointerEvent) => {
    this.#pointer = { x: e.clientX, y: e.clientY, at: performance.now() };
    this.#render();
  };

  connectedCallback(): void {
    if (!this.shadowRoot) {
      const root = this.attachShadow({ mode: "open" });
      const css = spriteSheet(this.data);
      if (typeof css === "string") {
        const style = document.createElement("style");
        style.textContent = css;
        root.append(style);
      } else {
        root.adoptedStyleSheets = [css];
      }
      this.#sprite = document.createElement("div");
      this.#sprite.className = "nie-sprite";
      this.#sprite.setAttribute("part", "sprite");
      root.append(this.#sprite);
    }
    this.setAttribute("role", "img");
    this.#ambient = new Ambient(performance.now(), this.data.states);
    this.#applyState(this.getAttribute("state"));
    const animation = this.getAttribute("animation");
    this.#played = animation
      ? { name: animation, start: performance.now() }
      : null;
    this.#motion =
      typeof matchMedia === "function"
        ? matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    this.#motion?.addEventListener("change", this.#onMotion);
    this.#syncGaze();
    this.#layout();
    this.#render();
  }

  disconnectedCallback(): void {
    clearTimeout(this.#timer);
    this.#motion?.removeEventListener("change", this.#onMotion);
    globalThis.removeEventListener?.("pointermove", this.#onPointer);
  }

  attributeChangedCallback(
    name: string,
    old: string | null,
    value: string | null,
  ): void {
    if (old === value || !this.#sprite) return;
    const now = performance.now();
    if (name === "state") this.#applyState(value);
    else if (name === "animation")
      this.#played = value ? { name: value, start: now } : null;
    else if (name === "no-gaze") this.#syncGaze();
    this.#layout();
    this.#render();
  }

  /** Sets an ambient state (`running`, `waiting`, `review`, `failed`) for its Codex lifetime. */
  setState(state: string): void {
    this.#ambient.set(state, performance.now());
    this.#render();
  }

  clearState(): void {
    this.#ambient.clear();
    this.#render();
  }

  /** The ambient state still valid now, or null. */
  get state(): string | null {
    return this.#ambient.state(performance.now())?.name ?? null;
  }

  /** Plays a track by name from its start (unknown names play `idle`); `null` returns to the ambient state. */
  play(animation: string | null): void {
    this.#played = animation
      ? { name: animation, start: performance.now() }
      : null;
    this.#render();
  }

  /** CSS scale of the 192x208 cell. */
  get scale(): number {
    const size = Number(this.getAttribute("size"));
    return Number.isFinite(size) && size > 0
      ? size / this.data.atlas.cellHeight
      : 1;
  }

  #applyState(state: string | null): void {
    if (state && Object.hasOwn(this.data.states, state))
      this.#ambient.set(state, performance.now());
    else this.#ambient.clear();
  }

  #syncGaze(): void {
    globalThis.removeEventListener?.("pointermove", this.#onPointer);
    if (!this.hasAttribute("no-gaze"))
      globalThis.addEventListener?.("pointermove", this.#onPointer, {
        passive: true,
      });
  }

  #layout(): void {
    const s = this.scale;
    const { cellWidth, cellHeight } = this.data.atlas;
    this.style.width = `${cellWidth * s}px`;
    this.style.height = `${cellHeight * s}px`;
    this.setAttribute(
      "aria-label",
      this.getAttribute("label") ?? this.data.displayName,
    );
    if (!this.#sprite) return;
    this.#sprite.style.transform = s === 1 ? "" : `scale(${s})`;
    const src = this.getAttribute("src") || publicPetAtlas("");
    this.#sprite.style.backgroundImage = src
      ? `url(${JSON.stringify(src)})`
      : "";
  }

  /** The gaze cell when the pet is at rest and the pointer moved recently within reach, else null. */
  #gazeCell(
    now: number,
    animation: string,
  ): { cell: number; until: number } | null {
    const p = this.#pointer;
    if (
      !p ||
      animation !== "idle" ||
      this.hasAttribute("no-gaze") ||
      now - p.at > GAZE_HOLD_MS
    )
      return null;
    const box = this.getBoundingClientRect();
    const s = this.scale;
    const dx = p.x - (box.left + box.width / 2);
    const dy = p.y - (box.top + box.height * EYES_Y);
    if (Math.hypot(dx, dy) > GAZE_RADIUS * s) return null;
    const i = gaze(
      dx,
      dy,
      this.data.gazeDeadzone * s,
      this.data.directions.length,
    );
    const cell = i === null ? this.data.neutral : this.data.directions[i];
    return cell === undefined ? null : { cell, until: p.at + GAZE_HOLD_MS };
  }

  #render(): void {
    clearTimeout(this.#timer);
    if (!this.#sprite) return;
    const now = performance.now();
    const reduced = this.#motion?.matches ?? false;
    const [ambientName, ambientElapsed] = this.#ambient.animation(now);
    const name = this.#played?.name ?? ambientName;
    const elapsed = reduced
      ? 0
      : this.#played
        ? now - this.#played.start
        : ambientElapsed;

    const looking = reduced ? null : this.#gazeCell(now, name);
    let tick: Tick | null;
    let wake: number | null;
    if (looking) {
      tick = { sprite: looking.cell, delay: null };
      wake = Math.max(1, looking.until - now);
    } else {
      tick = resolve(this.data.tracks, name, elapsed)?.tick ?? null;
      wake = reduced ? null : (tick?.delay ?? null);
    }
    if (tick && tick.sprite !== this.#shown) {
      this.#sprite.classList.remove(`nie-c${this.#shown}`);
      this.#sprite.classList.add(`nie-c${tick.sprite}`);
      this.#shown = tick.sprite;
    }
    if (reduced) return;
    // A frozen frame still has to notice its state expiring.
    const expiry = this.#played
      ? undefined
      : this.#ambient.state(now)?.remaining;
    if (expiry !== undefined)
      wake = wake === null ? expiry : Math.min(wake, expiry);
    if (wake !== null) this.#timer = setTimeout(() => this.#render(), wake);
  }
}

/** Registers `<aphrody-pet>` (or `tag`) once; returns the class. */
export function defineAphrodyPet(
  tag = "aphrody-pet",
): typeof AphrodyPetElement {
  if (typeof customElements !== "undefined" && !customElements.get(tag)) {
    customElements.define(tag, AphrodyPetElement);
  }
  return AphrodyPetElement;
}

declare global {
  interface HTMLElementTagNameMap {
    "aphrody-pet": AphrodyPetElement;
  }
}
