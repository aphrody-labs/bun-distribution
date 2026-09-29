// SPDX-License-Identifier: Apache-2.0
// Shared `bun test` preload: one happy-dom for the whole run (react-dom decides whether it can use
// the DOM when it is first loaded, so the DOM must exist before any test module imports it), plus
// ElementInternals, which happy-dom lacks and the form-associated md-* elements need.
//
//   [test]
//   preload = ["@aphrody/m3-config/test/dom"]
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
// Dynamic import so it runs after the DOM globals exist; a static import would be hoisted above.
await import("element-internals-polyfill");

// Rendering is driven with `flushSync`, not React Testing Library: silence the act() warning.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
