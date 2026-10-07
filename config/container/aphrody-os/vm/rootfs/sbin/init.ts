#!/usr/bin/bun
// SPDX-License-Identifier: Apache-2.0
// Init of the Aphrody image, exec'd by aphrody-init (Rust) as PID 1 once the
// pseudo filesystems are mounted. Bun drives userspace, Rust tools do the rest.

import { dlopen, FFIType, ptr } from "bun:ffi";

const libc = dlopen("libc.so.6", {
  sethostname: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.i32 },
  reboot: { args: [FFIType.i32], returns: FFIType.i32 },
  sync: { args: [], returns: FFIType.void },
}).symbols;

function run(label: string, argv: string[]) {
  const p = Bun.spawnSync(argv, { stdout: "pipe", stderr: "pipe" });
  const out = (p.stdout.toString() + p.stderr.toString()).trimEnd();
  const status = p.exitCode === 0 ? "OK  " : `FAIL(${p.exitCode})`;
  console.log(`[${status}] ${label}: $ ${argv.join(" ")}`);
  if (out) console.log(out.replace(/^/gm, "        "));
  return p.exitCode === 0;
}

function powerOff(): never {
  libc.sync();
  libc.reboot(0x4321fedc); // LINUX_REBOOT_CMD_POWER_OFF
  process.exit(0);
}

const host = Buffer.from("aphrody");
libc.sethostname(ptr(host), BigInt(host.length));

console.log(`\n== Aphrody: Linux ${await Bun.file("/proc/sys/kernel/osrelease").text()}`.trimEnd());
console.log(`== PID ${process.pid}: Bun ${Bun.version} (${Bun.revision.slice(0, 9)})`);

// Announce the runtime to the in-kernel Rust driver.
await Bun.write("/dev/aphrody-runtime", `bun ${Bun.version}\n`);
console.log((await Bun.file("/dev/aphrody-runtime").text()).trimEnd().replace(/^/gm, "== kernel: "));

const cmdline = await Bun.file("/proc/cmdline").text();
if (cmdline.includes("aphrody.shell")) {
  Bun.spawnSync(["/usr/bin/bunsh"], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  powerOff();
}

console.log("\n== Self-test: GNU-free userland");
function check(label: string, ok: boolean, detail: string) {
  console.log(`[${ok ? "OK  " : "FAIL"}] ${label}`);
  if (detail) console.log(detail.trimEnd().replace(/^/gm, "        "));
  return ok;
}

function kernelLog(): string {
  const { openSync, readSync, closeSync, constants } = require("node:fs");
  const fd = openSync("/dev/kmsg", constants.O_RDONLY | constants.O_NONBLOCK);
  const buf = Buffer.alloc(8192);
  const lines: string[] = [];
  try {
    for (;;) lines.push(buf.toString("utf8", 0, readSync(fd, buf, 0, buf.length, null)));
  } catch {
    // EAGAIN: end of the ring buffer.
  }
  closeSync(fd);
  return lines.map((l) => l.slice(l.indexOf(";") + 1)).join("");
}

const klog = kernelLog().split("\n").filter((l) => /aphrody|rust_minimal|Rust/.test(l)).join("\n");
const gnu = Bun.spawnSync(["sh", "-c", "ls /usr/bin /usr/sbin"]).stdout.toString();
const lsTarget = require("node:fs").readlinkSync("/usr/bin/ls");

const results = [
  check("Rust code running in the kernel", klog.includes("runtime registered: bun"), klog),
  run("uutils uname", ["uname", "-a"]),
  run("uutils ls", ["ls", "--version"]),
  run("uutils pipeline via bunsh", ["sh", "-c", "seq 1 5 | sort -rn | tr '\\n' ' ' | wc -w"]),
  run("uutils sha256sum", ["sh", "-c", "echo aphrody | sha256sum"]),
  run("eza listing", ["eza", "-l", "--no-user", "--no-time", "--no-permissions", "/usr/sbin"]),
  run("sudo-rs version", ["sudo", "--version"]),
  run("sudo-rs: root -> agent", ["sudo", "-u", "agent", "id"]),
  run("sudo-rs: agent -> root (yolo, NOPASSWD)", ["sudo", "-u", "agent", "sudo", "-n", "id"]),
  run("Bun shell builtins", ["bun", "exec", "echo bun-shell && ls /etc | wc -l"]),
  check("no GNU coreutils on disk", !/gnu/i.test(gnu) && lsTarget === "coreutils", `/usr/bin/ls -> ${lsTarget}`),
];
const passed = results.filter(Boolean).length;
console.log(`\n== ${passed}/${results.length} checks passed`);
console.log(passed === results.length ? "APHRODY_SELFTEST_PASS" : "APHRODY_SELFTEST_FAIL");
powerOff();
