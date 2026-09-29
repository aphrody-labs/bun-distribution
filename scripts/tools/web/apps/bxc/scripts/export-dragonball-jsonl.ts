#!/usr/bin/env bun
/** Refresh the portable Shenron JSONL view from the BXC crawl database. */

import { join } from "node:path";
import { exportDragonBallJsonl } from "../src/archive/dragonball-export.ts";

const root = Bun.env.BXC_DRAGONBALL_OUTPUT_DIR ?? join(import.meta.dir, "..", "data", "dragonball-exhaustive");
// Do not inherit a generic BXC_DB_PATH here: the process may also be serving
// another crawler. This exporter must only ever project the Dragon Ball store.
const databasePath = Bun.env.BXC_DRAGONBALL_DB_PATH ?? join(root, "bxc.sqlite");
const outputPath = Bun.env.BXC_DRAGONBALL_JSONL_PATH ?? join(root, "shenron-documents.jsonl");

const count = await exportDragonBallJsonl(databasePath, outputPath);
console.log(JSON.stringify({ schema: "bxc-dragonball-jsonl-export/v1", databasePath, outputPath, count }));
