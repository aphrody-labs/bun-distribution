// SPDX-License-Identifier: Apache-2.0
// Worker thread of the windex pool: receives batches of tasks, answers with analysed records.
import { analyze, type Task } from "./analyze.ts";

declare const self: Worker;

self.onmessage = (event: MessageEvent<{ id: number; tasks: Task[] }>) => {
  const { id, tasks } = event.data;
  const records = tasks.map((t) => analyze(t));
  self.postMessage({ id, records });
};
