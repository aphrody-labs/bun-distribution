// SPDX-License-Identifier: Apache-2.0
// Worker thread of the windex pool: analyses batches of entries, or runs the deferred catalog-signature lookups.
import { analyze, type Task } from "./analyze.ts";
import { catalogSignature } from "./catalog.ts";

declare const self: Worker;

type Message = { id: number; tasks: Task[] } | { id: number; catalog: string[] };

self.onmessage = (event: MessageEvent<Message>) => {
  const m = event.data;
  if ("catalog" in m) {
    self.postMessage({ id: m.id, records: m.catalog.map((p) => catalogSignature(p)) });
    return;
  }
  self.postMessage({ id: m.id, records: m.tasks.map((t) => analyze(t)) });
};
