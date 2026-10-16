import { Heart } from "lucide-react";

import { PatreonConnectButton } from "./PatreonConnectButton";
import { createPostgresClient } from "@rosegriffon/db/service";

interface Props {
	userId: string;
}

interface LegacyMember {
	id: string;
	full_name: string | null;
	tier_titles: string[] | null;
	rg_subscription_status: string;
}

export async function LegacyBanner({ userId }: Props) {
	const { data } = await createPostgresClient()
		.from("patreon_legacy_members")
		.select("id,full_name,tier_titles,rg_subscription_status")
		.eq("resolved_user_id", userId)
		.eq("rg_subscription_status", "pending")
		.maybeSingle();

	if (!data) {
		return null;
	}
	const legacy = data as LegacyMember;

	return (
		<div className="rounded-2xl border border-[#c9a958]/40 bg-card p-5 text-card-foreground">
			<div className="flex flex-wrap items-center gap-4">
				<Heart className="size-6 shrink-0 text-[#c9a958]" />
				<div className="min-w-0 flex-1">
					<p className="font-semibold">
						Vous étiez supporter Patreon
						{legacy.tier_titles?.[0] ? (
							<>
								{" "}
								<span className="text-[#a08540] dark:text-[#c9a958]">
									({legacy.tier_titles[0]})
								</span>
							</>
						) : null}{" "}
						🌹
					</p>
					<p className="mt-1 text-sm text-muted-foreground">
						Lancez votre soutien direct et conservez votre tarif pendant 12 mois.
					</p>
				</div>
				<PatreonConnectButton variant="reactivate" redirect="/dashboard" />
			</div>
		</div>
	);
}
