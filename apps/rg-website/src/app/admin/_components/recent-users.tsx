import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@rosegriffon/ui";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

interface RecentUser {
	id: string;
	username: string | null;
	avatar_url: string | null;
	full_name: string | null;
	created_at: string | null;
	role: string | null;
}

export function RecentUsers({ users }: { users: RecentUser[] }) {
	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between space-y-0">
				<CardTitle className="text-base">Derniers inscrits</CardTitle>
				<Link
					href="/admin/users"
					className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
				>
					Tout voir
					<ArrowRight className="size-3" aria-hidden="true" />
				</Link>
			</CardHeader>
			<CardContent>
				{users.length === 0 ? (
					<p className="text-sm text-muted-foreground">Aucun utilisateur.</p>
				) : (
					<ul className="divide-y divide-border">
						{users.map((u) => (
							<li key={u.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
								<Avatar className="size-9">
									<AvatarImage src={u.avatar_url ?? ""} alt="" />
									<AvatarFallback className="text-xs">
										{(u.username ?? "?")[0]?.toUpperCase()}
									</AvatarFallback>
								</Avatar>
								<div className="min-w-0 flex-1">
									<p className="truncate text-sm font-medium text-foreground">
										{u.full_name || u.username || "Sans nom"}
									</p>
									<p className="truncate text-xs text-muted-foreground">
										@{u.username ?? "—"}
										{u.created_at &&
											` · ${formatDistanceToNow(new Date(u.created_at), {
												addSuffix: true,
												locale: fr,
											})}`}
									</p>
								</div>
								{u.role && u.role !== "user" && (
									<span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-foreground">
										{u.role}
									</span>
								)}
							</li>
						))}
					</ul>
				)}
			</CardContent>
		</Card>
	);
}
