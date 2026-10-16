"use client";

// External libraries
import { Button, DiscordIcon } from "@rosegriffon/ui";
import { useState } from "react";

import {
	heroSecondaryButtonClass,
	PageContainer,
	PageHero,
	SectionCard,
	SectionHeading,
} from "@/components/shared/PageShell";
import { BreadcrumbSchema } from "@/components/shared/StructuredData";
import { Calendar, MapPin, Search, Tag, X } from "@/lib/icons-config";

// Internal components
import DiscordEventsList from "./_components/DiscordEventsList";
import EventsList from "./_components/EventsList";
import GoogleMapEvents from "./_components/GoogleMapEvents";
// Hooks
import { useDiscordEvents } from "./useDiscordEvents";
import { useEvents } from "./useEvents";

/**
 * Champ de recherche partagé par les deux listes (à venir / passés) : une seule
 * saisie filtre l'ensemble, d'où le bouton de réinitialisation commun.
 */
function EventSearch({
	value,
	onChange,
	onReset,
	label,
}: {
	value: string;
	onChange: (next: string) => void;
	onReset: () => void;
	label: string;
}) {
	return (
		<div className="flex w-full items-center gap-2 md:w-auto">
			<div className="relative flex-1 md:flex-initial">
				<Search
					className="absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground"
					aria-hidden
				/>
				<input
					type="search"
					placeholder="Rechercher…"
					aria-label={label}
					className="w-full rounded-xl border-2 border-input bg-background py-3 pr-4 pl-10 text-foreground transition-all placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-hidden md:w-64"
					value={value}
					onChange={(e) => onChange(e.target.value)}
				/>
			</div>
			{value && (
				<button
					type="button"
					onClick={onReset}
					className="flex items-center gap-2 rounded-xl bg-muted px-4 py-3 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
				>
					<X className="size-5" aria-hidden />
					<span className="hidden sm:inline">Réinitialiser</span>
				</button>
			)}
		</div>
	);
}

export default function PresencesPage() {
	const { events, isLoading } = useEvents();
	const { events: discordEvents, isLoading: isLoadingDiscord } = useDiscordEvents();
	const [searchFilter, setSearchFilter] = useState("");

	// Filtrer par recherche (tous les événements)
	const filteredEvents = searchFilter
		? events.filter(
				(event) =>
					event.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
					event.category.toLowerCase().includes(searchFilter.toLowerCase())
			)
		: events;

	// Filtrer uniquement les événements à venir parmi les événements filtrés
	const upcomingFilteredEvents = filteredEvents.filter(
		(event) => event.type === "upcoming" || event.type === "today"
	);

	const pastFilteredEvents = filteredEvents.filter((event) => event.type === "past");
	const hasUpcomingEvents = upcomingFilteredEvents.length > 0;
	const primaryEvents = hasUpcomingEvents ? upcomingFilteredEvents : pastFilteredEvents;

	const conventionsCount = events.filter((e) => e.category === "Conventions").length;

	// Fonction pour réinitialiser le filtre
	const resetFilter = () => setSearchFilter("");
	const filterConventions = () => setSearchFilter("Convention");

	return (
		<PageContainer>
			<BreadcrumbSchema
				items={[
					{ item: "/", name: "Accueil" },
					{ item: "/evenements", name: "Événements" },
				]}
			/>

			{/* Hero — DA Rose Griffon : marine, brique, or. Volontairement constant
			    d'un thème à l'autre : c'est une bannière de marque, pas une surface. */}
			<PageHero
				icon={<Calendar className="size-7 shrink-0 text-rg-or md:size-8" aria-hidden />}
				eyebrow={
					isLoading
						? "Chargement du calendrier…"
						: `${conventionsCount} convention${conventionsCount > 1 ? "s" : ""} répertoriée${conventionsCount > 1 ? "s" : ""}`
				}
				title="Événements Rose Griffon"
				description="Retrouvez Rose Griffon lors de différents événements tout au long de l'année. Notre association participe à de nombreux évènements pour promouvoir nos activités et rencontrer notre public."
				actions={
					conventionsCount > 0 ? (
						<Button
							type="button"
							onClick={filterConventions}
							variant="outline"
							className={heroSecondaryButtonClass}
						>
							<Tag className="size-4 shrink-0" aria-hidden />
							Voir uniquement les Conventions
						</Button>
					) : undefined
				}
			/>

			{/* Carte des événements */}
			<SectionCard>
				<SectionHeading
					icon={<MapPin className="size-6" aria-hidden />}
					iconClassName="bg-primary text-primary-foreground shadow-primary/20"
					title="Carte des événements"
					subtitle="Localisez Rose Griffon sur la carte de France"
				/>
				<GoogleMapEvents events={events} isLoading={isLoading} />
			</SectionCard>

			{/* Événements Discord */}
			<SectionCard>
				<SectionHeading
					icon={<DiscordIcon className="size-6" aria-hidden />}
					iconClassName="bg-discord text-rg-sur-marine shadow-discord/20"
					title="Événements Discord"
					subtitle="Rejoignez-nous lors de nos événements communautaires sur Discord"
				/>
				<DiscordEventsList events={discordEvents} isLoading={isLoadingDiscord} />
			</SectionCard>

			{/* Recherche UNIQUE : elle pilote les deux listes ci-dessous. Un second
			    champ par section partagerait le même state — deux contrôles pour une
			    seule valeur, donc deux fois le même bouton de réinitialisation. */}
			<SectionCard>
				<SectionHeading
					icon={<Calendar className="size-6" aria-hidden />}
					iconClassName="bg-secondary text-secondary-foreground shadow-secondary/20"
					title={hasUpcomingEvents ? "Prochains événements" : "Derniers événements passés"}
					subtitle={
						searchFilter
							? `Filtre actif : « ${searchFilter} » — ${upcomingFilteredEvents.length} à venir, ${pastFilteredEvents.length} passé(s)`
							: hasUpcomingEvents
								? undefined
								: "Aucun événement à venir : les derniers événements archivés sont affichés."
					}
					action={
						<EventSearch
							value={searchFilter}
							onChange={setSearchFilter}
							onReset={resetFilter}
							label="Rechercher parmi tous les événements"
						/>
					}
				/>
				<EventsList
					events={primaryEvents}
					isLoading={isLoading}
					isFiltered={!!searchFilter}
				/>
			</SectionCard>

			{/* Liste des événements passés */}
			{hasUpcomingEvents && (
			<SectionCard>
				<SectionHeading
					icon={<Calendar className="size-6" aria-hidden />}
					iconClassName="bg-muted text-muted-foreground shadow-foreground/5"
					title="Événements passés"
				/>
				<EventsList events={pastFilteredEvents} isLoading={isLoading} isFiltered={!!searchFilter} />
			</SectionCard>
			)}
		</PageContainer>
	);
}
