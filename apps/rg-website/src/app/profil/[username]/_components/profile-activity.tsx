import { Card, CardContent } from "@rosegriffon/ui";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Calendar, FileText, History } from "lucide-react";
import Link from "next/link";

interface Activity {
	id: string;
	slug: string;
	title: string;
	excerpt: string | null;
	created_at: string | null;
}

export function ProfileActivity({ activities }: { activities: Activity[] }) {
	return (
		<section aria-labelledby="activity-title" className="space-y-4">
			<h2 id="activity-title" className="flex items-center gap-2 text-xl font-bold text-foreground">
				<History className="size-5 text-primary" aria-hidden="true" />
				Activités récentes
			</h2>

			{activities.length === 0 ? (
				<Card>
					<CardContent className="p-8 text-center">
						<p className="text-muted-foreground">Aucune activité récente à afficher.</p>
					</CardContent>
				</Card>
			) : (
				<ul className="space-y-4">
					{activities.map((activity) => (
						<li key={activity.id}>
							<Link
								href={`/news/${activity.slug}`}
								className="group block focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-lg"
							>
								<Card className="transition-all group-hover:border-primary/40 group-hover:shadow-md">
									<CardContent className="flex gap-4 p-5">
										<div
											className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary/10"
											aria-hidden="true"
										>
											<FileText className="size-6 text-primary" />
										</div>
										<div className="min-w-0 flex-1">
											<h3 className="truncate font-semibold text-foreground transition-colors group-hover:text-primary">
												{activity.title}
											</h3>
											<p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
												{activity.excerpt || "Chronique publiée"}
											</p>
											<p className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
												<span className="flex items-center gap-1">
													<Calendar className="size-3" aria-hidden="true" />
													{activity.created_at
														? format(new Date(activity.created_at), "d MMMM yyyy", { locale: fr })
														: "Date inconnue"}
												</span>
												<span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
													Chronique
												</span>
											</p>
										</div>
									</CardContent>
								</Card>
							</Link>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
