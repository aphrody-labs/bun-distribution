// SPDX-License-Identifier: Apache-2.0
import type { SchemeVariant } from "@aphrody/m3-tokens/dynamic-color";

export type Mode = "light" | "dark";
export type Target = "windows" | "gnome" | "cosmic" | "chromium";
export const TARGETS: readonly Target[] = ["windows", "gnome", "cosmic", "chromium"];

/** What the installer activates: a fixed mode, or follow the system (`auto`). */
export type ActiveMode = Mode | "auto";

export interface ThemeInput {
  /** Theme name, `[A-Za-z0-9_-]+`; installed as `M3-<name>`. */
  name: string;
  /** Seed colour `#rrggbb`. */
  seed: string;
  variant?: SchemeVariant;
  mode: ActiveMode;
}

/** One generated artifact. `path` is relative to the output directory. */
export interface GeneratedFile {
  target: Target;
  path: string;
  content: string | Uint8Array;
  executable?: boolean;
}

/** Resolved M3 colour roles (`primary`, `onPrimary`, `surfaceContainer`...) as `#rrggbb`. */
export type Roles = Record<string, string>;

export interface ThemeColors {
  mode: Mode;
  roles: Roles;
}
