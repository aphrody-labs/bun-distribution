"use client";

import { useSyncExternalStore } from "react";

let timestamp = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
function notify() {
  timestamp = Date.now();
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) timer = setInterval(notify, 60_000);
  notify();
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}
const getSnapshot = () => timestamp;
const getServerSnapshot = () => 0;
/** A shared minute clock; SSR stays deterministic until hydration. */
export function useClock(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
