#!/usr/bin/env bun
import { runEnginePackageManager } from "./package-manager";

async function main(): Promise<void> {
  process.exitCode = await runEnginePackageManager(process.argv.slice(2));
}

void main();
