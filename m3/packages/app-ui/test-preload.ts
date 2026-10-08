// SPDX-License-Identifier: Apache-2.0
import { mock } from "bun:test";
// oxlint-disable-next-line import/no-unassigned-import -- registers the DOM before UI imports
import "../../../scripts/test-dom";

// Bun's test loader does not run the Bun.build resolver for CommonJS peers.
// Alias the nested workspace's real React to the host copy, as the app bundler does.
for (const name of ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom"]) {
  const canonical = import.meta.require(name);
  let nestedPath: string;
  try {
    nestedPath = Bun.resolveSync(name, new URL("../../", import.meta.url).pathname);
  } catch {
    continue; // the nested workspace has no React of its own: nothing to alias
  }
  const hostPath = Bun.resolveSync(name, import.meta.dir);
  if (nestedPath !== hostPath)
    mock.module(nestedPath, () => ({ ...canonical, default: canonical }));
}
