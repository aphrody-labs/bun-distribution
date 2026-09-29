import type { DataStore } from "@/services/DataStore";
import { defaultData } from "@/services/data-defaults";
import { ClanMemberDistinction } from "@/utils/enums";

export type ClanMemberLimits = {
	playerLimit: number;
	staffLimit: number;
};

export const CLAN_MEMBER_LIMIT_BOUNDS = {
	player: { min: 1, max: 100 },
	staff: { min: 1, max: 50 },
} as const;

export function normalizeClanMemberLimits(input: {
	playerLimit?: unknown;
	staffLimit?: unknown;
}): ClanMemberLimits {
	const bound = (value: unknown, fallback: number, min: number, max: number) => {
		const n = typeof value === "number" ? value : Number(value);
		if (!Number.isFinite(n)) return fallback;
		return Math.round(Math.max(min, Math.min(max, n)));
	};

	return {
		playerLimit: bound(
			input.playerLimit,
			defaultData.clanPlayerLimit,
			CLAN_MEMBER_LIMIT_BOUNDS.player.min,
			CLAN_MEMBER_LIMIT_BOUNDS.player.max
		),
		staffLimit: bound(
			input.staffLimit,
			defaultData.clanStaffLimit,
			CLAN_MEMBER_LIMIT_BOUNDS.staff.min,
			CLAN_MEMBER_LIMIT_BOUNDS.staff.max
		),
	};
}

export function checkClanMemberLimitExceeded(
	counts: { players: number; staff: number },
	limits: ClanMemberLimits,
	desiredDistinctions: ClanMemberDistinction[]
): "player" | "staff" | null {
	if (
		!desiredDistinctions.includes(ClanMemberDistinction.Player) &&
		!desiredDistinctions.includes(ClanMemberDistinction.Staff)
	) {
		return null;
	}

	if (
		desiredDistinctions.includes(ClanMemberDistinction.Player) &&
		counts.players >= limits.playerLimit
	) {
		return "player";
	}

	if (
		desiredDistinctions.includes(ClanMemberDistinction.Staff) &&
		counts.staff >= limits.staffLimit
	) {
		return "staff";
	}

	return null;
}

export async function getClanMemberLimits(store?: DataStore): Promise<ClanMemberLimits> {
	const source = store ?? new (await import("@/services/DataStore")).DataStore();
	const [playerLimit, staffLimit] = await Promise.all([
		source.getOrDefault("clanPlayerLimit", defaultData.clanPlayerLimit),
		source.getOrDefault("clanStaffLimit", defaultData.clanStaffLimit),
	]);

	return normalizeClanMemberLimits({ playerLimit, staffLimit });
}

export async function setClanMemberLimits(
	limits: ClanMemberLimits,
	store?: DataStore
): Promise<ClanMemberLimits> {
	const source = store ?? new (await import("@/services/DataStore")).DataStore();
	const normalized = normalizeClanMemberLimits(limits);
	await source.set("clanPlayerLimit", normalized.playerLimit);
	await source.set("clanStaffLimit", normalized.staffLimit);
	return normalized;
}
