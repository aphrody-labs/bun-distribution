// SPDX-License-Identifier: Apache-2.0
// web.json and the PET_WEB module live in @aphrody/web-source; src/web.generated.ts re-exports them.
import { dirname, join, relative } from "node:path";

export interface WebSourceTarget {
  webJson: string;
  generated: string;
  runtimeImport: string;
}

export function webSourceTarget(identitySrc: string): WebSourceTarget {
  const generated = Bun.resolveSync(
    "@aphrody/web-source/integrations/m3/packages/identity/src/web.generated.ts",
    identitySrc,
  );
  const webJson = Bun.resolveSync(
    "@aphrody/web-source/integrations/crates/ui/identity/assets/aphrody/web.json",
    identitySrc,
  );
  const runtimeImport = relative(dirname(generated), join(identitySrc, "runtime.ts")).replaceAll(
    "\\",
    "/",
  );
  return {
    webJson,
    generated,
    runtimeImport: runtimeImport.startsWith(".") ? runtimeImport : `./${runtimeImport}`,
  };
}
