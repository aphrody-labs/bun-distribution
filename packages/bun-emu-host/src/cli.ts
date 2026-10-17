#!/usr/bin/env bun
// bun-emu-host <core> <content> [--frames N] [--out DIR] [--firmware kind=FILE]... [--config key=value]...
// Runs a C++ core plugin headless through bun:ffi and writes screen<i>.ppm files.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { EmuCore, toPpm } from "./index.ts";

const args = process.argv.slice(2);
const [core, content] = args;
if (!core || !content) {
  console.error(
    "usage: bun-emu-host <core> <content> [--frames N] [--out DIR] [--firmware kind=FILE] [--config key=value]",
  );
  process.exit(2);
}
let frames = 60;
let out: string | undefined;
const firmware: [string, string][] = [];
const config: [string, string][] = [];
for (let i = 2; i < args.length; i++) {
  const value = args[++i] ?? "";
  const pair = (): [string, string] => {
    const eq = value.indexOf("=");
    return eq < 0 ? [value, "1"] : [value.slice(0, eq), value.slice(eq + 1)];
  };
  switch (args[i - 1]) {
    case "--frames":
      frames = Number(value);
      break;
    case "--out":
      out = value;
      break;
    case "--firmware":
      firmware.push(pair());
      break;
    case "--config":
      config.push(pair());
      break;
    default:
      console.error(`unknown option ${args[i - 1]}`);
      process.exit(2);
  }
}

const plugin = new EmuCore(core);
using emu = plugin.create();
for (const [k, v] of config) emu.setConfig(k, v);
for (const [kind, file] of firmware)
  emu.loadFirmware(kind, new Uint8Array(await Bun.file(file).arrayBuffer()));
emu.loadContentPath(content);
const started = performance.now();
let ran = 0;
while (ran < frames && emu.runFrame()) {
  ran++;
  const text = emu.console();
  if (text) process.stdout.write(text);
}
const ms = performance.now() - started;
console.log(
  `${plugin.info.name} ${plugin.info.version}: ${ran} frames in ${ms.toFixed(0)} ms`,
);
if (out) {
  mkdirSync(out, { recursive: true });
  await Promise.all(
    emu
      .screens()
      .map((s, i) => Bun.write(join(out!, `screen${i}.ppm`), toPpm(s))),
  );
}
