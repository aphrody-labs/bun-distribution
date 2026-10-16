#!/usr/bin/env bun
// Persistent task wrapper for the Windows reverse SSH tunnel.
// The private JSON contains destinations and credential paths, never key material.

import { appendFile } from "node:fs/promises";

type Forward = {
  listenAddress: string;
  listenPort: number;
  connectAddress: string;
  connectPort: number;
};
type Config = {
  bun: string;
  destination: string;
  identityFile: string;
  knownHostsFile: string;
  home: string;
  workingDirectory: string;
  logFile: string;
  forwards: Forward[];
};

const configPath = process.argv[2];
if (!configPath) process.exit(2);
const config = (await Bun.file(configPath).json()) as Config;
const expected = new Map<number, string>([
  [22010, "127.0.0.1:22"],
  [28795, "10.200.77.10:8795"],
  [28793, "127.0.0.1:8793"],
  [25900, "10.200.77.10:5900"],
  [28788, "127.0.0.1:8788"],
  [28080, "127.0.0.1:80"],
]);
if (
  config.destination !== "10.200.77.1" ||
  config.forwards.length !== expected.size ||
  config.forwards.some(
    (forward) =>
      forward.listenAddress !== "127.0.0.1" ||
      expected.get(forward.listenPort) !==
        forward.connectAddress + ":" + forward.connectPort,
  )
)
  process.exit(3);

const args = [
  "ssh",
  "forward",
  "--native",
  "--identity",
  config.identityFile,
  "--login",
  "omar",
  "-o",
  "BatchMode=yes",
  "-o",
  "ExitOnForwardFailure=yes",
  "-o",
  "ServerAliveInterval=30",
  "-o",
  "ServerAliveCountMax=3",
  "-o",
  "UserKnownHostsFile=" + config.knownHostsFile,
  "-o",
  "IdentitiesOnly=yes",
  "-o",
  "StrictHostKeyChecking=yes",
];
for (const forward of config.forwards) {
  args.push(
    "-R",
    forward.listenAddress +
      ":" +
      forward.listenPort +
      ":" +
      forward.connectAddress +
      ":" +
      forward.connectPort,
  );
}
args.push(config.destination);

const childEnv = Object.fromEntries(
  ["SystemRoot", "WINDIR", "PATH", "TEMP", "TMP"]
    .filter((name) => process.env[name])
    .map((name) => [name, process.env[name]!]),
);
childEnv.USERPROFILE = config.home;
childEnv.HOME = config.home;
const child = Bun.spawn([config.bun, ...args], {
  cwd: config.workingDirectory,
  env: childEnv,
  stdin: "ignore",
  stdout: "ignore",
  stderr: "pipe",
  windowsHide: true,
});
const stderrPromise = new Response(child.stderr).text();
const exitCode = await child.exited;
const stderr = await stderrPromise;

if (exitCode !== 0) {
  const errors = stderr
    .split(/\r?\n/)
    .filter((line) =>
      /error|failed|denied|refused|timeout|could not|unable|host key|closed/i.test(
        line,
      ),
    )
    .map((line) =>
      line
        .replace(/(?:[A-Za-z]:\\)[^\s]+/g, "[path]")
        .replace(/SHA256:[A-Za-z0-9+/=]+/g, "[fingerprint]")
        .slice(0, 300),
    )
    .slice(0, 20);
  await appendFile(
    config.logFile,
    [
      new Date().toISOString() + " bun_ssh_exit=" + exitCode,
      ...errors,
      "",
    ].join("\n"),
    "utf8",
  );
}
process.exitCode = exitCode;
