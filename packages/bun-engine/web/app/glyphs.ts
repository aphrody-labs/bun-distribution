// Controller glyphs of the footer hints. The shapes are our own plain geometry (a ring with a
// letter, a cross, a circle, a square, a triangle, a pill): they follow the layout of the connected
// pad (Gamepad API id) and never reproduce a console maker's artwork. Without a pad the hint shows
// the keyboard key instead.
export type PadKind = "none" | "xbox" | "playstation" | "nintendo" | "generic";

/** A hint token: the action in the pad's own vocabulary, shown as a glyph or a key. */
export type Token = "move" | "select" | "back" | "menu" | "tabs" | "x" | "y" | "view";

export function padKindOf(id: string | undefined): PadKind {
  if (!id) return "none";
  const text = id.toLowerCase();
  if (/054c|dualsense|dualshock|playstation|wireless controller/.test(text)) return "playstation";
  if (/057e|nintendo|pro controller|joy-con|switch/.test(text)) return "nintendo";
  if (/045e|xbox|xinput|microsoft/.test(text)) return "xbox";
  return "generic";
}

const keys: Record<Token, string> = {
  move: "Arrows",
  select: "Enter",
  back: "Esc",
  menu: "F1",
  tabs: "Q E",
  x: "F",
  y: "R",
  view: "D",
};

const ring = '<circle cx="12" cy="12" r="10.2"/>';
const letter = (value: string) =>
  `<text x="12" y="16.4" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor" stroke="none">${value}</text>`;
const shapes = {
  cross: '<path d="M8.2 8.2l7.6 7.6M15.8 8.2l-7.6 7.6"/>',
  circle: '<circle cx="12" cy="12" r="4.3"/>',
  square: '<rect x="8" y="8" width="8" height="8" rx=".6"/>',
  triangle: '<path d="M12 7.4l4.7 8.2H7.3z"/>',
};

/** The face button at a physical position (south, east, west, north) for this pad's labelling. */
function face(position: "south" | "east" | "west" | "north", kind: PadKind): string {
  if (kind === "playstation") {
    const shape = { south: shapes.cross, east: shapes.circle, west: shapes.square, north: shapes.triangle }[position];
    return ring + shape;
  }
  // Nintendo labels the same four positions B, A, Y, X; Xbox and unknown pads A, B, X, Y.
  const names =
    kind === "nintendo"
      ? { south: "B", east: "A", west: "Y", north: "X" }
      : { south: "A", east: "B", west: "X", north: "Y" };
  return ring + letter(names[position]);
}

const menuGlyph = '<rect x="2.5" y="6" width="19" height="12" rx="6"/><path d="M8.5 10h7M8.5 12h7M8.5 14h7"/>';
const viewGlyph = '<rect x="3" y="6" width="13" height="10" rx="2"/><rect x="8" y="9" width="13" height="9" rx="2"/>';
const dpad = '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>';

function pill(label: string): string {
  return `<svg class="glyph shoulder" viewBox="0 0 34 24" aria-hidden="true" focusable="false"><rect x="1.5" y="3.5" width="31" height="17" rx="8.5"/>${letter(label).replace('x="12" y="16.4"', 'x="17" y="16.2"').replace('font-size="12"', 'font-size="10"')}</svg>`;
}

function svg(inner: string): string {
  return `<svg class="glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${inner}</svg>`;
}

/** The HTML of one hint's control: a pad glyph when a pad is connected, otherwise a key cap. */
export function glyph(token: Token, kind: PadKind, keyLabel?: string): string {
  if (kind === "none") return `<kbd>${keyLabel ?? keys[token]}</kbd>`;
  switch (token) {
    case "move":
      return svg(dpad);
    case "select":
      return svg(face("south", kind));
    case "back":
      return svg(face("east", kind));
    case "x":
      return svg(face("west", kind));
    case "y":
      return svg(face("north", kind));
    case "menu":
      return svg(menuGlyph);
    case "view":
      return svg(viewGlyph);
    case "tabs": {
      const [left, right] = kind === "playstation" ? ["L1", "R1"] : kind === "nintendo" ? ["L", "R"] : ["LB", "RB"];
      return pill(left!) + pill(right!);
    }
  }
}
