// SPDX-License-Identifier: Apache-2.0
// UI sounds (Spacedrive set, FSL-1.1-ALv2, see /sounds/LICENSE.spacedrive). Off by default for users who prefer reduced motion.
// Call initSounds() once; it watches the desktop for windows opening and closing. Dispatch
// `new CustomEvent("aph:notify")` (or call playSound("notify")) for notifications.
const KEY = "aph.sounds";
const FILES = { open: ["pairing", 0.25], close: ["copy", 0.2], notify: ["job-done", 0.35] } as const;
export type SoundName = keyof typeof FILES;

export function soundsEnabled(): boolean {
  const v = localStorage.getItem(KEY);
  if (v !== null) return v === "on";
  return !matchMedia("(prefers-reduced-motion: reduce)").matches;
}
export function setSoundsEnabled(on: boolean) {
  localStorage.setItem(KEY, on ? "on" : "off");
}

let ext: string | undefined;
export function playSound(name: SoundName) {
  if (!soundsEnabled()) return;
  const [file, volume] = FILES[name];
  const a = new Audio();
  ext ??= a.canPlayType('audio/ogg; codecs="vorbis"') ? "ogg" : "mp3";
  a.src = `/sounds/${file}.${ext}`;
  a.volume = volume;
  a.play().catch(() => {});
}

export function initSounds() {
  const isWin = (n: Node): n is HTMLElement => n instanceof HTMLElement && n.matches("section.win");
  new MutationObserver(records => {
    for (const r of records) {
      for (const n of r.addedNodes) if (isWin(n)) playSound("open");
      for (const n of r.removedNodes) if (isWin(n)) playSound("close");
    }
  }).observe(document.body, { childList: true, subtree: true });
  addEventListener("aph:notify", () => playSound("notify"));
}
