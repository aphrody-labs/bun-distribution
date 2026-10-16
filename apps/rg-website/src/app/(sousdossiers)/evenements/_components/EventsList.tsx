import { Calendar, Clock, Info, Map, MapPin } from "lucide-react";
import Link from "next/link";
import { memo } from "react";

import { cn } from "@/lib/utils";

import type { EventCategory, EventData } from "../useEvents";

interface EventsListProps {
	events: EventData[];
	isLoading: boolean;
	/** Vrai si une recherche est active : change le message d'état vide. */
	isFiltered?: boolean;
}

const CATEGORY_COLORS: Record<
	EventCategory | string,
	{ bg: string; text: string; border: string }
> = {
	Conventions: {
		bg: "bg-purple-100 dark:bg-purple-900/30",
		border: "border-purple-200 dark:border-purple-800",
		text: "text-purple-700 dark:text-purple-300",
	},
	"Meet-up": {
		bg: "bg-blue-100 dark:bg-blue-900/30",
		border: "border-blue-200 dark:border-blue-800",
		text: "text-blue-700 dark:text-blue-300",
	},
	"Stand artiste RG": {
		bg: "bg-pink-100 dark:bg-pink-900/30",
		border: "border-pink-200 dark:border-pink-800",
		text: "text-pink-700 dark:text-pink-300",
	},
	"Stand associatif": {
		bg: "bg-emerald-100 dark:bg-emerald-900/30",
		border: "border-emerald-200 dark:border-emerald-800",
		text: "text-emerald-700 dark:text-emerald-300",
	},
};

const DEFAULT_COLOR = {
	bg: "bg-muted",
	border: "border-border",
	text: "text-muted-foreground",
};

function EventsList({ events, isLoading, isFiltered = false }: EventsListProps) {
	if (isLoading) {
		return (
			<div className="flex flex-col items-center justify-center py-12 gap-4">
				<div className="animate-spin rounded-full size-10 border-b-2 border-primary" />
				<p className="text-muted-foreground animate-pulse font-medium">
					Recherche des événements...
				</p>
			</div>
		);
	}

	if (events.length === 0) {
		return (
			<div className="rounded-2xl border-2 border-dashed border-border bg-muted/40 py-12 text-center">
				<Info className="mx-auto mb-3 size-10 text-muted-foreground" aria-hidden />
				<p className="text-lg font-bold text-foreground">
					{isFiltered ? "Aucun événement ne correspond à cette recherche." : "Aucun événement pour le moment."}
				</p>
				<p className="mt-1 text-sm text-muted-foreground">
					{isFiltered
						? "Essayez un autre mot-clé ou réinitialisez le filtre."
						: "Le calendrier public sera mis à jour dès la prochaine date annoncée — les rendez-vous communautaires restent visibles dans la section Discord ci-dessus."}
				</p>
			</div>
		);
	}

	const sortedEvents = [...events].toSorted((a, b) => {
		if (a.type === "today" && b.type !== "today") {
			return -1;
		}
		if (a.type !== "today" && b.type === "today") {
			return 1;
		}
		const aTime = new Date(a.startDate).getTime();
		const bTime = new Date(b.startDate).getTime();
		return Number.isNaN(aTime) || Number.isNaN(bTime) ? 0 : aTime - bTime;
	});

	return (
		<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
			{sortedEvents.map((event, index) => {
				const colors = CATEGORY_COLORS[event.category] || DEFAULT_COLOR;

				return (
					<div
						key={index}
						className={cn(
							"group relative flex flex-col bg-card rounded-3xl overflow-hidden border transition-all duration-500 hover:shadow-2xl hover:-translate-y-2",
							colors.border,
							event.type === "today" && "ring-4 ring-offset-4 ring-offset-card ring-primary shadow-primary/20"
						)}
					>
						{/* Status Strip */}
						<div
							className={cn(
								"h-2 w-full",
								event.type === "today"
									? "bg-primary"
									: event.type === "upcoming"
										? "bg-secondary"
										: "bg-muted-foreground/40"
							)}
						/>

						<div className="p-6 flex-1 flex flex-col gap-5">
							<div className="flex items-start justify-between gap-2">
								<span
									className={cn(
										"inline-flex items-center px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest",
										colors.bg,
										colors.text
									)}
								>
									{event.category}
								</span>
								{event.type === "today" && (
									<span className="animate-pulse px-3 py-1 bg-primary text-primary-foreground text-[10px] font-black rounded-full uppercase tracking-widest">
										AUJOURD'HUI
									</span>
								)}
							</div>

							<h3 className="text-2xl font-bold text-foreground leading-tight group-hover:text-primary transition-colors font-brad-bun-r tracking-tight">
								{event.name}
							</h3>

							<div className="space-y-3 text-sm text-muted-foreground font-medium">
								<div className="flex items-center gap-3">
									<div className="p-1.5 rounded-lg bg-muted">
										<Calendar className="size-4 shrink-0 text-primary" />
									</div>
									<span>
										{event.startDateFormatted.split(" ")[0]}
										{event.endDateFormatted !== event.startDateFormatted &&
											` - ${event.endDateFormatted.split(" ")[0]}`}
									</span>
								</div>
								<div className="flex items-center gap-3">
									<div className="p-1.5 rounded-lg bg-muted">
										<Clock className="size-4 shrink-0 text-primary" />
									</div>
									<span>{event.startDateFormatted.split(" ").slice(1).join(" ")}</span>
								</div>
								<div className="flex flex-col gap-3">
									<div className="flex items-start gap-3">
										<div className="p-1.5 rounded-lg bg-muted mt-0.5">
											<MapPin className="size-4 shrink-0 text-primary" />
										</div>
										<span className="line-clamp-2 leading-relaxed">{event.location}</span>
									</div>

									{event.name.toLowerCase().includes("epitanime") && (
										<Link
											href="/epita-map"
											className="ml-10 inline-flex items-center gap-2 text-xs font-bold text-primary hover:underline hover:opacity-80 transition-colors"
										>
											<Map className="size-3" />
											Voir le plan du campus
										</Link>
									)}
								</div>
							</div>

							{event.description && (
								<div className="mt-auto pt-5 border-t border-border">
									<p className="text-sm text-muted-foreground line-clamp-4 italic leading-relaxed">
										{event.description}
									</p>
								</div>
							)}
						</div>
					</div>
				);
			})}
		</div>
	);
}

export default memo(EventsList);
