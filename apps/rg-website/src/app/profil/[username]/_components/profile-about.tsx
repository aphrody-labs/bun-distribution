import { Card, CardContent } from "@rosegriffon/ui";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { ShieldCheck, User } from "lucide-react";

interface StaffMember {
	role?: string;
	team_name?: string;
}

interface ProfileAboutProps {
	role: string | null;
	updatedAt: string | null;
	staffMember: StaffMember | null;
}

export function ProfileAbout({ role, updatedAt, staffMember }: ProfileAboutProps) {
	return (
		<Card>
			<CardContent className="p-6">
				<h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-foreground">
					<User className="size-4 text-muted-foreground" aria-hidden="true" />À propos
				</h2>

				{staffMember && (
					<div className="mb-4 rounded-lg border border-sky-500/30 bg-sky-500/10 p-3">
						<p className="mb-1 flex items-center gap-2 font-semibold text-sky-700 dark:text-sky-300">
							<ShieldCheck className="size-4" aria-hidden="true" />
							Staff Officiel
						</p>
						<p className="text-xs text-sky-700/80 dark:text-sky-300/80">
							{staffMember.role}
							{staffMember.team_name ? ` • ${staffMember.team_name}` : ""}
						</p>
					</div>
				)}

				<dl className="space-y-3 text-sm">
					<div className="flex items-center justify-between">
						<dt className="text-muted-foreground">Rôle</dt>
						<dd className="font-medium capitalize text-foreground">{role || "Membre"}</dd>
					</div>
					<div className="flex items-center justify-between">
						<dt className="text-muted-foreground">Dernière activité</dt>
						<dd className="font-medium text-foreground">
							{updatedAt ? format(new Date(updatedAt), "d MMM yyyy", { locale: fr }) : "Récemment"}
						</dd>
					</div>
				</dl>
			</CardContent>
		</Card>
	);
}
