// SPDX-License-Identifier: Apache-2.0
export * from "@aphrody/web-source/integrations/m3/packages/app-ui/webos.ts";
import { startForkWebOS } from "@aphrody/web-source/integrations/m3/packages/app-ui/webos.ts";
if (import.meta.main) {
  const server = await startForkWebOS();
  console.log(`Bun WebOS: ${server.url}`);
}
