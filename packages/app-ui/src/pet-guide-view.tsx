// SPDX-License-Identifier: Apache-2.0
// Guide pet for the web workspace. Rules live in pet-guide.ts; this component samples the page and
// applies them to one <aphrody-pet>. AI surfaces send messages with the "aphrody:pet-message" event.
import { useEffect, useRef, useState } from "react";
import { PET } from "@aphrody/identity/pet";
import { PET_ATLAS_URL } from "@aphrody/identity/atlas";
import { defineAphrodyPet } from "@aphrody/identity/element";
import {
  admitMessage,
  type Box,
  decideGuide,
  GUIDE_TIPS,
  guideForPath,
  type MessageGate,
  NO_MESSAGES,
  type Point,
  scrollSpeed,
} from "./pet-guide";

const PET_HEIGHT = 96;
const PET_WIDTH = Math.round((PET_HEIGHT * PET.atlas.cellWidth) / PET.atlas.cellHeight);
const TICK_MS = 500;
const SCROLL_FRESH_MS = 400;
const MESSAGE_VISIBLE_MS = 6000;
const WAVE_MS = 1600;
const OBSTACLE_SELECTOR =
  "p, h1, h2, h3, h4, li, input, textarea, select, button, a[href], [role='button'], [contenteditable='true'], [data-pet-avoid]";
const CONTROL_SELECTOR = "button, a[href], [role='button']";
const FIELD_SELECTOR = "input, textarea, select, [contenteditable='true']";

interface Sample {
  y: number;
  t: number;
}

function obstaclesInView(): Box[] {
  const boxes: Box[] = [];
  for (const el of document.querySelectorAll<HTMLElement>(OBSTACLE_SELECTOR)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > window.innerHeight) continue;
    boxes.push({ x: r.left, y: r.top, width: r.width, height: r.height });
    if (boxes.length >= 400) break;
  }
  return boxes;
}

function labelOf(el: HTMLElement): string {
  return (el.getAttribute("aria-label") ?? el.textContent ?? "").replace(/\s+/g, " ").trim();
}

