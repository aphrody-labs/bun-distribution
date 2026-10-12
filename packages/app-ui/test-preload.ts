// SPDX-License-Identifier: Apache-2.0
import { mock } from "bun:test";
// oxlint-disable-next-line import/no-unassigned-import -- registers the DOM before UI imports
import "@aphrody/m3-config/test/dom";
import { createRequire } from "node:module";

// Bun's test loader does not run the Bun.build resolver for CommonJS peers.
// Alias the nested workspace's real React to the host copy, as the app bundler does.
const require = createRequire(import.meta.url);
for (const name of ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom"]) {
  const canonical = require(name);
  const nestedPath = Bun.resolveSync(name, new URL("../../", import.meta.url).pathname);
  const hostPath = Bun.resolveSync(name, import.meta.dir);
  if (nestedPath !== hostPath)
    mock.module(nestedPath, () => ({ ...canonical, default: canonical }));
}
