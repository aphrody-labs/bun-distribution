// SPDX-License-Identifier: Apache-2.0
import type { GeneratedFile } from "../util.ts";

/** Everything a deploy target may depend on. Derived from the app by `contextFor` (index.ts). */
export interface TargetContext {
  /** Service and app name, a DNS-safe label. */
  name: string;
  version: string;
  port: number;
  /** Public host name, when known. */
  domain?: string;
  /** Container image reference. */
  image: string;
  /** Install namespace under `~/apps` (one home per host) and `/etc` (yolo host convention). */
  namespace: string;
  /** Unprivileged account of the systemd unit. */
  user: string;
  /** Fly.io primary region. */
  region: string;
  /** Name of the compiled Linux executable, in images and under `~/apps/<ns>/current/bin`. */
  binary: string;
  /** UI build directory, relative to the app. */
  outdir: string;
  /** API module relative to the app (`src/api.ts`), when the app has one. */
  api?: string;
  /** Bun version the app is built with. */
  bunVersion: string;
  /** The yolo checkout (host conventions are read from `infra/config/host`). */
  yoloRoot: string;
  /** How generated scripts invoke the CLI (`bunx --bun m3-bun`). */
  cli: string;
  /** TLS for nginx: Let's Encrypt paths (default) or explicit certificate files. */
  tls: "letsencrypt" | { cert: string; key: string };
  /** HTTP/2 in the nginx vhost: the `http2 on;` directive of nginx 1.25.1+ (the yolo convention, default) or `listen ... http2`. */
  http2?: "directive" | "listen";
  /** Windows executable metadata; `icon` is relative to the app (`.ico` is used as is, `.svg` is converted). */
  windows?: {
    title?: string;
    publisher?: string;
    description?: string;
    icon?: string;
  };
  /** Absolute app directory. Targets that read the app (tauri, windows icon) need it. */
  appDir?: string;
  /** Seed colour of the app theme, `#rrggbb` (`theme.seed` of `m3.config.ts`). */
  seed?: string;
  /** Scheme variant of the app theme (`theme.variant`). */
  variant?: string;
  /** Material Symbol used as the application icon (`rocket_launch`); default: the Aphrody emblem. */
  iconSymbol?: string;
  /** Absolute directory this target is written to, set by `generateTargets`. */
  targetDir?: string;
}

/** A generated file; binary payloads (icons, wallpapers) are bytes. */
export type TargetFile = Omit<GeneratedFile, "content"> & {
  content: string | Uint8Array;
};

export interface Target {
  id: string;
  title: string;
  /** One line: what is generated and what it is for. */
  description: string;
  generate(context: TargetContext): TargetFile[] | Promise<TargetFile[]>;
}
