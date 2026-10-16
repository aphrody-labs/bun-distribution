/**
 * Toriyama SVG Engine — Core Geometry & Curve Mathematics.
 *
 * Implements precision Toriyama drawing primitives measured from original tankobon plates:
 * - arcs: Sequence of circular arcs spanned across chord vectors with defined sagitta.
 * - volute: Inward spiral finishing cloud lobes and dust whorls (inherited from classical Xiyouji art).
 * - meche: Tapered manga hair lock drawn as a closed convex-concave shape.
 * - planDombre: Shading band formed by duplicating the silhouette contour, shifted and clipped.
 * - inkStroke: Relative ink stroke width (0.6% to 0.8% of subject width).
 * - mirrorX: Horizontal axis reflection for symmetrical elements.
 * - starPoints: 5-pointed star with measured 0.45 inner/outer ratio.
 */

export type Point = readonly [number, number];

export const roundTo = (val: number, decimals = 1): number => {
  const factor = 10 ** decimals;
  return Math.round(val * factor) / factor;
};

/**
 * Sequence of circular arcs between consecutive points.
 * sagittas[i] is the height of arc i (sagitta):
 * - Positive value curves outward (lobe).
 * - Negative value indents inward.
 * - Sagitta greater than half chord length yields the pinched lobe characteristic of Toriyama art.
 */
export function arcs(
  pts: readonly Point[],
  sagittas: readonly number[],
  closed = true,
): string {
  const n = pts.length;
  if (n === 0) return "";
  const end = closed ? n : n - 1;
  let path = `M${roundTo(pts[0][0])} ${roundTo(pts[0][1])}`;

  for (let i = 0; i < end; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % n];
    const chord = Math.hypot(x2 - x1, y2 - y1);
    if (chord === 0) continue;

    const h = sagittas[i % sagittas.length];
    const absH = Math.max(0.5, Math.abs(h));
    const radius = (chord * chord) / (8 * absH) + absH / 2;
    const largeArcFlag = absH > chord / 2 ? 1 : 0;
    const sweepFlag = h < 0 ? 0 : 1;

    path += ` A${roundTo(radius)} ${roundTo(radius)} 0 ${largeArcFlag} ${sweepFlag} ${roundTo(x2)} ${roundTo(y2)}`;
  }

  return closed ? `${path}Z` : path;
}

/**
 * Toriyama Inward Spiral Volute:
 * Terminal flourish for Kinto-Un lobes, dust clouds, and Ki vortexes.
 */
export function volute(
  start: Point,
  centerDir: Point,
  r: number,
  turns = 1.2,
  direction: 1 | -1 = 1,
): string {
  const dx = centerDir[0] - start[0];
  const dy = centerDir[1] - start[1];
  const len = Math.hypot(dx, dy) || 1;
  const cx = start[0] + (dx / len) * r;
  const cy = start[1] + (dy / len) * r;
  const a0 = Math.atan2(start[1] - cy, start[0] - cx);
  const steps = Math.ceil(turns * 12);
  let path = `M${roundTo(start[0])} ${roundTo(start[1])}`;

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const angle = a0 + direction * t * Math.PI * 2 * turns;
    const currentR = r * (1 - 0.85 * t);
    path += ` L${roundTo(cx + currentR * Math.cos(angle))} ${roundTo(cy + currentR * Math.sin(angle))}`;
  }
  return path;
}

/**
 * Tapered Manga Hair Lock (Meche de cheveux):
 * Solid polygon originating from a wide base and terminating in a sharp point.
 */
export function meche(
  base: Point,
  tip: Point,
  baseWidth: number,
  curvature = 0.25,
): string {
  const [bx, by] = base;
  const [px, py] = tip;
  const dx = px - bx;
  const dy = py - by;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const a: Point = [bx + nx * baseWidth * 0.5, by + ny * baseWidth * 0.5];
  const b: Point = [bx - nx * baseWidth * 0.5, by - ny * baseWidth * 0.5];
  const sagitta = len * curvature;

  const curve1 = arcs([a, tip], [sagitta], false);
  const curve2 = arcs([tip, b], [sagitta], false).replace(/^M[^A]*/, "");
  return `${curve1}${curve2}Z`;
}

/**
 * Computes canonical ink stroke width relative to subject width.
 * Standard ratio is 0.8% (0.008).
 */
export const inkStroke = (subjectWidth: number, percentage = 0.8): number =>
  roundTo((subjectWidth * percentage) / 100, 2);

/**
 * Shifted shading plane for comic-cel drop shadows.
 */
export function planDombre(
  contour: readonly Point[],
  offset: readonly [number, number],
  width: number,
  attenuation = 0,
): Point[] {
  const [dx, dy] = offset;
  return contour.map(([x, y]) => [x + dx, y + dy + attenuation * (x / width)]);
}

/**
 * Horizontal axis reflection.
 */
export const mirrorX = (pts: readonly Point[], axisX: number): Point[] =>
  pts.map(([x, y]) => [2 * axisX - x, y]);

/**
 * Generates points for a Toriyama-proportioned 5-pointed star.
 * Inner radius is measured at 0.45 of outer radius.
 */
export function starPoints(
  cx: number,
  cy: number,
  outerR: number,
  innerRatio = 0.45,
): string {
  const innerR = outerR * innerRatio;
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? outerR : innerR;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(
      `${roundTo(cx + rad * Math.cos(angle))},${roundTo(cy + rad * Math.sin(angle))}`,
    );
  }
  return pts.join(" ");
}

/**
 * Scouter HUD corner targeting brackets.
 * Returns path string for 4 reticle corners inside a bounding box.
 */
export function scouterBrackets(
  x: number,
  y: number,
  width: number,
  height: number,
  cornerLen = 8,
): string {
  const r = x + width;
  const b = y + height;
  const c = Math.min(cornerLen, width / 3, height / 3);
  return [
    `M ${x} ${y + c} L ${x} ${y} L ${x + c} ${y}`,
    `M ${r - c} ${y} L ${r} ${y} L ${r} ${y + c}`,
    `M ${x} ${b - c} L ${x} ${b} L ${x + c} ${b}`,
    `M ${r - c} ${b} L ${r} ${b} L ${r} ${b - c}`,
  ].join(" ");
}

/**
 * Radial action speedlines generator (concentrated energy burst).
 */
export function radialSpeedlines(
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  count = 24,
): string[] {
  const lines: string[] = [];
  const angleStep = (Math.PI * 2) / count;

  for (let i = 0; i < count; i++) {
    const jitter = (((i * 17) % 7) - 3) * 0.02;
    const angle = i * angleStep + jitter;
    const r1 = innerRadius + ((i * 13) % 5);
    const r2 = outerRadius - ((i * 19) % 8);

    const x1 = roundTo(cx + r1 * Math.cos(angle));
    const y1 = roundTo(cy + r1 * Math.sin(angle));
    const x2 = roundTo(cx + r2 * Math.cos(angle));
    const y2 = roundTo(cy + r2 * Math.sin(angle));

    lines.push(`M ${x1} ${y1} L ${x2} ${y2}`);
  }

  return lines;
}
