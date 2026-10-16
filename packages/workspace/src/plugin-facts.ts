// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  inside,
  object,
  plugins,
  readJson,
  type Json,
} from "./agent-plugin-store.ts";

type FactRecord = {
  plugin: string;
  status: string;
  message?: string;
  receipt?: Json;
};
const digest = (path: string): string =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

/** Compare declared knowledge inputs and published plugin guidance with a reviewed receipt. */
export function checkPluginFacts(store: string, only?: string): FactRecord[] {
  const lockPath = join(store, "_state/facts-lock.json");
  const lock = existsSync(lockPath) ? readJson(lockPath) : {};
  return plugins(store)
    .filter((p) => !only || p.name === only)
    .map((plugin) => {
      const sourcePath = join(plugin.path, "source-of-truth.json");
      if (!existsSync(sourcePath))
        return {
          plugin: plugin.name,
          status: "undocumented",
          message:
            "Add source-of-truth.json with owner roots and evidence files",
        };
      try {
        const declaration = readJson(sourcePath);
        if (
          declaration.version !== 1 ||
          !Array.isArray(declaration.sources) ||
          !declaration.sources.length
        )
          throw new Error("Expected version 1 and a non-empty sources list");
        const inputs: Record<string, string> = {};
        for (const raw of declaration.sources) {
          const source = object(raw);
          if (
            typeof source.root !== "string" ||
            !Array.isArray(source.evidence) ||
            !source.evidence.length
          )
            throw new Error("Each source needs root and evidence paths");
          // Relative roots are plugin-local, so a portable plugin needs no host path.
          const root = resolve(plugin.path, source.root);
          for (const item of source.evidence) {
            if (typeof item !== "string")
              throw new Error("Evidence paths must be strings");
            const path = resolve(root, item);
            if (!inside(root, path) || !existsSync(path))
              throw new Error(`Missing/outside evidence: ${item}`);
            inputs[`${root}:${item}`] = digest(path);
          }
        }
        const knowledge = Array.isArray(declaration.knowledge)
          ? declaration.knowledge
          : [];
        if (!knowledge.length)
          throw new Error("List plugin knowledge files to keep source-aligned");
        for (const item of knowledge) {
          if (typeof item !== "string")
            throw new Error("Knowledge paths must be strings");
          const path = resolve(plugin.path, item);
          if (!inside(plugin.path, path) || !existsSync(path))
            throw new Error(`Missing/outside knowledge file: ${item}`);
          inputs[`plugin:${item}`] = digest(path);
        }
        const receipt = { version: 1, inputs };
        const prior = object(lock[plugin.name] ?? {});
        if (JSON.stringify(prior) !== JSON.stringify(receipt))
          return {
            plugin: plugin.name,
            status: "stale",
            message:
              "Sources or knowledge changed; verify claims against evidence, then refresh the receipt",
            receipt,
          };
        return { plugin: plugin.name, status: "current", receipt };
      } catch (error) {
        return {
          plugin: plugin.name,
          status: "invalid",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    });
}

/** Refresh a receipt only after the operator has reviewed the declared source material. */
export function refreshPluginFacts(
  store: string,
  only: string | undefined,
  apply: boolean,
): FactRecord[] {
  const checked = checkPluginFacts(store, only);
  const lockPath = join(store, "_state/facts-lock.json");
  const lock: Json = existsSync(lockPath) ? readJson(lockPath) : {};
  const updates: FactRecord[] = [];
  for (const result of checked) {
    if (!result.receipt) {
      updates.push(result);
      continue;
    }
    lock[result.plugin] = result.receipt;
    updates.push({ ...result, status: apply ? "current" : "planned" });
  }
  if (apply) {
    mkdirSync(join(store, "_state"), { recursive: true });
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, {
      mode: 0o600,
    });
  }
  return updates;
}
