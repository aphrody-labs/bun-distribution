// SPDX-License-Identifier: Apache-2.0
export { main, productArgs, VERSION } from "./cli.ts";
export { install, parseRoles, setupContext } from "./setup/cli.ts";
export { stepsFor } from "./setup/steps.ts";
export { defaultContext, type Context } from "./admin/lib/context.ts";
export { loadProfile, type AccessPack } from "./admin/lib/profile.ts";
export {
  buildAccessPack,
  assertOutsideRepo,
  type MakeOptions,
  type Tunnel,
} from "./admin/access.ts";
