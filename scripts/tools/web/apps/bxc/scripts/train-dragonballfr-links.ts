#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { resolveDragonBallFrTrainingLinks } from "../src/crawler/dragonballfr.ts";

const output = resolve(
	process.argv[2] ?? ".bxc/training/dragonballfr-links.jsonl",
);
const links = await resolveDragonBallFrTrainingLinks();
await mkdir(dirname(output), { recursive: true });
await Bun.write(
	output,
	`${links.map((link) => JSON.stringify(link)).join("\n")}\n`,
);

const episodes = links.filter((link) => link.kind === "episode").length;
const movies = links.length - episodes;
console.log(JSON.stringify({ output, total: links.length, episodes, movies }));
