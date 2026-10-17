// SPDX-License-Identifier: Apache-2.0
/**
 * Kit bridge of the Aphrody desktop app (protocol `aphrody.kit/1`).
 *
 * The desktop (`crates/ui/app/src/kits.rs`) starts `<kit> desktop catalog` or `<kit> desktop run <action> [input-json]`
 * with piped stdio. The kit writes one JSON event per stdout line and reads one JSON answer per stdin line when it
 * asks a question; any other stdout line is shown as text. The kit keeps its logic: the desktop only renders the
 * catalog as M3 panels, the questions as M3 dialogs and the lines as a log. Shared by creator-kit and omar-kit.
 */
import { readSync, writeSync } from "node:fs";

export const KIT_PROTOCOL = "aphrody.kit/1";

export type KitFieldKind = "text" | "path" | "url" | "number" | "select" | "boolean";

export interface KitField {
  name: string;
  label: string;
  kind: KitFieldKind;
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
  /** CLI flag the value is passed with (`--out`); absent: positional, in field order. */
  flag?: string;
  /** Comma separated values become one flag each (`--category a --category b`). */
  repeat?: boolean;
  default?: string | boolean;
}

export interface KitAction {
  id: string;
  group: string;
  title: string;
  description?: string;
  icon?: string;
  fields?: KitField[];
  /** Shown as a dialog before the run; `typed` must be typed back to continue. */
  confirm?: { message: string; typed?: string };
  /** Runs until stopped (a bot): the desktop shows a stop button. */
  longRunning?: boolean;
  windowsOnly?: boolean;
}

export interface KitGroup {
  id: string;
  title: string;
  icon: string;
}

export interface KitCatalog {
  protocol: typeof KIT_PROTOCOL;
  kit: string;
  title: string;
  version: string;
  platform: string;
  groups: KitGroup[];
  actions: KitAction[];
  /** omar-kit: the team's access pack is imported, so the admin surface is shown in the navigation. */
  admin?: boolean;
}

export type KitAskKind = "text" | "confirm" | "typed";

export type KitEvent =
  | { type: "catalog"; catalog: KitCatalog }
  | { type: "say"; text: string; stream?: "out" | "err" }
  | {
      type: "ask";
      id: number;
      kind: KitAskKind;
      question: string;
      expect?: string;
      fallback?: boolean;
    }
  | { type: "done"; code: number }
  | { type: "error"; message: string };

export type KitInput = Record<string, string | boolean | undefined>;

/** Where events go and answers come from; injectable for tests. */
export interface KitChannel {
  emit(event: KitEvent): void;
  /** One answer line; null when the desktop closed stdin (cancel). */
  read(): string | null;
}

function readLineSync(fd = 0): string | null {
  const byte = Buffer.alloc(1);
  const bytes: number[] = [];
  for (;;) {
    let count = 0;
    try {
      count = readSync(fd, byte, 0, 1, null);
    } catch {
      return null;
    }
    if (count === 0) return bytes.length > 0 ? Buffer.from(bytes).toString("utf8") : null;
    if (byte[0] === 10) return Buffer.from(bytes).toString("utf8").replace(/\r$/, "");
    bytes.push(byte[0]!);
  }
}

export function stdioChannel(): KitChannel {
  return {
    emit: event => void writeSync(1, `${JSON.stringify(event)}\n`),
    read: () => readLineSync(0),
  };
}

export function memoryChannel(answers: (string | null)[] = []): KitChannel & { events: KitEvent[] } {
  const queue = [...answers];
  const events: KitEvent[] = [];
  return {
    events,
    emit: event => void events.push(event),
    read: () => {
      const answer = queue.length > 0 ? (queue.shift() ?? null) : null;
      return answer === null ? null : JSON.stringify({ answer });
    },
  };
}

/** Questions whose answer must be typed back (« Tape OUI ») become typed confirmations. */
export function askKind(question: string): {
  kind: KitAskKind;
  expect?: string;
} {
  const typed = /\bTape (OUI)\b/.exec(question);
  return typed ? { kind: "typed", expect: typed[1] } : { kind: "text" };
}

