// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";

import {
  TRAIN_TYPES,
  TRAIN_TYPE_IDS,
  isTrainType,
  newJobId,
  parseJobs,
  planLines,
  trainFlags,
  validateRequest,
  type TrainRequest,
} from "../../src/admin/lib/train.ts";
import { samplePack } from "./helpers.ts";

const hosts = samplePack().hosts;
const base = (extra: Partial<TrainRequest> = {}): TrainRequest => ({
  type: "test",
  host: "gpu",
  id: "kit-20261006-120000-test",
  steps: 10,
  allowCpu: true,
  ...extra,
});

test("every type maps to an aphrody train run kind and the owner's inputs", () => {
  expect(TRAIN_TYPE_IDS.map((type) => TRAIN_TYPES[type].kind)).toEqual([
    "dry-run",
    "embed",
    "rerank",
    "lora",
    "triples",
    "dataset-rollouts",
    "dataset-dpo",
  ]);
  expect(isTrainType("lora")).toBe(true);
  expect(isTrainType("promote")).toBe(false);
  expect(isTrainType("__proto__")).toBe(false);
});

test("the CLI never offers promotion, registry migration or deletion", () => {
  const kinds = TRAIN_TYPE_IDS.map((type) => TRAIN_TYPES[type].kind).join(" ");
  expect(kinds).not.toMatch(/promote|migrate|rm|delete/);
});

test("job ids are timestamped and safe", () => {
  expect(newJobId("embeddings", new Date("2026-10-06T12:34:56Z"))).toBe(
    "kit-20261006-123456-embeddings",
  );
});

test("flags follow `aphrody train run`", () => {
  expect(trainFlags(base())).toEqual([
    "--kind",
    "dry-run",
    "--id",
    "kit-20261006-120000-test",
    "--steps",
    "10",
    "--allow-cpu",
  ]);
  const lora = base({
    type: "lora",
    entree: "data/rollouts",
    reference: "data/gold.jsonl",
    modeleBase: "models/qwen",
    allowCpu: false,
    steps: 200,
  });
  expect(trainFlags(lora)).toEqual([
    "--kind",
    "lora",
    "--id",
    "kit-20261006-120000-test",
    "--steps",
    "200",
    "--input",
    "data/rollouts",
    "--gold",
    "data/gold.jsonl",
    "--base-model",
    "models/qwen",
  ]);
});

test("validation lists what is missing or unsafe, in French", () => {
  expect(validateRequest(base(), hosts)).toEqual([]);
  expect(validateRequest(base({ type: "lora" }), hosts)).toHaveLength(3);
  expect(
    validateRequest(base({ type: "embeddings", entree: "a;b" }), hosts).join(
      " ",
    ),
  ).toContain("chemin");
  expect(validateRequest(base({ steps: 0 }), hosts).join(" ")).toContain(
    "étapes",
  );
  expect(validateRequest(base({ steps: 1.5 }), hosts).join(" ")).toContain(
    "étapes",
  );
  expect(validateRequest(base({ host: "ghost" }), hosts).join(" ")).toContain(
    "serveur inconnu",
  );
  expect(validateRequest(base({ id: "Bad Id" }), hosts).join(" ")).toContain(
    "numéro",
  );
  expect(
    validateRequest(base({ domaine: "x; id" }), hosts).join(" "),
  ).toContain("domaine");
  expect(
    validateRequest(
      base({ type: "lora", entree: "d", reference: "g", modeleBase: "../x" }),
      hosts,
    ).join(" "),
  ).toContain("modèle");
  expect(
    validateRequest(
      base({
        type: "lora",
        entree: "d",
        reference: "g",
        modeleBase: "Qwen/Qwen3-Coder-30B-A3B-Instruct",
      }),
      hosts,
    ),
  ).toEqual([]);
});

test("the plan says what, where, and that nothing is deleted; GPU jobs warn about suspended inference", () => {
  const host = hosts.gpu!;
  const lines = planLines(
    base({ type: "embeddings", entree: "data/t.jsonl" }),
    host,
  );
  const text = lines.join("\n");
  expect(text).toContain("Modèle d'embeddings");
  expect(text).toContain("omar@198.51.100.2");
  expect(text).toContain("/usr/local/bin/aphrody train run --kind embed");
  expect(text).toContain("rien n'est supprimé ni écrasé");
  expect(text).toContain("suspendus");
  expect(planLines(base(), host).join("\n")).not.toContain("suspendus");
});

test("parseJobs reads the status lines and ignores noise", () => {
  const out = [
    "HOTE|gpu-1",
    'JOB|kit-a|test|termine|2026-10-06T12:00:00Z|{"event":"done"}',
    "JOB|kit-b|lora|en-cours|2026-10-06T13:00:00Z|a|b|c",
    "JOB|kit-c|test|weird|x|y",
    "garbage",
  ].join("\n");
  const parsed = parseJobs(out);
  expect(parsed.host).toBe("gpu-1");
  expect(parsed.jobs.map((job) => job.state)).toEqual(["termine", "en-cours"]);
  expect(parsed.jobs[1]!.last).toBe("a|b|c");
});
