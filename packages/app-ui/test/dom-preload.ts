// SPDX-License-Identifier: Apache-2.0
// Shared DOM setup for M3 component tests consumed from the npm packages.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
await import("element-internals-polyfill");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
