// SPDX-License-Identifier: Apache-2.0
// Mass scripting with @aphrody/x: look up many handles with bounded concurrency, retry and a
// resumable checkpoint, all inside the Rust runner (aphrody-x) reached through aphrody-ffi.
//
//   X_AUTH_TOKEN=... X_CT0=... bun examples/x-batch.ts handles.txt users.jsonl
//
// Run it again after an interruption: results already in users.jsonl are replayed, not fetched.
import { XClient, xBatch } from "@aphrody/x";

const [handlesFile = "handles.txt", checkpoint = "users.jsonl"] = process.argv.slice(2);
const handles = (await Bun.file(handlesFile).text())
  .split("\n")
  .map((line) => line.trim().replace(/^@/, ""))
  .filter(Boolean);

const client = new XClient(); // credentials discovered by Rust, like `aphrody x`
const run = xBatch(
  client,
  handles.map((handle) => ({ id: handle, op: "user_by_screen_name", args: { handle } })),
  {
    concurrency: 8,
    checkpoint,
    onProgress: ({ completed, total }) => process.stderr.write(`\r${completed}/${total}`),
  },
);

for await (const result of run) {
  if (result.ok) console.log(JSON.stringify(result.data));
  else console.error(`\n${result.id}: ${result.error.kind}: ${result.error.message}`);
}
console.error(`\n${JSON.stringify(run.summary)}`);
client.close();
