// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPackages, planPackages, powershell, type Runner } from "../src/system-packages.ts";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "system-packages-"));
  await mkdir(join(root, "config"), { recursive: true });
  await writeFile(
    join(root, "config/system-packages.json"),
    JSON.stringify({
      common: ["git", "curl"],
      wsl: ["clang"],
      windows: {
        winget: [
          { id: "Git.Git" },
          { id: "Microsoft.VisualStudio.BuildTools", override: "--add VCTools" },
        ],
        installers: [
          { name: "rustup", check: "rustup", url: "https://win.rustup.rs/x86_64", args: ["-y"] },
        ],
      },
    }),
  );
  return root;
}

test("apt plan reads dpkg state and apply installs only what is missing through sudo", async () => {
  const root = await fixture();
  try {
    const calls: string[][] = [];
    const runner: Runner = async (argv) => {
      calls.push(argv);
      const installed = argv.at(-1) === "git";
      return { exitCode: installed ? 0 : 1, stdout: installed ? "install ok installed" : "" };
    };
    const plan = await planPackages(root, "linux", "wsl", runner);
    expect(plan.entries.map((e) => [e.id, e.state])).toEqual([
      ["git", "installed"],
      ["curl", "missing"],
      ["clang", "missing"],
    ]);
    expect(plan.missing).toBe(2);
    const applied = await applyPackages(root, plan, runner);
    expect(applied.map((r) => r.command)).toEqual(["sudo -n apt-get install -y curl clang"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("winget plan and apply go through PowerShell, with the Build Tools override quoted", async () => {
  const root = await fixture();
  try {
    const seen: string[] = [];
    const runner: Runner = async (argv) => {
      const command = argv.at(-1) ?? "";
      seen.push(command);
      if (argv[0] === "sh") return { exitCode: 0, stdout: "/x/powershell.exe" };
      if (command.startsWith("winget list --id Git.Git"))
        return { exitCode: 0, stdout: "Git Git.Git 2.50" };
      if (command.startsWith("winget list")) return { exitCode: 1, stdout: "" };
      return { exitCode: 0, stdout: "" };
    };
    const plan = await planPackages(root, "windows", null, runner);
    expect(plan.entries.map((e) => [e.manager, e.id, e.state])).toEqual([
      ["winget", "Git.Git", "installed"],
      ["winget", "Microsoft.VisualStudio.BuildTools", "missing"],
      ["installer", "rustup", "missing"],
    ]);
    await applyPackages(root, plan, runner);
    expect(
      seen.some(
        (c) =>
          c.includes("winget install --id Microsoft.VisualStudio.BuildTools") &&
          c.includes("--override '--add VCTools'"),
      ),
    ).toBe(true);
    expect(seen.some((c) => c.includes("win.rustup.rs/x86_64"))).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("powershell is found through wslpath when Windows is not on PATH", async () => {
  if (process.platform !== "linux") return;
  const runner: Runner = async (argv) =>
    argv[0] === "sh"
      ? { exitCode: 1, stdout: "" }
      : { exitCode: 0, stdout: "/mnt/c/Windows/System32\n" };
  expect((await powershell(runner))?.[0]).toBe(
    "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
  );
});
