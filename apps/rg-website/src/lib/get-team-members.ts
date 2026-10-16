"use server";

import { getEnv } from "@/lib/env";
import { getPgPool } from "@/lib/db/pg";

export interface TeamMemberResponse {
	metadata: {
		memberName: string;
		memberRole: string;
		memberIndex: number;
		memberLink: string;
	};
	url: string;
}

interface TeamMemberRow {
	display_index: number | null;
	member_link: string | null;
	name: string;
	role: string | null;
	image_url: string | null;
}

/**
 * Fetches team members via connexion Postgres DIRECTE (bypass le Data API PostgREST de
 * Supabase, cf. apps/website/src/lib/db/pg.ts) based on the team ID
 * @param teamId - ID of the team to fetch (e.g., "loreteam", "productionteam")
 * @returns Array of team members with their metadata and image URLs
 */
export default async function getTeamMembers(teamId: string): Promise<TeamMemberResponse[]> {
	try {
		const pool = getPgPool();

		// Ne charge que les membres actifs et trie par display_index puis nom
		// (tri secondaire pour les ex-aequo / display_index null).
		const { rows } = await pool.query<TeamMemberRow>(
			`SELECT display_index, member_link, name, role, image_url
			 FROM team_members
			 WHERE team_id = $1 AND is_active = true
			 ORDER BY display_index ASC NULLS LAST, name ASC`,
			[teamId]
		);

		// Transform database records to TeamMemberResponse format
		const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");

		return (rows || []).map((member) => {
			// Fix image URLs that contain {url} placeholder or double https://
			let imageUrl = member.image_url || "";

			// Replace {url} placeholder with actual Supabase URL
			if (imageUrl.includes("{url}")) {
				imageUrl = imageUrl.replace("{url}", supabaseUrl);
			}

			// Fix double https:// (happens if DB already has https:// instead of {url})
			if (imageUrl.startsWith("https://https://")) {
				imageUrl = imageUrl.replace("https://https://", "https://");
			}

			return {
				metadata: {
					memberIndex: member.display_index || 999,
					memberLink: member.member_link || "",
					memberName: member.name,
					memberRole: member.role || "",
				},
				url: imageUrl,
			};
		});
	} catch (error) {
		console.error(`Error fetching ${teamId} members:`, error);
		return [];
	}
}
