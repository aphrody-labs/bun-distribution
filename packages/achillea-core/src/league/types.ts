/** Un match de championnat (résultat d'équipe). */
export interface LeagueMatchResult {
	homeId: string;
	awayId: string;
	homeScore: number;
	awayScore: number;
	matchday: number;
	overtime?: boolean;
	winnerId?: string | null;
	playedAt?: string | Date | null;
}
