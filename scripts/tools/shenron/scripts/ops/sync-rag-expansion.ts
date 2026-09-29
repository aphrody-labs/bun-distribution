#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * scripts/ops/sync-rag-expansion.ts — resynchronise dans le RAG les piliers
 * d'expansion (combats, lieux, tournois, doublage, musiques, puissances, objets,
 * dragons, vœux).
 *
 * Ce script ne rend plus rien lui-même : il délègue à
 * `apps/bot/scripts/rag-resync-entites.ts`, dont le rendu (`_rag-sources-pg.ts`)
 * est partagé avec le build complet. Sa version précédente supprimait les
 * passages de `rag_chunks` sans leurs vecteurs et en réinsérait sans embedding :
 * 154 vecteurs orphelins, 149 passages invisibles à la recherche sémantique, et
 * les 47 combats indexés sans titre (colonne `name` inexistante). Le 2026-09-14,
 * l'index a été réparé par `rag-resync-entites.ts --reparer`.
 *
 * Usage :
 *   bun scripts/ops/sync-rag-expansion.ts              # simulation
 *   bun scripts/ops/sync-rag-expansion.ts --appliquer  # écriture + vecteurs
 */
import { join } from "node:path";

const PILIERS = [
	"db_battles",
	"db_locations",
	"db_tournaments",
	"db_voice_actors",
	"db_soundtracks",
	"db_power_levels",
	"db_items",
	"db_dragons",
	"db_wishes",
];

const proc = Bun.spawn(
	[
		process.execPath,
		join(import.meta.dir, "../../packages/pipeline/scripts/rag-resync-entites.ts"),
		...PILIERS,
		...process.argv.slice(2).filter((a) => a === "--appliquer"),
	],
	{ stdout: "inherit", stderr: "inherit", env: process.env }
);
process.exit(await proc.exited);
