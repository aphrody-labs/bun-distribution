import { createPostgresClient } from "@rosegriffon/db/service";
import { redirect } from "next/navigation";

import { getServerUser } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
	const user = await getServerUser();
	if (!user) {
		redirect("/login");
	}

	const supabase = createPostgresClient();
	const { data: profile } = await supabase
		.from("profiles")
		.select("username")
		.eq("id", user.id)
		.maybeSingle();

	const username = (profile as { username?: string } | null)?.username;
	if (username) {
		redirect(`/profil/${encodeURIComponent(username)}`);
	}
	redirect("/settings");
}
