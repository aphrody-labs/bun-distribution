#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/** Compatibility entrypoint for the Aphrody Web official-site campaign. */
import { parseMode, runOfficialCrawl } from "./crawl-dragon-ball-official-aphrody.ts";

const report = await runOfficialCrawl(parseMode(process.argv.slice(2)));
console.log(JSON.stringify(report));
