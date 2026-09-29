// SPDX-License-Identifier: Apache-2.0
import { resolveBxcCommand } from "./spawn";

/** Resolve the local BXC CLI for development, then use its installed binary. */
export async function bxcCommand(): Promise<string[]> {
	return resolveBxcCommand();
}
