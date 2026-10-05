import { statSync } from "node:fs";
import { join } from "node:path";

const env = { ...process.env, SKIP_NETWORK_TESTS: "1" };
for (const key of [
	"http_proxy",
	"https_proxy",
	"all_proxy",
	"HTTP_PROXY",
	"HTTPS_PROXY",
	"ALL_PROXY",
]) {
	delete env[key];
}

// The bridge loader prefers an installed library (`bxc install`) over the source
// tree's cargo output. A stale install then fails every FFI test with an ABI
// mismatch, so pin the freshest in-tree `aphrody-web-ffi` build when one exists.
// An explicit BXC_RUST_BRIDGE_LIB still wins.
if (!env.BXC_RUST_BRIDGE_LIB) {
	const file =
		process.platform === "win32"
			? "aphrody_web_ffi.dll"
			: process.platform === "darwin"
				? "libaphrody_web_ffi.dylib"
				: "libaphrody_web_ffi.so";
	const target = join(import.meta.dir, "..", "..", "..", "target");
	const built = ["debug", "release"]
		.map((profile) => join(target, profile, file))
		.flatMap((path) => {
			try {
				const stat = statSync(path);
				return stat.size > 0 ? [{ path, mtime: stat.mtimeMs }] : [];
			} catch {
				return [];
			}
		})
		.toSorted((a, b) => b.mtime - a.mtime);
	if (built[0]) env.BXC_RUST_BRIDGE_LIB = built[0].path;
}

const processHandle = Bun.spawn(
	[
		process.execPath,
		"test",
		"test/",
		"../../packages/x",
		"../../packages/bxc-test",
		"src/",
		"--path-ignore-patterns",
		"vendor/**",
		"--path-ignore-patterns",
		"third_party/**",
	],
	{ cwd: import.meta.dir + "/..", env, stdout: "inherit", stderr: "inherit" },
);

process.exitCode = await processHandle.exited;
