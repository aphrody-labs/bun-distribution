#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
import { XClient, XSession, buildCoverageReport } from "../../../packages/web/x/src/index.ts";

const probe = process.argv.includes("--probe");
const client = probe ? new XClient(XSession.loadOrEnv()) : undefined;
const report = await buildCoverageReport(client, {
  probePremium: probe,
  checkQueryIds: true,
});
console.log(JSON.stringify(report, null, 2));
