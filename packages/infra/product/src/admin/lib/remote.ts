// SPDX-License-Identifier: Apache-2.0
/** The shell scripts run on the hosts (src/remote/*.sh, embedded in the exe), each preceded by the shared prelude. */
import arreter from "../remote/arreter.sh" with { type: "text" };
import demarrer from "../remote/demarrer.sh" with { type: "text" };
import etat from "../remote/etat.sh" with { type: "text" };
import journal from "../remote/journal.sh" with { type: "text" };
import prelude from "../remote/prelude.sh" with { type: "text" };
import sonde from "../remote/sonde.sh" with { type: "text" };

const compose = (body: string): string => `${prelude}\n${body}`;

export const SCRIPTS = {
  sonde: compose(sonde),
  etat: compose(etat),
  demarrer: compose(demarrer),
  journal: compose(journal),
  arreter: compose(arreter),
} as const;

export type ScriptName = keyof typeof SCRIPTS;
