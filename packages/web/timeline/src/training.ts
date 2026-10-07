// SPDX-License-Identifier: Apache-2.0
import { trainingRows, type Snapshot, type TrainingOptions } from "./model.ts";

const jsonl = (rows: unknown[]) => rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
const checksum = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex");

/** Prepared LoRA inputs consumed by the existing aphrody_train.lora loader. */
export function trainingArtifacts(snapshot: Snapshot, options: TrainingOptions = {}) {
  const examples = trainingRows(snapshot, options);
  const rollouts = examples
    .filter((row) => row.split === "train")
    .map((row) => ({
      sourceId: row.sourceId,
      generation: row.generation,
      source: row.source,
      session: `timeline:${snapshot.generation}`,
      prompt: row.messages[0]!.content,
      messages: row.messages.map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      })),
    }));
  const gold = examples.flatMap((row, index) =>
    row.split === "eval"
      ? [
          {
            sourceId: row.sourceId,
            q: row.messages[0]!.content,
            // The trainer removes URL fragments. The detail API identifies each age separately.
            expected_url: snapshot.entries[index]!.api,
            answer: row.messages[1]!.content,
            source: row.source,
          },
        ]
      : [],
  );
  const rolloutJsonl = jsonl(rollouts);
  const goldJsonl = jsonl(gold);
  return {
    examples,
    rolloutJsonl,
    goldJsonl,
    manifest: {
      schemaVersion: 1,
      generation: snapshot.generation,
      loader: "aphrody_train.lora.load_examples",
      prepared: {
        path: "prepared/rollouts.jsonl",
        examples: rollouts.length,
        sha256: checksum(rolloutJsonl),
      },
      gold: { path: "gold.jsonl", examples: gold.length, sha256: checksum(goldJsonl) },
      hasBothSplits: rollouts.length > 0 && gold.length > 0,
      trainingPerformed: false,
    },
  };
}
