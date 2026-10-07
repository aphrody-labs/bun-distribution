// SPDX-License-Identifier: Apache-2.0
// Compatibility entry; implementation belongs to its publishable package owner.
export * from "../../packages/engine/core/src/distribution/desktop-release.ts";
import { runDesktopRelease } from "../../packages/engine/core/src/distribution/desktop-release.ts";
if (import.meta.main) process.exit(runDesktopRelease(process.argv.slice(2)));
