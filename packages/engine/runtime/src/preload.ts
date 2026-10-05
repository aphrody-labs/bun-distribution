/**
 * Registers runtime modules without activating their native providers. Desktop requires its
 * precompiled system-WebView host; browser load negotiates optional native capabilities.
 */
import { plugin } from "bun";
import { BrowserRuntime, browser, desktop, processes, system } from "./modules";

plugin({
  name: "yolo-runtime",
  setup(build) {
    build.module("runtime:system", () => ({ exports: { system }, loader: "object" }));
    build.module("runtime:process", () => ({ exports: { processes }, loader: "object" }));
    build.module("runtime:desktop", () => ({ exports: { desktop }, loader: "object" }));
    build.module("runtime:browser", () => ({
      exports: { browser, BrowserRuntime },
      loader: "object",
    }));
  },
});
