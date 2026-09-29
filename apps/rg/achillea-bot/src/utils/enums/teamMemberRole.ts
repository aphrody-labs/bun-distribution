export enum TeamMemberRole {
	PLAYER,
	SUB,
	COACH,
}

export const TEAM_MEMBER_ROLE_CONFIG: Record<
	TeamMemberRole,
	{ label: string; max: number; inputPrefix: string; frenchLabel: string }
> = {
	[TeamMemberRole.PLAYER]: {
		label: "Joueur",
		frenchLabel: "joueurs",
		max: 5,
		inputPrefix: "player",
	},
	[TeamMemberRole.SUB]: {
		label: "Remplaçant",
		frenchLabel: "remplaçants",
		max: 2,
		inputPrefix: "sub",
	},
	[TeamMemberRole.COACH]: {
		label: "Coach",
		frenchLabel: "coach",
		max: 1,
		inputPrefix: "coach",
	},
};
