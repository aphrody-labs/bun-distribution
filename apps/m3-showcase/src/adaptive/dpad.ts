// D-pad navigation for TV: arrow keys move focus to the nearest focusable element in that direction (spatial
// navigation), Enter activates, Back (Escape, Backspace, XF86Back, Tizen 10009, webOS 461, Android 4) closes the
// topmost dialog or goes back. `pickNext` is pure; `attachDpad` binds it to a document.

export type Direction = "up" | "down" | "left" | "right";

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const boxOf = (rect: {
  left: number;
  top: number;
  right: number;
  bottom: number;
}): Box => ({
  left: rect.left,
  top: rect.top,
  right: rect.right,
  bottom: rect.bottom,
});

const centerX = (b: Box) => (b.left + b.right) / 2;
const centerY = (b: Box) => (b.top + b.bottom) / 2;

/** Overlap length of two ranges (0 when they only touch or are apart). */
const overlap = (a0: number, a1: number, b0: number, b1: number) =>
  Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/**
 * The candidate to move to from `from` in `direction`, or undefined. A candidate must lie in the direction (its
 * centre beyond the origin's centre, its near edge not behind the origin's far edge by more than a tolerance).
 * The score is the gap along the axis plus twice the offset across it, minus credit for overlapping the origin's
 * extent across the axis, so a card straight below beats a nearer one far to the side.
 */
export function pickNext<T>(
  from: Box,
  candidates: ReadonlyArray<{ item: T; box: Box }>,
  direction: Direction,
): T | undefined {
  const horizontal = direction === "left" || direction === "right";
  const sign = direction === "right" || direction === "down" ? 1 : -1;
  let best: { item: T; score: number } | undefined;
  for (const { item, box } of candidates) {
    if (box === from) continue;
    const along = horizontal
      ? centerX(box) - centerX(from)
      : centerY(box) - centerY(from);
    if (along * sign <= 1) continue;
    // Near edge of the candidate relative to the far edge of the origin, along the movement axis.
    const gap = horizontal
      ? sign > 0
        ? box.left - from.right
        : from.left - box.right
      : sign > 0
        ? box.top - from.bottom
        : from.top - box.bottom;
    if (
      gap <
      -Math.min(
        horizontal ? from.right - from.left : from.bottom - from.top,
        24,
      )
    )
      continue;
    const across = horizontal
      ? Math.abs(centerY(box) - centerY(from))
      : Math.abs(centerX(box) - centerX(from));
    const shared = horizontal
      ? overlap(from.top, from.bottom, box.top, box.bottom)
      : overlap(from.left, from.right, box.left, box.right);
    const score = Math.max(0, gap) + 2 * across - shared;
    if (!best || score < best.score) best = { item, score };
  }
  return best?.item;
}

/** Keys that mean "back" on TV platforms. */
export const BACK_KEYS = new Set([
  "Escape",
  "Backspace",
  "BrowserBack",
  "GoBack",
  "XF86Back",
]);
export const BACK_KEY_CODES = new Set([4, 10009, 461]);

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
  "[data-dpad]",
  "md-filled-button",
  "md-outlined-button",
  "md-text-button",
  "md-filled-tonal-button",
  "md-elevated-button",
  "md-icon-button",
  "md-filled-icon-button",
  "md-fab",
  "md-chip-set md-filter-chip",
  "md-switch",
  "md-checkbox",
  "md-radio",
  "md-slider",
  "md-primary-tab",
  "md-secondary-tab",
  "md-navigation-tab",
  "md-list-item[type=button]",
  "md-list-item[type=link]",
].join(",");

function disabledByFieldset(element: HTMLElement): boolean {
  for (
    let fieldset = element.closest("fieldset[disabled]");
    fieldset;
    fieldset = fieldset.parentElement?.closest("fieldset[disabled]") ?? null
  ) {
    const legend = [...fieldset.children].find(
      (child) => child.tagName === "LEGEND",
    );
    if (!legend?.contains(element)) return true;
  }
  return false;
}
/** The visible, enabled focusable elements under `root`. */
export function focusables(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    if (
      el.closest(
        "[hidden], [inert], [aria-hidden='true'], [aria-disabled='true']",
      )
    )
      return false;
    if (
      disabledByFieldset(el) ||
      el.matches(":disabled") ||
      el.hasAttribute("disabled") ||
      el.getAttribute("aria-disabled") === "true"
    )
      return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  });
}

/** The topmost modal: an open dialog or an `aria-modal` container. Focus is confined to it. */
export function activeModal(doc: Document): HTMLElement | null {
  const modals = [
    ...doc.querySelectorAll<HTMLElement>(
      "dialog[open], md-dialog[open], [aria-modal='true']",
    ),
  ].filter((element) => {
    if (element.closest("[hidden], [inert], [aria-hidden='true']"))
      return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  });
  return modals.at(-1) ?? null;
}

export interface DpadOptions {
  /** Called for a Back key when no modal consumed it. */
  onBack?: () => void;
  /** The document to bind to (default: the global one). */
  doc?: Document;
}

/** Bind the keys to `doc`. Returns a disposer. */
export function attachDpad(options: DpadOptions = {}): () => void {
  const doc = options.doc ?? document;
  const move = (direction: Direction): boolean => {
    const scope: ParentNode = activeModal(doc) ?? doc;
    const items = focusables(scope);
    if (items.length === 0) return false;
    const current = doc.activeElement as HTMLElement | null;
    const origin =
      current && items.includes(current)
        ? current
        : (current?.closest<HTMLElement>(FOCUSABLE) ?? null);
    if (!origin) {
      (items.find((el) => el.hasAttribute("data-dpad-start")) ??
        items[0])!.focus();
      return true;
    }
    const from = boxOf(origin.getBoundingClientRect());
    const target = pickNext(
      from,
      items
        .filter((el) => el !== origin)
        .map((el) => ({ item: el, box: boxOf(el.getBoundingClientRect()) })),
      direction,
    );
    if (!target) return false;
    target.focus({ preventScroll: false });
    target.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    return true;
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    const editing = (
      event.composedPath()[0] as HTMLElement | undefined
    )?.closest?.(
      "input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea, [contenteditable='true']",
    );
    const direction = (
      {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
      } as const
    )[event.key as "ArrowUp"];
    if (direction) {
      // Inside a text field the arrows belong to the caret; leave through the field's edges with Tab or Back.
      if (editing) return;
      if (move(direction)) event.preventDefault();
      return;
    }
    if (event.key === "Enter" && !editing) {
      const target = doc.activeElement as HTMLElement | null;
      // Native buttons and links activate themselves; custom controls and tabindex containers need the click.
      if (
        target &&
        !(target instanceof HTMLButtonElement) &&
        !(target instanceof HTMLAnchorElement) &&
        !(target instanceof HTMLInputElement) &&
        !(target instanceof HTMLSelectElement)
      ) {
        event.preventDefault();
        target.click();
      }
      return;
    }
    if (BACK_KEYS.has(event.key) || BACK_KEY_CODES.has(event.keyCode)) {
      if (editing && event.key === "Backspace") return;
      const modal = activeModal(doc);
      if (modal) {
        event.preventDefault();
        if ("close" in modal && typeof modal.close === "function")
          modal.close();
        else modal.dispatchEvent(new Event("close", { bubbles: true }));
        return;
      }
      if (options.onBack) {
        event.preventDefault();
        options.onBack();
      }
    }
  };
  doc.addEventListener("keydown", onKeyDown);
  return () => doc.removeEventListener("keydown", onKeyDown);
}
