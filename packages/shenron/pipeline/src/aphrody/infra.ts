// SPDX-License-Identifier: Apache-2.0
/** Read-only Shenron access to Aphrody's canonical infrastructure inventory. */
import { runAphrodyCli, type AphrodyCliOptions, type CliResult } from "./cli";

export interface AphrodyInfraTargetCheck {
	target: string;
	status: string;
	ok: boolean;
}

export interface AphrodyInfraCheck {
	targets: AphrodyInfraTargetCheck[];
	raw: string;
	success: boolean;
}

/** Read configured targets and their cataloged services (`aphrody infra status --json`). */
export function aphrodyInfraStatus(
	options: Omit<AphrodyCliOptions, "json"> = {},
): Promise<CliResult<Record<string, unknown>>> {
	return runAphrodyCli<Record<string, unknown>>(["infra", "status", "--json"], {
		...options,
		json: true,
	});
}

/** Check SSH connectivity/topology for configured hosts (`aphrody infra check`). */
export async function aphrodyInfraCheck(
	options: Omit<AphrodyCliOptions, "json"> = {},
): Promise<CliResult<AphrodyInfraCheck>> {
	const result = await runAphrodyCli(["infra", "check"], options);
	if (result.kind !== "exit" || !result.ok) return result;
	const targets = result.stdout.split(/\r?\n/).flatMap((line) => {
		const match = /^\s*\*\s*([^:]+):\s*(.*?)\s*$/.exec(line);
		if (!match) return [];
		const status = match[2]!;
		return [{ target: match[1]!.trim(), status, ok: status.toLowerCase() === "ok" }];
	});
	return {
		...result,
		data: { targets, raw: result.stdout, success: result.code === 0 },
	};
}
