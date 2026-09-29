// SPDX-License-Identifier: Apache-2.0
/**
 * Garde-fou synchrone partagé par les writers HTTP et les scripts databooks.
 * Façade de `createDatabooksFreezeGate` (@shenron/db/guards, S11) :
 * - `DATABOOKS_FREEZE_FILE` défini : ce fichier fait foi ;
 * - sinon, hors production : chemin dérivé historique (`<dépôt>/.coord/FREEZE-databooks.json`) ;
 * - sinon, en production : gel (fail closed, « DATABOOKS_FREEZE_FILE non configuré »).
 * Un fichier contenant `{"frozen": false}` libère explicitement les écritures.
 */
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { resolveDataPath } from "@shenron/config/paths";
import {
	createDatabooksFreezeGate,
	DatabooksFrozenError,
	DATABOOKS_FREEZE_EXIT_CODE,
} from "@shenron/db/guards";

export { DATABOOKS_FREEZE_EXIT_CODE,  };

function defaultFreezeFile(): string {
	try {
		// `public` est lié vers le dépôt dans chaque release bleu/vert. Son chemin
		// réel permet donc de retrouver la racine sans l'API Bun `import.meta.dir`,
		// qui vaut `undefined` dans un bundle serveur Webpack.
		const publicDir = realpathSync(join(process.cwd(), "public"));
		return join(publicDir, "..", "..", "..", ".coord", "FREEZE-databooks.json");
	} catch {
		return join(process.cwd(), "..", "..", ".coord", "FREEZE-databooks.json");
	}
}

const production = process.env.NODE_ENV === "production";

function resolveFreezeFile(): string | null {
	const configured = process.env.DATABOOKS_FREEZE_FILE?.trim();
	if (configured) return configured;
	if (production) return null;
	return resolveDataPath("databooksFreezeFile", {
		env: process.env,
		legacyDefault: defaultFreezeFile(),
	}).path;
}

/** Fichier de gel effectif ; `null` en production sans variable (gel imposé). */
export const DATABOOKS_FREEZE_FILE: string | null = resolveFreezeFile();

const gate = createDatabooksFreezeGate({ freezeFile: DATABOOKS_FREEZE_FILE, production });

export function databooksFreeze(): { reason: string; path: string | null } | null {
	const state = gate.state();
	return state.frozen ? { reason: state.reason, path: state.path } : null;
}

export function assertDatabooksWritable(): void {
	gate.assertWritable();
}
