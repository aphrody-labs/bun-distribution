/**
 * Packages an actual desktop host. Run through the native Yolo desktop-runtime package owner;
 * engine compilation is a separate serialized factory step.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  inspectDesktopBinary,
  writeDesktopManifest,
} from "../../../packages/runtime/src/desktop-artifact";

export function packageDesktop(options: {
  root: string;
  executable?: string;
  output?: string;
  allowDirty?: boolean;
}): string {
  const root = resolve(options.root);
  const git = (args: string[]): string => {
    const reply = Bun.spawnSync(["git", ...args], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 10_000,
    });
    if (reply.exitCode !== 0) throw new Error("Desktop source provenance command failed");
    return new TextDecoder().decode(reply.stdout).trim();
  };
  const executable = resolve(
    options.executable ??
      join(
        root,
        "target/runtime",
        process.platform === "win32" ? "yolo-desktop.exe" : "yolo-desktop",
      ),
  );
  const info = inspectDesktopBinary(executable);
  if (info.git_rev !== git(["rev-parse", "HEAD"])) {
    throw new Error(
      "Desktop host was built from another revision; rebuild on the serialized factory",
    );
  }
  const dirty = git(["status", "--porcelain", "--untracked-files=all"]) !== "";
  if (dirty && options.allowDirty !== true)
    throw new Error("Desktop source is dirty; commit qualified owned sources before packaging");
  const output = resolve(options.output ?? join(root, "dist/desktop", info.target));
  mkdirSync(dirname(output), { recursive: true });
  if (existsSync(output)) {
    throw new Error(
      "Desktop artifact destination already exists; choose a new owned output directory",
    );
  }
  const staging = mkdtempSync(join(dirname(output), ".desktop-artifact-"));
  try {
    const manifest = writeDesktopManifest(staging, executable, dirty, {
      LICENSE: join(root, "LICENSE"),
      "LICENSE-tauri-APACHE": join(root, "crates/aphrody-tauri/LICENSE-APACHE-2.0"),
      "LICENSE-tauri-MIT": join(root, "crates/aphrody-tauri/LICENSE-MIT"),
      "LICENSE-wry-APACHE": join(root, "crates/aphrody-wry/LICENSE-APACHE"),
      "LICENSE-wry-MIT": join(root, "crates/aphrody-wry/LICENSE-MIT"),
      "LICENSE-tao": join(root, "crates/aphrody-tao/LICENSE"),
    });
    // The manifest itself is also pinned by the surrounding release SHA256SUMS owner.
    const manifestSha256 = new Bun.CryptoHasher("sha256")
      .update(readFileSync(join(staging, "manifest.json")))
      .digest("hex");
    renameSync(staging, output);
    console.log(
      JSON.stringify({
        protocol: manifest.protocol,
        artifact: output,
        target: manifest.target,
        source: manifest.source,
        manifestSha256,
      }),
    );
    return output;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
