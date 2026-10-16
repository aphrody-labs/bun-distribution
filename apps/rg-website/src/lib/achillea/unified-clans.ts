/** Annuaire public fourni par l'API Achilléa unifiée. */
export interface PublicClan {
	id: number;
	name: string;
	shortName: string;
	avatarUrl: string;
	biography: string;
	fame: number;
	isRecruiting: boolean;
	membersLimit: boolean;
}

const PAGE_SIZE = 50;
type Fetcher = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

export async function listPublicClans(
	fetcher: Fetcher = fetch,
	baseUrl = process.env.NEXT_PUBLIC_ACHILLEA_UNIFIED_API_URL ??
		"https://api.rosegriffon.fr",
): Promise<PublicClan[]> {
	const clans: PublicClan[] = [];
	let page = 1;
	let count: number;
	do {
		const url = new URL("/v1/achillea/clans", baseUrl);
		url.searchParams.set("page", String(page));
		url.searchParams.set("pageSize", String(PAGE_SIZE));
		const response = await fetcher(url, { cache: "no-store" });
		if (!response.ok)
			throw new Error(`Achilléa clans: HTTP ${response.status}`);
		const payload: unknown = await response.json();
		if (!isPublicClanList(payload))
			throw new Error("Achilléa clans: réponse invalide");
		clans.push(...payload.data);
		count = payload.count;
		page++;
	} while (clans.length < count && page <= Math.ceil(count / PAGE_SIZE));
	if (clans.length < count) throw new Error("Achilléa clans: annuaire incomplet");
	return clans;
}

export async function getPublicClan(
	id: number,
	fetcher: Fetcher = fetch,
	baseUrl = process.env.NEXT_PUBLIC_ACHILLEA_UNIFIED_API_URL ??
		"https://api.rosegriffon.fr",
): Promise<PublicClan> {
	if (!Number.isSafeInteger(id) || id <= 0) {
		throw new Error("Achilléa clans: identifiant invalide");
	}
	const url = new URL(`/v1/achillea/clans/${id}`, baseUrl);
	const response = await fetcher(url, { cache: "no-store" });
	if (!response.ok) throw new Error(`Achilléa clan ${id}: HTTP ${response.status}`);
	const payload: unknown = await response.json();
	if (!isPublicClan(payload) || payload.id !== id) {
		throw new Error(`Achilléa clan ${id}: réponse invalide`);
	}
	return payload;
}

export function isPublicClan(
	value: unknown,
): value is PublicClan {
	if (!value || typeof value !== "object") return false;
	const item = value as Partial<PublicClan>;
	return (
		typeof item.id === "number" &&
		Number.isSafeInteger(item.id) &&
		typeof item.name === "string" &&
		typeof item.shortName === "string" &&
		typeof item.avatarUrl === "string" &&
		typeof item.biography === "string" &&
		typeof item.fame === "number" &&
		typeof item.isRecruiting === "boolean" &&
		typeof item.membersLimit === "boolean"
	);
}

function isPublicClanList(
	value: unknown,
): value is { data: PublicClan[]; count: number } {
	if (!value || typeof value !== "object") return false;
	const result = value as { data?: unknown; count?: unknown };
	return (
		typeof result.count === "number" &&
		Number.isInteger(result.count) &&
		result.count >= 0 &&
		Array.isArray(result.data) &&
		result.data.every(isPublicClan)
	);
}
