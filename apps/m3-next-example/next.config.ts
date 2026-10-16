// SPDX-License-Identifier: Apache-2.0
import { withM3 } from "@aphrody/m3-next";
import { resolve } from "node:path";

export default withM3(
  { poweredByHeader: false },
  {
    // Next 16: React Compiler and Cache Components are top-level keys; Turbopack is the default bundler.
    reactCompiler: true,
    cacheComponents: true,
    typedRoutes: true,
    // The workspace packages live outside this app: Turbopack's root is the repository root.
    turbopackRoot: resolve(import.meta.dir, "../.."),
  },
);
