#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Compatibility entrypoint; source rewriting belongs to Workspace.
import { runPathAudit } from "../../workspace/src/path-audit.ts";
process.exit(await runPathAudit(Bun.argv.slice(2)));
