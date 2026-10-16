// SPDX-License-Identifier: Apache-2.0
/** Bytes a terminal sends for a key press; null when the key is not a terminal input. */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

const SEQUENCES: Record<string, string> = {
  Enter: "\r",
  Backspace: "\x7f",
  Tab: "\t",
  Escape: "\x1b",
  ArrowUp: "\x1b[A",
  ArrowDown: "\x1b[B",
  ArrowRight: "\x1b[C",
  ArrowLeft: "\x1b[D",
  Home: "\x1b[H",
  End: "\x1b[F",
  Delete: "\x1b[3~",
};

export function keyToInput(event: KeyLike): string | null {
  if (event.metaKey) return null;
  const sequence = SEQUENCES[event.key];
  if (sequence !== undefined) return sequence;
  if (event.ctrlKey && event.key.length === 1) {
    const code = event.key.toUpperCase().charCodeAt(0);
    return code >= 64 && code <= 95 ? String.fromCharCode(code - 64) : null;
  }
  if (event.key.length === 1 || [...event.key].length === 1) {
    return event.altKey ? `\x1b${event.key}` : event.key;
  }
  return null;
}
