/** Defaults for the Achillea EAV data table, safe to read without service boot. */
export const defaultData = {
	maintenance: false,
	lastMaintenance: Date.now(),
	lastStartup: Date.now(),
	rankedEnabled: false,
	leaderboardMessageId: "",
	rankedQueueMessageId: "",
	rankedTierSnapshot: {} as Record<string, number>,
	clanPlayerLimit: 30,
	clanStaffLimit: 7,
	playerNotesDocId: "",
};
