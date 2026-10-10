// SPDX-License-Identifier: Apache-2.0
import { $ } from "bun";
await $`seq 1 100000 | wc -l`.quiet();
