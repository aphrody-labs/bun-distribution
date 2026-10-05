#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
import { runCli } from "../src/cli.ts";

process.exitCode = await runCli(process.argv.slice(2));
