// SPDX-License-Identifier: Apache-2.0
/** WebOS apps backed by wasm modules; DesktopOS/Dock/types merge this list. */
import type React from "react";
import { AphrodyToolsApp } from "../apps/AphrodyToolsApp";
import { BunReplApp } from "../apps/BunReplApp";
import { FilesApp } from "../apps/FilesApp";
import { ProcessesApp } from "../apps/ProcessesApp";

export type WasmAppId = "files" | "processes" | "bun-repl" | "aphrody-tools";

export interface WasmApp {
  id: WasmAppId;
  title: string;
  icon: string;
  color: string;
  component: React.FC;
  size: { width: number; height: number };
}

export const WASM_APPS: readonly WasmApp[] = [
  {
    id: "files",
    title: "Fichiers",
    icon: "🗂️",
    color: "bg-sky-600",
    component: FilesApp,
    size: { width: 760, height: 480 },
  },
  {
    id: "processes",
    title: "Processus",
    icon: "⚙️",
    color: "bg-zinc-700",
    component: ProcessesApp,
    size: { width: 520, height: 320 },
  },
  {
    id: "bun-repl",
    title: "Bun REPL",
    icon: "🥟",
    color: "bg-amber-600",
    component: BunReplApp,
    size: { width: 680, height: 440 },
  },
  {
    id: "aphrody-tools",
    title: "Outils Aphrody",
    icon: "🛠️",
    color: "bg-indigo-600",
    component: AphrodyToolsApp,
    size: { width: 640, height: 460 },
  },
];