export function PetGuide() {
  const hostRef = useRef<HTMLDivElement>(null);
  const positionRef = useRef<Point>({ x: 0, y: 0 });
  const gateRef = useRef<MessageGate>(NO_MESSAGES);
  const pointerRef = useRef<Point | null>(null);
  const [mountedAt] = useState(() => performance.now());
  const lastActivityRef = useRef(mountedAt);
  const scrollRef = useRef<{ prev: Sample | null; last: Sample | null }>({
    prev: null,
    last: null,
  });
  const guideRef = useRef<string>("");
  const waveRef = useRef<number | undefined>(undefined);

  const [position, setPosition] = useState<Point | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    defineAphrodyPet();
    const host = hostRef.current;
    if (!host) return;
    const pet = document.createElement("aphrody-pet");
    pet.setAttribute("src", PET_ATLAS_URL);
    pet.setAttribute("size", String(PET_HEIGHT));
    pet.setAttribute("label", PET.displayName);
    pet.setAttribute("no-gaze", "");
    pet.style.cssText =
      "position:fixed;left:0;top:0;z-index:1000;pointer-events:auto;cursor:pointer;transition:transform 700ms ease-in-out;";
    host.appendChild(pet);

    const start = {
      x: window.innerWidth - PET_WIDTH - 16,
      y: window.innerHeight - PET_HEIGHT - 16,
    };
    positionRef.current = start;
    pet.style.transform = `translate(${start.x}px, ${start.y}px)`;
    setPosition(start);

    const showMessage = (text: string) => {
      const admitted = admitMessage(gateRef.current, performance.now());
      gateRef.current = admitted.gate;
      if (admitted.allowed) setMessage(text);
    };

    const applyPosition = (to: Point) => {
      positionRef.current = to;
      pet.style.transform = `translate(${to.x}px, ${to.y}px)`;
      setPosition(to);
    };

    const onActivity = (e: Event) => {
      lastActivityRef.current = performance.now();
      if (e instanceof PointerEvent) pointerRef.current = { x: e.clientX, y: e.clientY };
    };
    const onScroll = () => {
      const now = performance.now();
      const s = scrollRef.current;
      s.prev = s.last;
      s.last = { y: window.scrollY, t: now };
      lastActivityRef.current = now;
    };
    const onPetClick = () => {
      pet.play("waving");
      window.clearTimeout(waveRef.current);
      waveRef.current = window.setTimeout(() => pet.play(null), WAVE_MS);
    };
    const onAiMessage = (e: Event) => {
      const text = (e as CustomEvent<{ text?: unknown }>).detail?.text;
      if (typeof text === "string" && text.trim()) showMessage(text.trim());
    };

    const tick = () => {
      const now = performance.now();
      const path = window.location.pathname;
      const guide = guideForPath(path);
      if (guide !== guideRef.current) {
        guideRef.current = guide;
        showMessage(GUIDE_TIPS[guide]);
      }

      const active = document.activeElement as HTMLElement | null;
      const typing = !!active?.matches(FIELD_SELECTOR);
      const s = scrollRef.current;
      const speed = s.prev && s.last && now - s.last.t < SCROLL_FRESH_MS ? scrollSpeed(s.prev, s.last) : 0;

      const pointer = pointerRef.current;
      const hovered = pointer ? document.elementFromPoint(pointer.x, pointer.y) : null;
      const control = hovered?.closest<HTMLElement>(CONTROL_SELECTOR) ?? null;
      const target = control?.getBoundingClientRect();

      const action = decideGuide({
        viewport: { width: window.innerWidth, height: window.innerHeight },
        pet: { width: PET_WIDTH, height: PET_HEIGHT },
        position: positionRef.current,
        obstacles: obstaclesInView(),
        typing,
        scrollSpeed: speed,
        idleMs: now - lastActivityRef.current,
        hesitationTarget:
          target && target.width > 0
            ? {
                x: target.left,
                y: target.top,
                width: target.width,
                height: target.height,
              }
            : null,
      });

      if (action.kind === "stay") return;
      const current = positionRef.current;
      if (action.to.x === current.x && action.to.y === current.y) return;
      applyPosition(action.to);
      if (action.kind === "hint" && control) {
        const label = labelOf(control);
        if (label) showMessage(`« ${label} » : besoin d'aide ?`);
      }
    };

    const interval = window.setInterval(tick, TICK_MS);
    window.addEventListener("pointermove", onActivity, { passive: true });
    window.addEventListener("pointerdown", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("aphrody:pet-message", onAiMessage);
    pet.addEventListener("click", onPetClick);

    return () => {
      window.clearInterval(interval);
      window.clearTimeout(waveRef.current);
      window.removeEventListener("pointermove", onActivity);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("aphrody:pet-message", onAiMessage);
      pet.removeEventListener("click", onPetClick);
      pet.remove();
    };
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), MESSAGE_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [message]);

  const bubbleLeft = position ? Math.min(position.x, window.innerWidth - 260) : 0;
  const bubbleTop = position ? Math.max(position.y - 56, 8) : 0;

  return (
    <>
      <div ref={hostRef} />
      {message && position ? (
        // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- the speech bubble is transient: a click dismisses it early, and it also clears on its own timer
        <output
          aria-live="polite"
          onClick={() => setMessage(null)}
          style={{
            position: "fixed",
            left: bubbleLeft,
            top: bubbleTop,
            maxWidth: 240,
            zIndex: 1001,
            padding: "8px 12px",
            borderRadius: 12,
            background: "var(--md-sys-color-surface-container-high, #fff)",
            color: "var(--md-sys-color-on-surface, #1d1b20)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
            fontSize: 13,
            cursor: "pointer",
            pointerEvents: "auto",
          }}
        >
          {message}
        </output>
      ) : null}
    </>
  );
}
