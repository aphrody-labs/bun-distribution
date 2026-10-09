// SPDX-License-Identifier: Apache-2.0
// Native Windows resources and an in-process CPython planner; no alternate Python launcher.
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { PythonAsync } from "bun:python";

export async function nativeInventory(member: "aphro-pc" | "omar", root: string) {
  const w = await import("bun:windows");
  if (!w.isSupported) throw new Error("Windows inventory requires the qualified Windows fork");
  const child = Bun.spawn(
    [
      "nvidia-smi",
      "--query-gpu=name,memory.total,memory.free,driver_version",
      "--format=csv,noheader,nounits",
    ],
    { stdin: "ignore", stdout: "pipe", stderr: "ignore", windowsHide: true },
  );
  const deadline = setTimeout(() => child.kill("SIGKILL"), 8000);
  let output: string;
  try {
    const [text, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    if (code !== 0) throw new Error("native NVIDIA probe failed");
    output = text.trim();
  } finally {
    clearTimeout(deadline);
  }
  const rows = output.split(/\r?\n/);
  if (rows.length !== 1)
    throw new Error("fleet requires an explicit GPU selection on multi-GPU hosts");
  const [gpu, total, free, driver] = rows[0]!.split(",").map((s) => s.trim());
  const memory = w.memory.status();
  const toolchain =
    "toolchain" in w && typeof w.toolchain === "function"
      ? (w.toolchain() as { arch: string; msvc: { version: string } | null })
      : null;
  const disk = w.storage
    .drives()
    .find((d) => resolve(root).toLowerCase().startsWith(d.root.toLowerCase()));
  if (!disk) throw new Error("configured storage drive unavailable");
  return {
    node: {
      member,
      address: member === "omar" ? "10.200.77.10" : "10.200.77.4",
      gpu,
      vram_mib: Number(total),
      free_vram_mib: Number(free),
      ram_bytes: memory.totalPhysical,
      available_ram_bytes: memory.availablePhysical,
      disk_bytes: disk.totalBytes,
      available_disk_bytes: disk.availableBytes,
      // A driver query cannot qualify CUDA arithmetic in the intended container.
      docker_cuda: false,
    },
    native: {
      pid: process.pid,
      executable: w.processes.path(process.pid),
      driver,
      windows: w.version().version,
      elevated: w.isElevated(),
      windows11: w.isWindows11(),
      processors: w.systemInfo().processors,
      localAppData: w.knownFolder("LocalAppData"),
      services: w.services.list().filter((s) => /^(sshd|WireGuard|com\.docker)/i.test(s.name)),
      toolchain: { arch: toolchain?.arch ?? null, msvc: toolchain?.msvc?.version ?? null },
      // Registry-only enumeration does not start WSL.
      wslRegistrations: w.wsl.distributions().map((d) => ({ name: d.name, version: d.version })),
    },
  };
}

export async function openPlanner(source: string): Promise<PythonAsync> {
  if (!isAbsolute(source) || !existsSync(join(source, "aphrody", "inference", "fleet.py")))
    throw new Error("configured Aphrody Python source missing");
  const { Python } = await import("bun:python");
  const py = await Python.async();
  try {
    await py.exec(`import sys, os\nsys.path.insert(0, ${JSON.stringify(source)})`);
    const environment = process.env.VIRTUAL_ENV;
    if (environment) {
      const site = join(environment, "Lib", "site-packages");
      if (process.platform === "win32" && existsSync(site))
        await py.exec(`import site\nsite.addsitedir(${JSON.stringify(site)})`);
    }
    const pid = Number(await py.eval("os.getpid()"));
    if (pid !== process.pid) throw new Error("Python host is not in the dedicated Bun process");
    await py.exec("import aphrody.inference.fleet");
    return py;
  } catch (error) {
    await py.close();
    throw error;
  }
}

export async function main(argv = Bun.argv.slice(2)): Promise<number> {
  const flag = (name: string) => {
    const at = argv.indexOf(name);
    return at < 0 ? undefined : argv[at + 1];
  };
  const root = resolve(flag("--root") ?? join(import.meta.dir, "../../.."));
  const source = resolve(flag("--python-source") ?? join(root, "py/packages/aphrody/src"));
  if (argv[0] === "inventory") {
    const member = flag("--member") ?? "aphro-pc";
    if (member !== "aphro-pc" && member !== "omar") throw new Error("unknown member");
    console.log(JSON.stringify(await nativeInventory(member, root)));
    return 0;
  }
  if (argv[0] === "plan" || argv[0] === "cuda-probe") {
    await using py = await openPlanner(source);
    if (argv[0] === "cuda-probe") {
      console.log(await py.call("aphrody.inference.fleet", "cuda_probe_json"));
      return 0;
    }
    const path = flag("--snapshot");
    if (!path || !isAbsolute(path))
      throw new Error("plan requires an absolute measured snapshot path");
    console.log(await py.call("aphrody.inference.fleet", "plan_json", readFileSync(path, "utf8")));
    return 0;
  }
  throw new Error(
    "usage: gpu-fleet.ts inventory|plan|cuda-probe [--root path] [--python-source path]",
  );
}

if (import.meta.main) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "GPU fleet failed");
    process.exitCode = 1;
  }
}
