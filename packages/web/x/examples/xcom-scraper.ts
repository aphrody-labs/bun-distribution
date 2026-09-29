/** Collect an X profile through the canonical Aphrody Web CLI. */
import { write } from "bun";

async function main() {
	const username = process.argv[2] ?? "x";
	const url = `https://x.com/${encodeURIComponent(username)}`;
	const artifactPath = `./${username}-profile.artifact.json`;
	const child = Bun.spawn([
		Bun.env.APHRODY_WEB_BIN ?? "aphrody-web",
		"fetch",
		url,
		"--dump",
		"artifact",
		"--quiet",
	], { stdout: "pipe", stderr: "inherit" });

	const output = await new Response(child.stdout).text();
	if (await child.exited !== 0) {
		process.exitCode = 1;
		return;
	}

	await write(artifactPath, output);
	console.log(`Artifact written to ${artifactPath}`);
	console.log(`Static inspection: n2b web ${artifactPath} --report json`);
}

if (import.meta.main) await main();
