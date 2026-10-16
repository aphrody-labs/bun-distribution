import ImageWithSkeleton from "@/components/shared/ImageWithSkeleton";
import { TeamStructuredData } from "@/components/shared/StructuredData";
import getTeamMembers from "@/lib/get-team-members";

interface TeamMembersSectionProps {
  teamName: string;
  title: string;
  description: string;
  showRole?: boolean;
  /** URL canonique de la page hôte pour les données structurées (ProfilePage). */
  canonicalUrl?: string;
  isH1?: boolean;
}

/**
 * Section serveur : les membres sont récupérés côté serveur (RSC) et rendus dans
 * le HTML SSR. Le `<Suspense>` parent affiche le skeleton pendant le fetch, puis
 * stream le contenu — fini le rendu client-only (skeleton figé + mauvais SEO).
 */
async function TeamMembersSection({
  teamName,
  title,
  description,
  showRole = false,
  canonicalUrl,
  isH1 = false,
}: TeamMembersSectionProps) {
  const response = await getTeamMembers(teamName);
  const members = response
    .map(member => ({
      name: member.metadata.memberName,
      role: member.metadata.memberRole,
      index: member.metadata.memberIndex,
      image: member.url,
      link: member.metadata.memberLink,
    }))
    .toSorted((a, b) => a.index - b.index);

  return (
    <section className="flex flex-col gap-10 lg:gap-12">
      {canonicalUrl && members.length > 0 && (
        <TeamStructuredData
          pageName={title}
          url={canonicalUrl}
          members={members.map(member => ({
            name: member.name,
            role: member.role || undefined,
            image: member.image || undefined,
            sameAs: member.link && member.link.startsWith("http") ? [member.link] : undefined,
          }))}
        />
      )}
      <div className="text-center space-y-4 max-w-4xl mx-auto animate-fade-in">
        {isH1 ? (
          <h1 className="text-4xl lg:text-6xl font-black bg-linear-to-r from-gaelle-blue to-gaelle-blue-light dark:from-gaelle-blue-light dark:to-gaelle-blue bg-clip-text text-transparent">
            {title}
          </h1>
        ) : (
          <h2 className="text-4xl lg:text-6xl font-black bg-linear-to-r from-gaelle-blue to-gaelle-blue-light dark:from-gaelle-blue-light dark:to-gaelle-blue bg-clip-text text-transparent">
            {title}
          </h2>
        )}
        <p className="text-lg lg:text-xl text-gray-700 dark:text-gray-300 leading-relaxed">{description}</p>
        <div className="w-24 h-1 bg-linear-to-r from-gaelle-blue to-gaelle-blue-light mx-auto rounded-full" />
      </div>

      {members.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-500 dark:text-gray-400">Aucun membre à afficher pour le moment.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-6 lg:gap-8 mt-6">
          {members.map((member, idx) => (
            <div
              key={`${member.name}-${idx}`}
              className="group flex flex-col items-center text-center gap-3 sm:gap-4 w-full p-4 sm:p-6 rounded-2xl hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-all duration-300 animate-fade-in"
              style={{ animationDelay: `${idx * 50}ms` }}
            >
              <div className="relative">
                <div className="relative size-28 sm:w-36 sm:h-36 lg:w-40 lg:h-40 rounded-full overflow-hidden border-3 sm:border-4 border-gaelle-blue group-hover:border-gaelle-blue-light transition-all duration-300 group-hover:scale-105 group-hover:shadow-2xl group-hover:shadow-gaelle-blue/20">
                  <ImageWithSkeleton
                    src={member.image || "/RG_Logo_V2.5.webp"}
                    alt={
                      member.role ? `${member.name}, ${member.role} — Rose Griffon` : `${member.name} — Rose Griffon`
                    }
                    priority={member.index < 3}
                  />
                </div>
                {/* Glow effect */}
                <div className="absolute inset-0 rounded-full bg-gaelle-blue/20 blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 -z-10" />
              </div>
              <div className="space-y-1 w-full">
                <h3 className="text-base sm:text-lg lg:text-xl font-bold text-gray-900 dark:text-white group-hover:text-gaelle-blue dark:group-hover:text-gaelle-blue-light transition-colors duration-200 wrap-break-word">
                  {member.name}
                </h3>
                {showRole && (
                  <p className="text-xs sm:text-sm lg:text-base font-medium text-gaelle-blue dark:text-gaelle-blue-light bg-gaelle-blue/10 dark:bg-gaelle-blue/20 px-2 sm:px-3 py-1 rounded-full inline-block">
                    {member.role}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default TeamMembersSection;
