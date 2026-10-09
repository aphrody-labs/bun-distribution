// SPDX-License-Identifier: Apache-2.0
export interface Person {
  id: string;
  name: string;
  role: string;
  city: string;
  joined: number;
}

const FIRST = ["Ada", "Grace", "Alan", "Linus", "Margaret", "Ken", "Barbara", "Dennis", "Frances", "Edsger"];
const LAST = ["Lovelace", "Hopper", "Turing", "Torvalds", "Hamilton", "Thompson", "Liskov", "Ritchie", "Allen", "Dijkstra"];
const ROLES = ["Engineer", "Designer", "Researcher", "Manager"];
const CITIES = ["Paris", "Lyon", "Berlin", "Tokyo", "Montréal"];

/** Deterministic sample data (no I/O): 120 people. */
export const PEOPLE: readonly Person[] = Array.from({ length: 120 }, (_, i) => ({
  id: String(i + 1),
  name: `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`,
  role: ROLES[i % ROLES.length]!,
  city: CITIES[(i * 3) % CITIES.length]!,
  joined: 2010 + (i % 16),
}));

export const findPerson = (id: string) => PEOPLE.find(p => p.id === id);
