if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Shenron Discord Bot + Public API`);
  console.log(`Usage: shenron [options]\n`);
  console.log(`Options:`);
  console.log(`  -h, --help     Show this help message`);
  console.log(`  -v, --version  Show version and runtime info`);
  console.log(`  --dry-run      Validate environment and exit without services or Discord login`);
  process.exit(0);
}

if (process.argv.includes("--version") || process.argv.includes("-v")) {
  console.log(
    `@shenron/bot v1.0.0 (Bun ${typeof Bun !== "undefined" ? Bun.version : process.version})`,
  );
  process.exit(0);
}

if (process.argv.includes("--dry-run")) {
  // This owner only validates the environment; importing index starts databases,
  // migrations and Discord. Keep every runtime import after this early exit.
  await import("./lib/env");
  console.log("Configuration valid. No databases, migrations, services or Discord login started.");
  process.exit(0);
}

await import("reflect-metadata");
await import("./index");
