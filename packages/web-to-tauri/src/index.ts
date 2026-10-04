// SPDX-License-Identifier: Apache-2.0
export { TAURI_3 } from "@aphrody/scaffold";
export {
  decide,
  matchesPattern,
  originOf,
  parsePattern,
  stripPath,
  type Decision,
  type NavigationKind,
} from "./policy.ts";
export {
  normalizeTarget,
  probeDirectory,
  probeUrl,
  ProbeError,
  type ProbeOptions,
} from "./probe.ts";
export {
  assessRisks,
  planConversion,
  PlanError,
  registrableDomain,
  WRAPPED_ID_PREFIX,
} from "./plan.ts";
export {
  generateProject,
  GenerateError,
  readme,
  sidecarBuildScript,
  type GenerateOptions,
  type GenerateResult,
} from "./generate.ts";
export {
  buildReport,
  compareSnapshots,
  normalizeText,
  PARITY_SNAPSHOT_BODY,
  textSimilarity,
  verifyPolicy,
  type CompareOptions,
  type Finding,
  type PageSnapshot,
  type ParityReport,
  type PathReport,
} from "./parity.ts";
export {
  API_RULES,
  detectApis,
  detectFrameworks,
  detectIdps,
  detectProxyPrefixes,
  extractOrigins,
  IDP_RULES,
  parseSetCookies,
} from "./signals.ts";
export * from "./types.ts";
