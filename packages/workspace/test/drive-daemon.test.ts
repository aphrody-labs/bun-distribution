// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDriveDaemon } from "../src/drive-daemon";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

test("Drive daemon builds from the nested workspace through serialized Cargo", async () => {
  const root = mkdtempSync(join(tmpdir(), "aphrody-drive-owner-"));
  roots.push(root);
  const drive = join(root, "crates/os/kernel/comps/drive");
  const scripts = join(root, "scripts/build/rust");
  mkdirSync(drive, { recursive: true });
  mkdirSync(scripts, { recursive: true });
  writeFileSync(join(root, "Cargo.toml"), "[workspace]\n");
  writeFileSync(join(drive, "Cargo.toml"), "[workspace]\n");
  const windows = process.platform === "win32";
  const exe = windows ? ".exe" : "";
  writeFileSync(
    join(scripts, "cargo-serial.ts"),
    [
      `await Bun.write(${JSON.stringify(join(root, "invocation"))}, Bun.argv.slice(2).join("\\n") + "\\n");`,
      `await Bun.write(${JSON.stringify(join(root, "rustc-env"))}, process.env.RUSTC_WRAPPER ?? "");`,
      'await Bun.write(`${process.env.CARGO_TARGET_DIR}/debug/sd-daemon.exe`, "daemon");',
      "",
    ].join("\n"),
  );
  const wrapper = join(scripts, "cargo-serial.sh");
  writeFileSync(
    wrapper,
    `#!/bin/sh
printf '%s\\n' "$@" > '${root}/invocation'
printf '%s' "\${RUSTC_WRAPPER-}" > '${root}/rustc-env'
mkdir -p "$CARGO_TARGET_DIR/debug"
printf 'daemon' > "$CARGO_TARGET_DIR/debug/sd-daemon"
`,
  );
  chmodSync(wrapper, 0o755);
  const previous = Bun.env.RUSTC_WRAPPER;
  // The root target directory is the checkout default, not an operator-wide CARGO_TARGET_DIR.
  const previousTarget = Bun.env.CARGO_TARGET_DIR;
  Bun.env.RUSTC_WRAPPER = "test-sccache-wrapper";
  delete Bun.env.CARGO_TARGET_DIR;
  try {
    expect(await runDriveDaemon(["--root", root, "--debug"])).toBe(0);
    const invocation = readFileSync(join(root, "invocation"), "utf8");
    expect(invocation).toContain(
      `--manifest-path\n${join(drive, "Cargo.toml")}\n`,
    );
    expect(invocation).toContain("-p\nsd-core\n--bin\nsd-daemon\n--locked\n");
    expect(readFileSync(join(root, "rustc-env"), "utf8")).toBe(
      "test-sccache-wrapper",
    );
    const host = /^host: (.+)$/m.exec(
      Bun.spawnSync(["rustc", "-vV"], { windowsHide: true }).stdout.toString(),
    )?.[1];
    expect(host).toBeDefined();
    expect(
      existsSync(
        join(root, "crates/ui/app/binaries", `sd-daemon-${host}${exe}`),
      ),
    ).toBe(true);
    expect(existsSync(join(root, `target/debug/sd-daemon${exe}`))).toBe(true);
  } finally {
    if (previous === undefined) delete Bun.env.RUSTC_WRAPPER;
    else Bun.env.RUSTC_WRAPPER = previous;
    if (previousTarget !== undefined) Bun.env.CARGO_TARGET_DIR = previousTarget;
  }
});

test("Drive daemon rejects a retired checkout layout", async () => {
  const root = mkdtempSync(join(tmpdir(), "aphrody-drive-legacy-"));
  roots.push(root);
  mkdirSync(join(root, "drive"));
  writeFileSync(join(root, "Cargo.toml"), "[workspace]\n");
  writeFileSync(join(root, "drive/Cargo.toml"), "[workspace]\n");
  expect(runDriveDaemon(["--root", root, "--release"])).rejects.toThrow(
    "Drive workspace missing",
  );
});
