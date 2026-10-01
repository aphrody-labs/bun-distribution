#!/usr/bin/env bun
const args = process.argv.slice(2);
const command = args.join(" ");

if (command === "--version") {
	process.stdout.write("bxc 0.0.0-fixture\n");
	process.exit(0);
}

if (command === "frames stats --json" || command === "web frames stats --json") {
	process.stdout.write(
		JSON.stringify({ path: "/fixture/frames.sqlite", media: 1, frames: 8, durationMs: 12 })
	);
	process.exit(0);
}

process.stderr.write(`Unexpected BXC fixture command: ${command}\n`);
process.exit(64);
