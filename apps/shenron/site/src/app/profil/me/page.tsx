import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ProfilMePage() {
	const me = await requireUser("/profil/me");
	redirect(`/profil/${me.discordId}?member=1`);
}
