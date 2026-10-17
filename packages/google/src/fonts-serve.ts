#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/** Entry point of the Google Fonts edge proxy: `bun fonts-serve.ts [--port 8796] [--cache <dir>] [--origin <url>] [--static <dir>]... [--all-families]`. */
import { runGoogle } from "./cli.ts";

process.exit(await runGoogle(["fonts", "serve", ...process.argv.slice(2)]));
