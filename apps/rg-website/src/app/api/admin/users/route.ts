import { NextResponse } from "next/server";

import { requireApiAdmin } from "@/lib/api-auth";
import { createPostgresClient } from "@rosegriffon/db/service";

export async function GET(req: Request) {
	const auth = await requireApiAdmin();
	if (!auth.ok) {
		return auth.response;
	}

	try {
		const supabase = createPostgresClient();

		const url = new URL(req.url);
		const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
		const limitRaw = Number(url.searchParams.get("limit")) || 50;
		const limit = Math.max(1, Math.min(limitRaw, 200));
		const from = (page - 1) * limit;
		const to = from + limit - 1;

		const {
			data: users,
			error,
			count,
		} = await supabase
			.from("profiles")
			.select("id,email,full_name,role,discord_id,claimed_at,updated_at", {
				count: "exact",
			})
			.order("updated_at", { ascending: false, nullsFirst: false })
			.range(from, to);

		if (error) {
			throw error;
		}

		const formattedUsers = (users ?? []).map((u: Record<string, unknown>) => ({
			...u,
			created_at: u.claimed_at ?? u.updated_at,
		}));

		return NextResponse.json({
			data: formattedUsers,
			pagination: {
				limit,
				page,
				total: count ?? 0,
				totalPages: count ? Math.ceil(count / limit) : 1,
			},
			success: true,
		});
	} catch (error) {
		console.error("Erreur GET utilisateurs:", error);
		return NextResponse.json(
			{ error: "Erreur lors du chargement des utilisateurs", success: false },
			{ status: 500 }
		);
	}
}
