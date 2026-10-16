// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPackages, planPackages, powershell, type Runner } from "../src/system-packages.ts";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "system-packages-"));
  await mkdir(join(root, "tools", "config"), { recursive: true });
  await writeFile(
    join(root, "tools/config/system-packages.json"),
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
          {
            name: "bun",
            check: "bun",
            url: "https://example.test/install.ps1",
            args: ["-Version", "1.4.3"],
          },
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

test("Windows plan and apply use one PowerShell 7 process each, through the WinGet module", async () => {
  const root = await fixture();
  try {
    const processes: string[][] = [];
    const runner: Runner = async (argv) => {
      if (argv[0] === "sh") return { exitCode: 0, stdout: "/x/pwsh.exe" };
      processes.push(argv);
      return {
        exitCode: 0,
        stdout: JSON.stringify({ winget: ["Git.Git"], tools: { rustup: false, bun: false } }),
      };
    };
    const plan = await planPackages(root, "windows", null, runner);
    expect(plan.entries.map((e) => [e.manager, e.id, e.state])).toEqual([
      ["winget", "Git.Git", "installed"],
      ["winget", "Microsoft.VisualStudio.BuildTools", "missing"],
      ["installer", "rustup", "missing"],
      ["installer", "bun", "missing"],
    ]);
    expect(processes).toHaveLength(1);
    expect(processes[0]![0]).toBe("pwsh.exe");
    // Native Windows reads the WinGet module; other hosts read `winget export` (no COM session from WSL).
    expect(processes[0]!.at(-1)).toContain(
      process.platform === "win32" ? "Get-WinGetPackage" : "winget export",
    );
    await applyPackages(root, plan, runner);
    expect(processes).toHaveLength(2);
    const script = processes[1]!.at(-1)!;
    expect(script).toContain(
      process.platform === "win32"
        ? "Install-WinGetPackage -Id 'Microsoft.VisualStudio.BuildTools' -Mode Silent -Override '--add VCTools'"
        : "winget install --id 'Microsoft.VisualStudio.BuildTools' -e --silent --accept-package-agreements --accept-source-agreements --override '--add VCTools'",
    );
    expect(script).toContain("https://win.rustup.rs/x86_64");
    expect(script).toContain(
      "& ([scriptblock]::Create((Invoke-RestMethod 'https://example.test/install.ps1'))) -Version '1.4.3'",
    );
    expect(script).not.toContain("Git.Git");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const wslPwshRunner: Runner = async (argv) => {
  if (argv[0] === "sh")
    return { exitCode: argv[2]?.startsWith("ls") ? 0 : 1, stdout: "someone\nPublic\n" };
  if (argv[0] === "wslpath")
    return { exitCode: 0, stdout: `/mnt/c/${argv[2]?.split("\\").slice(1).join("/")}\n` };
  return { exitCode: argv[0] === "test" && argv[2]?.includes("someone") ? 0 : 1, stdout: "" };
};

test("pwsh 7 is found through wslpath when Windows is not on PATH", async () => {
  if (process.platform !== "linux") return;
  expect((await powershell(wslPwshRunner))?.[0]).toBe(
    "/mnt/c/Users/someone/AppData/Local/Microsoft/WindowsApps/pwsh.exe",
  );
});
