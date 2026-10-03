/**
 * Dépôt des candidats de relecture (JSONL non relu) vers l'API du bot Shenron :
 * POST {SHENRON_API_URL}/api/manga/candidates, corps {candidates:[...]}, Bearer SHENRON_API_TOKEN.
 */

export interface CandidateSubmitOptions {
	baseUrl?: string;
	token?: string;
	fetch?: typeof fetch;
}

export function parseCandidateJsonl(text: string): unknown[] {
	const candidates: unknown[] = [];
	for (const [index, line] of text.split(/\r?\n/).entries()) {
		if (!line.trim()) continue;
		let value: unknown;
		try { value = JSON.parse(line); } catch { throw new Error(`invalid candidate JSON at line ${index + 1}`); }
		if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`candidate line ${index + 1} is not an object`);
		candidates.push(value);
	}
	if (!candidates.length) throw new Error("candidate JSONL is empty");
	return candidates;
}

export async function submitCandidates(candidates: unknown[], options: CandidateSubmitOptions = {}): Promise<unknown> {
	const baseUrl = options.baseUrl ?? process.env.APHRODY_SHENRON_API_URL ?? process.env.SHENRON_API_URL;
	const token = options.token ?? process.env.APHRODY_SHENRON_API_TOKEN ?? process.env.SHENRON_API_TOKEN;
	if (!baseUrl) throw new Error("APHRODY_SHENRON_API_URL is not set");
	if (!token) throw new Error("APHRODY_SHENRON_API_TOKEN is not set");
	const url = new URL("/api/manga/candidates", baseUrl);
	const response = await (options.fetch ?? fetch)(url, {
		method: "POST",
		headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
		body: JSON.stringify({ candidates }),
	});
	const body = await response.text();
	if (!response.ok) throw new Error(`candidate submit failed: HTTP ${response.status} ${body.slice(0, 500)}`);
	try { return body ? JSON.parse(body) : null; } catch { return body; }
}

export async function submitCandidateFile(path: string, options: CandidateSubmitOptions = {}): Promise<{ count: number; response: unknown }> {
	const file = Bun.file(path);
	if (file.size > 150_000_000) throw new Error("candidate artifact exceeds 150 MB");
	const candidates = parseCandidateJsonl(await file.text());
	return { count: candidates.length, response: await submitCandidates(candidates, options) };
}
