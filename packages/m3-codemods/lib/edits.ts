// SPDX-License-Identifier: Apache-2.0
/**
 * lib/edits.ts — éditions de texte positionnées et contrôle de validité par `Bun.Transpiler`.
 */

export interface Edit {
  start: number;
  end: number;
  /** Texte de remplacement ; une fonction est évaluée à l'application (après la collecte complète). */
  text: string | (() => string);
}

export class Edits {
  readonly list: Edit[] = [];
  private readonly active = new Set<Edit>();

  constructor(readonly src: string) {}

  insert(at: number, text: string | (() => string)): void {
    this.list.push({ start: at, end: at, text });
  }

  replace(start: number, end: number, text: string | (() => string)): void {
    this.list.push({ start, end, text });
  }

  /**
   * `src[start, end)` with the edits that fall inside it. Insertions at the same position keep their
   * order of registration and come before a replacement that starts there; an edit inside a range
   * already replaced is dropped.
   */
  render(start = 0, end = this.src.length): string {
    const edits = this.list
      .map((edit, order) => ({ edit, order }))
      .filter(({ edit }) => edit.start >= start && edit.end <= end)
      // oxlint-disable-next-line unicorn/no-array-sort -- Sorts a fresh copy.
      .sort(
        (a, b) =>
          a.edit.start - b.edit.start ||
          Number(a.edit.end > a.edit.start) -
            Number(b.edit.end > b.edit.start) ||
          a.order - b.order,
      );
    let out = "";
    let cursor = start;
    for (const { edit } of edits) {
      // An edit whose text is being computed renders its own range: skip it there.
      if (edit.start < cursor || this.active.has(edit)) continue;
      out += this.src.slice(cursor, edit.start);
      if (typeof edit.text === "function") {
        this.active.add(edit);
        try {
          out += edit.text();
        } finally {
          this.active.delete(edit);
        }
      } else out += edit.text;
      cursor = edit.end;
    }
    return out + this.src.slice(cursor, end);
  }
}

const transpiler = new Bun.Transpiler({ loader: "tsx" });

/** Throw a `SyntaxError` when `source` is not valid TSX for Bun's parser. */
export function assertTsx(source: string, what: string): void {
  try {
    transpiler.transformSync(source);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new SyntaxError(`${what}: TSX invalide (${detail})`);
  }
}
