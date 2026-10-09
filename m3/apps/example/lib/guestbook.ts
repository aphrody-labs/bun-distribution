// SPDX-License-Identifier: Apache-2.0
export interface Entry {
  name: string;
  message: string;
  at: number;
}

/** In-memory guestbook of this process. */
const entries: Entry[] = [];

export const listEntries = (): readonly Entry[] => entries;

export function addEntry(name: string, message: string): Entry {
  const entry = { name: name.slice(0, 40), message: message.slice(0, 280), at: Date.now() };
  entries.unshift(entry);
  entries.length = Math.min(entries.length, 50);
  return entry;
}
