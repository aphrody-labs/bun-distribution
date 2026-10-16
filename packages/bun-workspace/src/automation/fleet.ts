import { join } from "node:path";
import { discoverAphrodyBinaries, type AphrodyBinary } from "./binaries.ts";
import { infraRoot } from "./runtime.ts";

export type Fleet = {
  generatedAt: string | undefined;
  repositories: string[];
  stages: Array<{ id: string; repositories: string[] }>;
  binaries: AphrodyBinary[];
};

type Ecosystem = { generatedAt?: string; repos?: Array<{ name?: string }> };
type Pipeline = {
  stages?: Array<{ id?: string; steps?: Array<{ repo?: string }> }>;
};

/** Read the Infra-owned catalogue rather than maintaining another repository registry. */
export async function loadFleet(root = infraRoot()): Promise<Fleet> {
  const [ecosystem, pipeline, binaries] = await Promise.all([
    Bun.file(join(root, "docs", "ecosystem", "ecosystem.json")).json() as Promise<Ecosystem>,
    Bun.file(join(root, "tools", "config", "pipeline.json")).json() as Promise<Pipeline>,
    discoverAphrodyBinaries(root),
  ]);
  return {
    generatedAt: ecosystem.generatedAt,
    repositories: (ecosystem.repos ?? []).flatMap(repo => (repo.name ? [repo.name] : [])).toSorted(),
    stages: (pipeline.stages ?? []).flatMap(stage =>
      stage.id
        ? [
            {
              id: stage.id,
              repositories: [
                ...new Set((stage.steps ?? []).flatMap(step => (step.repo ? [step.repo] : []))),
              ].toSorted(),
            },
          ]
        : [],
    ),
    binaries,
  };
}
