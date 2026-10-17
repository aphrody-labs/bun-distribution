// SPDX-License-Identifier: Apache-2.0
/** Console interaction, injectable so every flow can be tested with scripted answers. */

export interface Ui {
  say(line?: string): void;
  /** Free text answer; null when stdin is closed (no terminal). */
  ask(question: string): string | null;
  /** Yes/no question. Accepts o/oui/y/yes and n/non/no; an empty answer gives `fallback`. */
  confirm(question: string, fallback?: boolean): boolean;
  /** Wait for Enter so the window does not close under the reader's eyes. */
  pause(message?: string): void;
  /** True when a person can answer (a terminal on both ends). */
  readonly interactive: boolean;
}

export function parseYesNo(answer: string | null, fallback: boolean): boolean {
  if (answer === null) return fallback;
  const text = answer.trim().toLowerCase();
  if (text === "") return fallback;
  if (/^(o|oui|y|yes)$/.test(text)) return true;
  if (/^(n|non|no)$/.test(text)) return false;
  return fallback;
}

export function consoleUi(): Ui {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  return {
    interactive,
    say: (line = "") => console.log(line),
    ask: question => (interactive ? prompt(question) : null),
    confirm(question, fallback = false) {
      if (!interactive) return fallback;
      return parseYesNo(prompt(`${question} ${fallback ? "(O/n)" : "(o/N)"}`), fallback);
    },
    pause(message = "Appuie sur Entrée pour continuer...") {
      if (interactive) prompt(message);
    },
  };
}

export interface MemoryUi extends Ui {
  lines: string[];
  /** Questions asked, in order. */
  questions: string[];
}

/** Scripted UI: each ask/confirm consumes the next answer (null when exhausted). */
export function memoryUi(answers: (string | null)[] = [], interactive = true): MemoryUi {
  const queue = [...answers];
  const ui: MemoryUi = {
    interactive,
    lines: [],
    questions: [],
    say: (line = "") => void ui.lines.push(line),
    ask(question) {
      ui.questions.push(question);
      return queue.length > 0 ? (queue.shift() ?? null) : null;
    },
    confirm(question, fallback = false) {
      ui.questions.push(question);
      return parseYesNo(queue.length > 0 ? (queue.shift() ?? null) : null, fallback);
    },
    pause() {},
  };
  return ui;
}

export const MARK = {
  ok: "[OK]",
  warn: "[!] ",
  fail: "[X] ",
  wait: "[..]",
  skip: "[--]",
} as const;
