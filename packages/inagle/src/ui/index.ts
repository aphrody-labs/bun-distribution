/**
 * @file ui/index.ts
 * @description Consolidated UI components, terminal visualizers, and asset manifest helpers.
 */

import pc from "picocolors";

export { pc as colors };

export * from "../menu/index.js";
export * as AssetManifest from "../data/asset-manifest.generated.js";
