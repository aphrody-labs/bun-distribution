#!/usr/bin/env bun
import { join } from "node:path";
import { assertRuntime, loadConfig, repositoryRoot } from "./index.ts";
import {
  assetClient,
  planSharedAssets,
  publishSharedAssets,
} from "./assets.ts";

const deadline = setTimeout(() => process.exit(124), 300_000);
try {
  const [action = "plan"] = Bun.argv.slice(2);
  if (!["plan", "publish"].includes(action) || Bun.argv.length > 3)
    throw new Error("Use assets plan or publish.");
  const config = await loadConfig();
  assertRuntime(config);
  const plan = await planSharedAssets(config);
  const result =
    action === "publish"
      ? await publishSharedAssets(plan, assetClient(config))
      : undefined;
  await Bun.write(
    join(repositoryRoot, ".local", "assets", "manifest.json"),
    JSON.stringify(plan.manifest),
  );
  await Bun.write(
    join(repositoryRoot, ".local", "assets", "reference.json"),
    JSON.stringify(plan.reference),
  );
  console.log(
    JSON.stringify({
      reference: plan.reference,
      entries: plan.manifest.entries.length,
      objects: plan.files.size,
      bytes: [
        ...new Map(plan.manifest.entries.map((e) => [e.key, e.size])).values(),
      ].reduce((a, b) => a + b, 0),
      result,
    }),
  );
} catch {
  console.error(
    "Shared asset operation failed; check its owner manifest and protected R2 credentials.",
  );
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
}