let askSequence = 0;

/** Ask the desktop and wait for its answer; null when cancelled. */
export function ask(
  channel: KitChannel,
  kind: KitAskKind,
  question: string,
  extra: { expect?: string; fallback?: boolean } = {},
): string | null {
  askSequence += 1;
  channel.emit({ type: "ask", id: askSequence, kind, question, ...extra });
  const line = channel.read();
  if (line === null) return null;
  try {
    const answer = (JSON.parse(line) as { answer?: unknown }).answer;
    return typeof answer === "string" ? answer : null;
  } catch {
    return null;
  }
}

/** Lines printed by `console.*` while a kit command runs become `say` events (creator-kit commands print, they do not ask). */
export async function captureConsole<T>(channel: KitChannel, run: () => Promise<T>): Promise<T> {
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  const say =
    (stream: "out" | "err") =>
    (...parts: unknown[]) => {
      const text = parts.map(part => (typeof part === "string" ? part : Bun.inspect(part))).join(" ");
      for (const line of text.split("\n")) channel.emit({ type: "say", text: line, stream });
    };
  console.log = say("out");
  console.info = say("out");
  console.warn = say("err");
  console.error = say("err");
  try {
    return await run();
  } finally {
    Object.assign(console, original);
  }
}

/** CLI arguments of one action from the desktop form: positionals in field order, then flags. */
export function argvFor(base: string[], fields: KitField[] = [], input: KitInput = {}): string[] {
  const positionals: string[] = [];
  const flags: string[] = [];
  for (const field of fields) {
    const raw = input[field.name] ?? field.default;
    if (raw === undefined || raw === "" || raw === false) {
      if (field.required) throw new KitInputError(`« ${field.label} » est obligatoire.`);
      continue;
    }
    if (field.kind === "boolean") {
      if (raw === true || raw === "true") flags.push(field.flag ?? `--${field.name}`);
      continue;
    }
    const text = String(raw).trim();
    if (text === "") continue;
    if (field.kind === "number" && !/^\d+(?:\.\d+)?$/.test(text))
      throw new KitInputError(`« ${field.label} » doit être un nombre.`);
    if (field.kind === "select" && field.options && !field.options.some(o => o.value === text))
      throw new KitInputError(`« ${field.label} » : valeur inconnue.`);
    const values = field.repeat
      ? text
          .split(",")
          .map(value => value.trim())
          .filter(Boolean)
      : [text];
    for (const value of values) {
      if (field.flag) flags.push(field.flag, value);
      else positionals.push(value);
    }
  }
  return [...base, ...positionals, ...flags];
}

export class KitInputError extends Error {}

export interface KitBridge {
  catalog(): KitCatalog | Promise<KitCatalog>;
  run(action: KitAction, input: KitInput, channel: KitChannel): Promise<number>;
}

/** `desktop catalog` | `desktop run <action> [input-json]`. Every outcome ends with a `done` event. */
export async function runDesktop(
  argv: string[],
  bridge: KitBridge,
  channel: KitChannel = stdioChannel(),
): Promise<number> {
  const [verb, actionId, inputJson] = argv;
  let code = 2;
  try {
    const catalog = await bridge.catalog();
    if (verb === "catalog") {
      channel.emit({ type: "catalog", catalog });
      code = 0;
    } else if (verb === "run") {
      const action = catalog.actions.find(entry => entry.id === actionId);
      if (!action) throw new KitInputError(`Action inconnue : ${actionId ?? "(aucune)"}`);
      const input = inputJson ? (JSON.parse(inputJson) as unknown) : {};
      if (!input || typeof input !== "object" || Array.isArray(input))
        throw new KitInputError("Les valeurs du formulaire doivent être un objet JSON.");
      code = await bridge.run(action, input as KitInput, channel);
    } else {
      throw new KitInputError(`Usage : desktop catalog | desktop run <action> [json]`);
    }
  } catch (error) {
    channel.emit({ type: "error", message: (error as Error).message });
    code = error instanceof KitInputError ? 2 : 1;
  }
  channel.emit({ type: "done", code });
  return code;
}
