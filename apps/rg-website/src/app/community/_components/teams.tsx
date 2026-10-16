import Link from "next/link";

import ImageWithSkeleton from "@/components/shared/ImageWithSkeleton";
import { TeamStructuredData } from "@/components/shared/StructuredData";
import getTeamMembers from "@/lib/get-team-members";
import { absoluteUrl } from "@/lib/site-url";

// Rôle générique inséré par le sync Discord en attendant un libellé précis :
// On l'affiche en "Membre" pour ne pas exposer le placeholder technique.
const PLACEHOLDER_ROLE = "Staff";
const PUBLIC_PLACEHOLDER_LABEL = "Membre";

const TEAM_CONFIG: Record<string, string> = {
	achilleateam: "Équipe Achilléa",
	azaleeteam: "Équipe Azalée",
	dessinateurteam: "Équipe Dessinateur",
	loreteam: "Équipe Lore",
	mediationteam: "Cellule de Médiation",
	productionteam: "Équipe Production",
	socialteam: "Équipe Réseaux",
};

/**
 * Section serveur (RSC) : toutes les équipes sont récupérées côté serveur et
 * rendues dans le HTML SSR (le `<Suspense>` parent gère le skeleton). Remplace
 * l'ancien rendu client-only (useTeams/react-query) qui ne sortait que des
 * skeletons côté SSR et rendait l'ISR `revalidate` inopérant.
 */
async function TeamsSection() {
	const teamIds = Object.keys(TEAM_CONFIG);
	const teamsData = await Promise.all(
		teamIds.map(async (teamId) => {
			const members = await getTeamMembers(teamId);
			return {
				name: TEAM_CONFIG[teamId] ?? teamId,
				members: members.map((member) => ({
					name: member.metadata.memberName,
					role: member.metadata.memberRole,
					image: member.url,
					link: member.metadata.memberLink || undefined,
				})),
			};
		})
	);
	const teams = teamsData.filter((team) => team.members.length > 0);

	const allMembers = teams.flatMap((team) =>
		team.members.map((member) => ({
			name: member.name,
			role: member.role === PLACEHOLDER_ROLE ? `${team.name}` : member.role || team.name,
			image: member.image || undefined,
			sameAs: member.link && member.link.startsWith("http") ? [member.link] : undefined,
		}))
	);

	return (
		<section className="flex flex-col gap-10 lg:gap-12">
			<TeamStructuredData
				pageName="Le Staff RG"
				url={absoluteUrl("/community")}
				members={allMembers}
			/>
			{/* Header Section */}
			<div className="text-center lg:text-left space-y-4 max-w-4xl mx-auto lg:mx-0 animate-fade-in">
				<h1 className="text-4xl lg:text-5xl font-black bg-linear-to-r from-gaelle-blue to-gaelle-blue-light dark:from-gaelle-blue-light dark:to-gaelle-blue bg-clip-text text-transparent">
					Nos Équipes
				</h1>
				<p className="text-base lg:text-lg text-gray-600 dark:text-gray-300 leading-relaxed">
					Découvrez les talents qui donnent vie à l&apos;univers de Rose Griffon. Notre équipe
					passionnée travaille ensemble pour créer des histoires captivantes et des illustrations
					magnifiques.
				</p>
				<div className="w-24 h-1 bg-linear-to-r from-gaelle-blue to-gaelle-blue-light rounded-full mx-auto lg:mx-0" />
			</div>

			{/* Teams Grid */}
			<div className="flex flex-col gap-10 sm:gap-12 lg:gap-16">
				{teams.length === 0 ? (
					<div className="col-span-full text-center py-12">
						<p className="text-gray-500 dark:text-gray-400">
							Aucune équipe à afficher pour le moment.
						</p>
					</div>
				) : (
					teams.map((team, teamIdx) => (
						<div
							key={team.name}
							className="flex flex-col gap-6 animate-fade-in"
							style={{ animationDelay: `${teamIdx * 100}ms` }}
						>
							{/* Team Header */}
							<div className="flex items-center gap-2 sm:gap-3">
								<h2 className="text-xl sm:text-2xl lg:text-3xl font-bold bg-linear-to-r from-gaelle-blue to-gaelle-blue-light dark:from-gaelle-blue-light dark:to-gaelle-blue bg-clip-text text-transparent">
									{team.name}
								</h2>
								<span
									className="text-xs sm:text-sm font-medium text-gaelle-blue/80 dark:text-gaelle-blue-light/80 bg-gaelle-blue/10 dark:bg-gaelle-blue/20 px-2 py-0.5 rounded-full"
									aria-label={`${team.members.length} membres`}
								>
									{team.members.length}
								</span>
								<div className="flex-1 h-0.5 bg-linear-to-r from-gaelle-blue/50 to-transparent rounded-full" />
							</div>

							{/* Team Members Grid */}
							<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4 lg:gap-6">
								{team.members.map((member, memberIdx) => {
									const displayedRole =
										member.role === PLACEHOLDER_ROLE ? PUBLIC_PLACEHOLDER_LABEL : member.role;
									const cardContent = (
										<>
											{/* Member Image */}
											<div className="relative size-24 sm:w-32 sm:h-32 lg:w-40 lg:h-40 rounded-full overflow-hidden border-3 sm:border-4 border-gaelle-blue/30 group-hover:border-gaelle-blue transition-all duration-300 group-hover:shadow-lg group-hover:shadow-gaelle-blue/20">
												<ImageWithSkeleton
													src={member.image || "/RG_Logo_V2.5.webp"}
													alt={`${member.name}, ${displayedRole} — ${team.name} Rose Griffon`}
													priority={memberIdx < 3}
												/>
											</div>

											{/* Member Info */}
											<div className="flex flex-col gap-1 w-full">
												<h3 className="font-bold text-xs sm:text-sm lg:text-base text-gray-900 dark:text-white group-hover:text-gaelle-blue dark:group-hover:text-gaelle-blue-light transition-colors duration-200 wrap-break-word">
													{member.name}
												</h3>
												<p className="text-[10px] sm:text-xs lg:text-sm text-gaelle-blue dark:text-gaelle-blue-light font-medium bg-gaelle-blue/10 dark:bg-gaelle-blue/20 px-2 py-0.5 sm:py-1 rounded-full inline-block mx-auto">
													{displayedRole}
												</p>
											</div>
										</>
									);

									const className =
										"group flex flex-col items-center text-center gap-2 sm:gap-3 p-2 sm:p-3 lg:p-4 rounded-2xl hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-all duration-300 animate-fade-in";
									const style = { animationDelay: `${teamIdx * 100 + memberIdx * 50}ms` };

									return member.link ? (
										<Link
											key={`${member.name}-${memberIdx}`}
											href={member.link}
											target={member.link.startsWith("http") ? "_blank" : undefined}
											rel={member.link.startsWith("http") ? "noopener noreferrer" : undefined}
											className={className}
											style={style}
											aria-label={`Voir ${member.name} (${displayedRole})`}
										>
											{cardContent}
										</Link>
									) : (
										<div key={`${member.name}-${memberIdx}`} className={className} style={style}>
											{cardContent}
										</div>
									);
								})}
							</div>
						</div>
					))
				)}
			</div>
		</section>
	);
}

export default TeamsSection;
