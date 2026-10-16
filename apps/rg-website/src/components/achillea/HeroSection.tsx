import Image from "next/image";
import Link from "next/link";
import type { ParticipantDTO, Tournament } from "@rosegriffon/achillea-types";
import { TournamentState } from "@rosegriffon/achillea-types";
import { stageTypeLabel, tournamentStateLabel, tournamentStateTone } from "@rosegriffon/achillea-core";
import { Badge } from "@rosegriffon/ui";
import { badgeVariant } from "@/lib/achillea";
import { ArrowRight, Calendar, Radio, Shield, Swords, Trophy, Users } from "lucide-react";

interface HeroSectionProps {
	featured: Tournament | null;
	featuredParticipants: ParticipantDTO[];
	otherActive: Tournament[];
	stats: { joueurs: number; clans: number; partiesClassees: number };
}

const formatNumber = new Intl.NumberFormat("fr-FR");
const formatDate = new Intl.DateTimeFormat("fr-FR", {
	day: "numeric", hour: "2-digit", minute: "2-digit", month: "long", year: "numeric",
});

function tournamentDate(value: unknown): string | null {
	if (!(value instanceof Date) && typeof value !== "string") return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : formatDate.format(date);
}

function tournamentImage(tournament: Tournament): string | null {
	const extended = tournament as Tournament & { affiche?: string | null; logo?: string | null };
	const value = extended.affiche ?? extended.logo;
	return typeof value === "string" && value.trim() ? value : null;
}

/** Entrée publique, basée sur la hiérarchie du legacy: un tournoi et quatre accès. */
export function HeroSection({ featured, featuredParticipants, otherActive, stats }: HeroSectionProps) {
	const isLive = featured?.internalState === TournamentState.ONGOING;
	const startsAt = featured ? tournamentDate(featured.startsAt) : null;
	const capacity = featured?.participantsNumber ?? 0;
	const registered = featuredParticipants.length;
	const fill = capacity > 0 ? Math.min(100, Math.round((registered / capacity) * 100)) : null;

	return (
		<section className="achillea-home" aria-labelledby="achillea-home-title">
			<div className="achillea-home__backdrop" aria-hidden="true" />
			<div className="achillea-home__content">
				<header className="achillea-home__intro">
					<Image src="/achillea/achillea site titre transparent-2.webp" alt="Achilléa" width={740} height={196} priority className="achillea-home__wordmark" />
					<h1 id="achillea-home-title" className="sr-only">Achilléa</h1>
					<p>La scène compétitive Inazuma Eleven: Victory Road.</p>
					<dl className="achillea-home__stats" aria-label="Chiffres de la scène Achilléa">
						<div><dt>Joueurs</dt><dd>{formatNumber.format(stats.joueurs)}</dd></div>
						<div><dt>Clans</dt><dd>{formatNumber.format(stats.clans)}</dd></div>
						<div><dt>Matchs classés</dt><dd>{formatNumber.format(stats.partiesClassees)}</dd></div>
					</dl>
				</header>

				{featured ? (
					<section className="achillea-home__featured" aria-labelledby="featured-tournament-title">
						<div className="achillea-home__section-head">
							<div className="flex items-center gap-3">
								{isLive ? <Radio className="size-5 text-red-300" aria-hidden="true" /> : <Trophy className="size-5 text-achillea-lime" aria-hidden="true" />}
								<p>{isLive ? "En direct" : "Tournoi à la une"}</p>
							</div>
							<Link href="/achillea/tournaments" className="achillea-home__text-link">Tous les tournois <ArrowRight aria-hidden="true" /></Link>
						</div>
						<Link href={`/achillea/tournaments/${featured.id}`} className="achillea-home__featured-card">
							{tournamentImage(featured) && <Image src={tournamentImage(featured)!} alt="" fill sizes="(max-width: 840px) 100vw, 900px" className="object-cover opacity-30" />}
							<div className="achillea-home__featured-scrim" aria-hidden="true" />
							<div className="achillea-home__featured-body">
								<div className="flex flex-wrap items-center gap-3">
									<Badge variant={badgeVariant(tournamentStateTone(featured.internalState))}>{tournamentStateLabel(featured.internalState)}</Badge>
									{isLive && <span className="achillea-home__live">En cours</span>}
								</div>
								<h2 id="featured-tournament-title">{featured.name}</h2>
								<ul className="achillea-home__facts" aria-label="Informations du tournoi">
									<li><Swords aria-hidden="true" />{stageTypeLabel(featured.tournamentType)}</li>
									{startsAt && <li><Calendar aria-hidden="true" />{startsAt}</li>}
									{capacity > 0 && <li><Users aria-hidden="true" />{registered} / {capacity} inscrits</li>}
								</ul>
								{fill !== null && <div className="achillea-home__progress" aria-label={`${fill} % des places occupées`}><div><span>Inscriptions</span><strong>{fill} %</strong></div><span><i style={{ width: `${fill}%` }} /></span></div>}
								<span className="achillea-home__cta">Voir le tableau et les inscriptions <ArrowRight aria-hidden="true" /></span>
							</div>
						</Link>
						{otherActive.length > 0 && <ul className="achillea-home__other-events" aria-label="Autres tournois actifs">
							{otherActive.slice(0, 3).map((tournament) => <li key={tournament.id}><Link href={`/achillea/tournaments/${tournament.id}`}><span>{tournament.name}</span><small>{tournamentStateLabel(tournament.internalState)}</small><ArrowRight aria-hidden="true" /></Link></li>)}
						</ul>}
					</section>
				) : (
					<section className="achillea-home__featured achillea-home__empty" aria-labelledby="tournaments-empty-title">
						<Trophy aria-hidden="true" /><div><h2 id="tournaments-empty-title">Calendrier des tournois</h2><p>Aucun tournoi n’est actuellement publié.</p></div><Link href="/achillea/tournaments">Consulter le calendrier <ArrowRight aria-hidden="true" /></Link>
					</section>
				)}

				<nav className="achillea-home__actions" aria-label="Accès rapides Achilléa">
					<Link href="/achillea/clans"><Users aria-hidden="true" /><span><strong>Clans</strong><small>Équipes et recrutements</small></span><ArrowRight aria-hidden="true" /></Link>
					<Link href="/achillea/ranked"><Swords aria-hidden="true" /><span><strong>Classé</strong><small>File 1v1 et 2v2</small></span><ArrowRight aria-hidden="true" /></Link>
					<Link href="/achillea/ranked/leaderboard"><Trophy aria-hidden="true" /><span><strong>Classements</strong><small>Joueurs et paliers ELO</small></span><ArrowRight aria-hidden="true" /></Link>
					<Link href="/achillea/tournaments/circuit/ranking"><Shield aria-hidden="true" /><span><strong>Circuit</strong><small>Classement des tournois</small></span><ArrowRight aria-hidden="true" /></Link>
				</nav>
			</div>
		</section>
	);
}
