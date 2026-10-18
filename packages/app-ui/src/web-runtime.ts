// SPDX-License-Identifier: Apache-2.0
// Web runtime that replaces the Tauri IPC surface for the web build. Every export has the shape its callers expect;
// native-only operations resolve to their web equivalent or to an explicit "unavailable" result.

/** Listener handle returned by `listen`. */
export type UnlistenFn = () => void;

/** Event delivered to `listen` handlers. */
export interface Event<T> {
  event: string;
  id: number;
  payload: T;
}

const listeners = new Map<string, Set<(event: Event<unknown>) => void>>();

/** In-page event bus (the desktop emitted these events over IPC; on the web they are local). */
export async function listen<T>(name: string, handler: (event: Event<T>) => void): Promise<UnlistenFn> {
  const set = listeners.get(name) ?? new Set();
  set.add(handler as (event: Event<unknown>) => void);
  listeners.set(name, set);
  return () => {
    set.delete(handler as (event: Event<unknown>) => void);
  };
}

/** Deliver an event to the listeners of `name` in this page. */
export async function emitTo(_target: string, name: string, payload?: unknown): Promise<void> {
  for (const handler of listeners.get(name) ?? []) handler({ event: name, id: 0, payload });
}

/** Ordered message channel, with the same `onmessage` slot the desktop API exposed. */
export class Channel<T> {
  onmessage: (message: T) => void = () => {};
}

/** Native commands do not exist on the web: callers receive a rejected promise they already handle. */
export async function invoke<T>(command: string, _args?: Record<string, unknown>): Promise<T> {
  throw new Error(`Native command unavailable on the web: ${command}`);
}

/** File picker: the browser cannot return a host path, so the picker resolves to null. */
export async function open(_options?: unknown): Promise<string | null> {
  return null;
}

/** Window handle: the web page is its own window. */
export function getCurrentWindow(): {
  label: string;
  close(): Promise<void>;
  setFocus(): Promise<void>;
  /** Window dragging belongs to the OS window manager; the browser tab cannot be dragged. */
  startDragging(): Promise<void>;
} {
  return {
    label: "main",
    close: async () => window.close(),
    setFocus: async () => window.focus(),
    startDragging: async () => {},
  };
}
