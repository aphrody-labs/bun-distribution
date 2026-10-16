/**
 * DOM environment for hook tests under `bun test` (Happy DOM).
 * Registered once per process; later imports are no-ops.
 */

import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (typeof globalThis.document === "undefined") {
  GlobalRegistrator.register({ url: "http://localhost" });
}
