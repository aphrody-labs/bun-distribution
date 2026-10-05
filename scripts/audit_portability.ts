#!/usr/bin/env bun
/**
 * Cross-Platform & Environment Portability CLI Runner
 * Powered by @aphrody/yolo-core/vfs.
 */
import { auditPortability, renderPortabilityMarkdown } from "../packages/core/src/index";

const json = process.argv.includes("--json");
const report = await auditPortability();

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(renderPortabilityMarkdown(report));
}

process.exit(report.ok ? 0 : 1);
