// SPDX-License-Identifier: Apache-2.0
// VS Code: tasks for every m3-bun command (the dev server is a background task with a problem matcher that
// knows when it is ready), debug configurations for the Bun debugger, and extension recommendations.
// settings.json configures the Bun extension (packages/bun-vscode of the Bun fork, `oven.bun-vscode`): its debugger,
// debug terminal and test explorer. Copy `.vscode/` into the project; nothing is installed.
import type { GeneratedFile } from "../util.ts";
import type { Target, TargetContext } from "./types.ts";

const task = (label: string, args: string, extra: Record<string, unknown> = {}) => ({
  label,
  type: "shell",
  command: args,
  group:
    label === "m3-bun: build"
      ? { kind: "build", isDefault: true }
      : label === "m3-bun: test"
        ? { kind: "test", isDefault: true }
        : undefined,
  problemMatcher: [],
  ...extra,
});

export const tasksJson = (c: TargetContext) => ({
  version: "2.0.0",
  tasks: [
    task("m3-bun: dev", `${c.cli} dev`, {
      isBackground: true,
      presentation: { reveal: "always", panel: "dedicated" },
      problemMatcher: {
        owner: "m3-bun",
        pattern: { regexp: "^$" },
        background: {
          activeOnStart: true,
          beginsPattern: "^m3-bun dev",
          endsPattern: "listening on http",
        },
      },
    }),
    task("m3-bun: build", `${c.cli} build`),
    task("m3-bun: compile", `${c.cli} compile`),
    task("m3-bun: compile (windows-x64)", `${c.cli} compile --target windows-x64`),
    task("m3-bun: compile (linux-x64-musl)", `${c.cli} compile --target linux-x64-musl`),
    task("m3-bun: serve", `${c.cli} serve`, {
      isBackground: true,
      problemMatcher: [],
    }),
    task("m3-bun: deploy (generate all targets)", `${c.cli} deploy all`),
    task("m3-bun: package", `${c.cli} package`),
    task("m3-bun: smoke (compiled executable)", `${c.cli} smoke`),
    task("m3-bun: test", "bun test"),
    task("m3-bun: lint", "bun lint ."),
    task("m3-bun: typecheck", "bun check --noEmit -p tsconfig.json"),
  ],
});

export const launchJson = (c: TargetContext) => ({
  version: "0.2.0",
  configurations: [
    {
      type: "bun",
      request: "launch",
      name: "m3-bun: debug dev server",
      program: "${workspaceFolder}/node_modules/@aphrody/m3-bun/bin/m3-bun.ts",
      args: ["dev"],
      cwd: "${workspaceFolder}",
      env: { PORT: String(c.port) },
      stopOnEntry: false,
      watchMode: false,
    },
    {
      type: "bun",
      request: "launch",
      name: "m3-bun: debug production server",
      program: "${workspaceFolder}/node_modules/@aphrody/m3-bun/bin/m3-bun.ts",
      args: ["serve"],
      cwd: "${workspaceFolder}",
      env: { PORT: String(c.port) },
      stopOnEntry: false,
      watchMode: false,
    },
    {
      type: "bun",
      request: "launch",
      name: "bun test: current file",
      program: "${file}",
      args: [],
      cwd: "${workspaceFolder}",
      stopOnEntry: false,
      watchMode: false,
    },
    {
      type: "bun",
      request: "attach",
      name: "bun: attach",
      url: "ws://localhost:6499/",
      stopOnEntry: false,
    },
  ],
});

/** Settings read by the Bun extension; keys and types follow its `contributes.configuration`. */
export const settingsJson = (c: TargetContext) => ({
  "bun.runtime": "bun",
  "bun.debugTerminal.enabled": true,
  "bun.debugTerminal.stopOnEntry": false,
  "bun.diagnosticsSocket.enabled": true,
  "bun.test.enable": true,
  "bun.test.filePattern": "**/*{.test.,.spec.}{js,ts,tsx,jsx,mts,cts,mjs}",
  "bun.test.customScript": "bun test",
  "bun.test.customFlag": "",
  "files.exclude": { [c.outdir]: true },
});

export const vscode: Target = {
  id: "vscode",
  title: "VS Code",
  description:
    ".vscode/tasks.json (dev, build, compile, serve, deploy, package, smoke, test), launch.json (Bun debugger), settings.json (Bun extension), extensions.json",
  generate(c): GeneratedFile[] {
    return [
      {
        path: ".vscode/tasks.json",
        content: `${JSON.stringify(tasksJson(c), null, 2)}\n`,
      },
      {
        path: ".vscode/launch.json",
        content: `${JSON.stringify(launchJson(c), null, 2)}\n`,
      },
      {
        path: ".vscode/settings.json",
        content: `${JSON.stringify(settingsJson(c), null, 2)}
`,
      },
      {
        path: ".vscode/extensions.json",
        content: `${JSON.stringify({ recommendations: ["oven.bun-vscode", "oxc.oxc-vscode"] }, null, 2)}\n`,
      },
    ];
  },
};
