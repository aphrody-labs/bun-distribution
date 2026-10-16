import { Card, CardContent, CardHeader, CardTitle } from "@rosegriffon/ui";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { ArrowRight, CalendarClock, MapPin } from "lucide-react";
import Link from "next/link";

interface UpcomingEvent {
	id: string;
	title: string;
	start_time: string;
	location: string | null;
}

export function UpcomingEvents({ events }: { events: UpcomingEvent[] }) {
	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between space-y-0">
				<CardTitle className="text-base">Prochains événements</CardTitle>
				<Link
					href="/admin/events"
					className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
				>
					Tout voir
					<ArrowRight className="size-3" aria-hidden="true" />
				</Link>
			</CardHeader>
			<CardContent>
				{events.length === 0 ? (
					<p className="text-sm text-muted-foreground">Aucun événement à venir.</p>
				) : (
					<ul className="divide-y divide-border">
						{events.map((e) => (
							<li key={e.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
								<div
									className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-alerte/15 text-alerte"
									aria-hidden="true"
								>
									<CalendarClock className="size-4" />
								</div>
								<div className="min-w-0 flex-1">
									<p className="truncate text-sm font-medium text-foreground">{e.title}</p>
									<p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
										<span>
											{format(new Date(e.start_time), "d MMM · HH:mm", {
												locale: fr,
											})}
										</span>
										{e.location && (
											<span className="flex items-center gap-1">
												<MapPin className="size-3" aria-hidden="true" />
												{e.location}
											</span>
										)}
									</p>
								</div>
							</li>
						))}
					</ul>
				)}
			</CardContent>
		</Card>
	);
}
