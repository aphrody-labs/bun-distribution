if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Rose Griffon Discord Bot`);
  console.log(`Usage: rg-bot [options]\n`);
  console.log(`Options:`);
  console.log(`  -h, --help     Show this help message`);
  console.log(`  -v, --version  Show version and runtime info`);
  console.log(`  --dry-run      Validate configuration and exit`);
  process.exit(0);
}

if (process.argv.includes("--version") || process.argv.includes("-v")) {
  console.log(`@rosegriffon/bot v1.0.1 (Bun ${typeof Bun !== "undefined" ? Bun.version : process.version})`);
  process.exit(0);
}

import "reflect-metadata";
await import("./index");
