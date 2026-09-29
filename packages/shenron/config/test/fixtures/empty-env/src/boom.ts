export function required(env: Readonly<Record<string, string | undefined>>): string {
	const value = env.SHENRON_FIXTURE_REQUIRED;
	if (!value) throw new Error("SHENRON_FIXTURE_REQUIRED is not set");
	return value;
}

export const value = required(globalThis.process.env);
