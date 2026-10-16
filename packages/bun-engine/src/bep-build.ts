#!/usr/bin/env bun
import { compilePackageManager } from "./workspace";

process.exitCode = await compilePackageManager(process.argv[2]);
