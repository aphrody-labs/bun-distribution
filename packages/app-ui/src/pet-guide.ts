// SPDX-License-Identifier: Apache-2.0
// Pure rules for the guide pet on the web surface: where it rests, when it steps aside, when it
// offers a hint, and how often it may speak. The DOM wiring lives in pet-guide-view.tsx.

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Space kept between the pet and the page edge (CSS px). */
export const GUIDE_MARGIN = 16;
/** Space kept between the pet and any element it must not cover (CSS px). */
export const GUIDE_CLEARANCE = 12;
/** Scroll speed above which the pet steps aside (px/s). */
export const SCROLL_FAST = 1500;
/** Pointer stillness over a control before the pet offers a hint (ms). */
export const HESITATION_MS = 6000;
/** Minimum delay between two pet messages (ms). */
export const MESSAGE_MIN_INTERVAL_MS = 60_000;
/** Pet messages allowed per page visit. */
export const MESSAGE_MAX_PER_VISIT = 4;

export function overlaps(a: Box, b: Box, clearance = 0): boolean {
  return (
    a.x < b.x + b.width + clearance &&
    b.x < a.x + a.width + clearance &&
    a.y < b.y + b.height + clearance &&
    b.y < a.y + a.height + clearance
  );
}

export function centerOf(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Resting spots on the page margins (corners and edge midpoints) not covering any obstacle. */
export function restingSpots(
  viewport: Size,
  pet: Size,
  obstacles: Box[],
  margin = GUIDE_MARGIN,
): Point[] {
  const left = margin;
  const right = viewport.width - pet.width - margin;
  const top = margin;
  const bottom = viewport.height - pet.height - margin;
  const midX = (viewport.width - pet.width) / 2;
  const midY = (viewport.height - pet.height) / 2;
  const candidates: Point[] = [
    { x: right, y: bottom },
    { x: left, y: bottom },
    { x: right, y: top },
    { x: left, y: top },
    { x: right, y: midY },
    { x: left, y: midY },
    { x: midX, y: bottom },
    { x: midX, y: top },
  ];
  return candidates.filter((p) => {
    if (p.x < 0 || p.y < 0) return false;
    const box = { ...p, width: pet.width, height: pet.height };
    return !obstacles.some((o) => overlaps(box, o, GUIDE_CLEARANCE));
  });
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function nearestRestingSpot(
  from: Point,
  viewport: Size,
  pet: Size,
  obstacles: Box[],
): Point | null {
  let best: Point | null = null;
  for (const spot of restingSpots(viewport, pet, obstacles)) {
    if (!best || distance(spot, from) < distance(best, from)) best = spot;
  }
  return best;
}

/** Scroll speed between two samples (px/s); 0 when the samples do not advance in time. */
export function scrollSpeed(
  previous: { y: number; t: number },
  current: { y: number; t: number },
): number {
  const seconds = (current.t - previous.t) / 1000;
  if (seconds <= 0) return 0;
  return Math.abs(current.y - previous.y) / seconds;
}

export type GuideAction =
  | { kind: "stay" }
  | { kind: "step-aside"; to: Point }
  | { kind: "move"; to: Point }
  | { kind: "hint"; to: Point; target: Box };

export interface GuideContext {
  viewport: Size;
  pet: Size;
  position: Point;
  /** Elements the pet must not cover: text, controls, fields, scroll regions. */
  obstacles: Box[];
  /** A text field has focus. */
  typing: boolean;
  scrollSpeed: number;
  /** Time since the last pointer or key activity (ms). */
  idleMs: number;
  /** Control under a still pointer, if any. */
  hesitationTarget: Box | null;
}

function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

/**
 * Decides the pet's next move. Typing or fast scrolling wins: the pet steps aside. A hesitation over
 * a control brings it next to that control. Otherwise it only moves when the page layout put it
 * over an element.
 */
export function decideGuide(ctx: GuideContext): GuideAction {
  if (ctx.typing || ctx.scrollSpeed > SCROLL_FAST) {
    const to = nearestRestingSpot(
      ctx.position,
      ctx.viewport,
      ctx.pet,
      ctx.obstacles,
    );
    return to && !samePoint(to, ctx.position)
      ? { kind: "step-aside", to }
      : { kind: "stay" };
  }
  if (ctx.hesitationTarget && ctx.idleMs >= HESITATION_MS) {
    const target = ctx.hesitationTarget;
    const beside = nearestSpotBeside(
      target,
      ctx.viewport,
      ctx.pet,
      ctx.obstacles,
    );
    return beside ? { kind: "hint", to: beside, target } : { kind: "stay" };
  }
  const covered = ctx.obstacles.some((o) =>
    overlaps(
      { ...ctx.position, width: ctx.pet.width, height: ctx.pet.height },
      o,
      0,
    ),
  );
  if (covered) {
    const to = nearestRestingSpot(
      ctx.position,
      ctx.viewport,
      ctx.pet,
      ctx.obstacles,
    );
    return to ? { kind: "move", to } : { kind: "stay" };
  }
  return { kind: "stay" };
}

/** Free spot closest to the target, leaving the target itself uncovered. */
function nearestSpotBeside(
  target: Box,
  viewport: Size,
  pet: Size,
  obstacles: Box[],
): Point | null {
  const spots = restingSpots(viewport, pet, [...obstacles, target]);
  const center = centerOf(target);
  let best: Point | null = null;
  for (const spot of spots) {
    if (!best || distance(spot, center) < distance(best, center)) best = spot;
  }
  return best;
}

export interface MessageGate {
  shown: number;
  lastAt: number;
}

export const NO_MESSAGES: MessageGate = {
  shown: 0,
  lastAt: Number.NEGATIVE_INFINITY,
};

/** Whether a pet message may show at `now`; returns the updated gate. */
export function admitMessage(
  gate: MessageGate,
  now: number,
): { allowed: boolean; gate: MessageGate } {
  if (
    gate.shown >= MESSAGE_MAX_PER_VISIT ||
    now - gate.lastAt < MESSAGE_MIN_INTERVAL_MS
  ) {
    return { allowed: false, gate };
  }
  return { allowed: true, gate: { shown: gate.shown + 1, lastAt: now } };
}

const GUIDE_ROUTES: ReadonlyArray<readonly [prefix: string, guide: GuideId]> = [
  ["/chat", "assistant"],
  ["/codex", "assistant"],
  ["/explorer", "files"],
  ["/favorites", "files"],
  ["/recents", "files"],
  ["/file-kinds", "files"],
  ["/redundancy", "files"],
  ["/sources", "files"],
  ["/search", "files"],
  ["/models", "creation"],
  ["/studio", "creation"],
  ["/creator", "creation"],
  ["/jobs", "jobs"],
  ["/tasks", "jobs"],
  ["/settings", "settings"],
  ["/docs", "docs"],
  ["/templates", "docs"],
  ["/material-3", "docs"],
  ["/showcase", "docs"],
];

export type GuideId =
  "home" | "assistant" | "files" | "creation" | "jobs" | "settings" | "docs";

/** Page guide for a pathname: the first matching route prefix on a segment boundary, else `home`. */
export function guideForPath(pathname: string): GuideId {
  for (const [prefix, guide] of GUIDE_ROUTES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return guide;
  }
  return "home";
}

export const GUIDE_TIPS: Record<GuideId, string> = {
  home: "Je peux te guider dans Aphrody. Clique sur moi quand tu veux.",
  assistant: "Pose ta question à l'IA ici, je reste en bord de page.",
  files: "Tes fichiers sont ici. Les filtres sont en haut de la liste.",
  creation: "Choisis un modèle à gauche, puis lance ta génération.",
  jobs: "Les tâches en cours apparaissent ici, je ne bouge pas pendant leur exécution.",
  settings: "Les réglages sont regroupés par thème dans cette page.",
  docs: "Cette page explique les fonctions. Je reste à l'écart du texte.",
};
