if (process.argv.includes("--help") || process.argv.includes("-h")) {
	console.log(`Shenron Discord Bot + Public API`);
	console.log(`Usage: shenron [options]\n`);
	console.log(`Options:`);
	console.log(`  -h, --help     Show this help message`);
	console.log(`  -v, --version  Show version and runtime info`);
	console.log(`  --dry-run      Validate configuration and exit`);
	process.exit(0);
}

if (process.argv.includes("--version") || process.argv.includes("-v")) {
	console.log(`@shenron/bot v1.0.0 (Bun ${typeof Bun !== "undefined" ? Bun.version : process.version})`);
	process.exit(0);
}

import "reflect-metadata";
await import("./index");
