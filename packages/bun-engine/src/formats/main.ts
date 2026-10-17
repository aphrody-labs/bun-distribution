#!/usr/bin/env bun
// Entry point of the `bun-engine-formats` single-file executable.
import { runFormats } from "./cli";

try {
  process.exitCode = await runFormats(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
