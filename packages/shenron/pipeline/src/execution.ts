// SPDX-License-Identifier: Apache-2.0

export interface CommandOutput {
	code: number;
	stdout: string;
	stderr: string;
}

export interface PipelineExecution extends CommandOutput {
	command: string[];
	status: "executed" | "planned";
}

export type CommandRunner = (command: string[], cwd: string) => Promise<CommandOutput>;

async function defaultRunner(command: string[], cwd: string): Promise<CommandOutput> {
	const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe", env: process.env });
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { code, stdout, stderr };
}

export async function executeCommand(
	command: string[],
	options: { cwd: string; dryRun?: boolean; runner?: CommandRunner },
): Promise<PipelineExecution> {
	if (options.dryRun) return { command, code: 0, stdout: "", stderr: "", status: "planned" };
	const output = await (options.runner ?? defaultRunner)(command, options.cwd);
	if (output.code !== 0) {
		const detail = output.stderr.trim() || output.stdout.trim() || "aucun diagnostic";
		throw new Error(`Commande échouée (${output.code}): ${command.join(" ")}\n${detail}`);
	}
	return { ...output, command, status: "executed" };
}
