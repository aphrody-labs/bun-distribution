import { requireUser } from "@/lib/session";
import AccountSettings from "./AccountSettings";
import { UserNav } from "@/components/user/UserNav";

export const dynamic = "force-dynamic";
// Page strictement personnelle (sessions, export, suppression) : comme
// `/dashboard`, `/favoris` et `/profil/[id]`, elle ne doit pas être indexée.
export const metadata = { title: "Paramètres", robots: { index: false, follow: false } };

export default async function ParametresPage() {
	const me = await requireUser("/parametres");
	return (
		<main className="min-h-screen bg-[#0e0d0b] text-white">
			<div className="mx-auto max-w-4xl px-4 py-8 pb-28 md:px-8 md:py-12">
				<UserNav />
				<AccountSettings
					initial={{
						name: me.user?.username ?? "",
						image: me.user?.avatar ?? "",
						discordId: me.discordId,
					}}
				/>
			</div>
		</main>
	);
}
