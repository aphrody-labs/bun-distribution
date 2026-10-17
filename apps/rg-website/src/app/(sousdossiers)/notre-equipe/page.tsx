import type { Metadata } from "next";
import {
  Award,
  BookOpen,
  Crown,
  ExternalLink,
  Handshake,
  Medal,
  Palette,
  Scroll,
  Share2,
  ShieldCheck,
  Star,
  Swords,
  Users,
  Video,
} from "lucide-react";

import ImageWithSkeleton from "@/components/shared/ImageWithSkeleton";
import { TeamStructuredData } from "@/components/shared/StructuredData";
import { getPgPool } from "@/lib/db/pg";
import { getEnv } from "@/lib/env";
import { absoluteUrl } from "@/lib/site-url";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  alternates: { canonical: absoluteUrl("/notre-equipe") },
  description:
    "Découvrez l'organigramme officiel de l'association Rose Griffon : le bureau, les équipes de création Azalée et Achilléa, les dessinateurs, le lore, la production et l'ensemble de nos membres.",
  openGraph: {
    description:
      "Découvrez l'organigramme officiel de l'association Rose Griffon : le bureau, les équipes de création Azalée et Achilléa, les dessinateurs, le lore, la production et l'ensemble de nos membres.",
    images: [
      {
        alt: "Rose Griffon - Notre Équipe",
        height: 630,
        url: "/opengraph-image.png",
        width: 1200,
      },
    ],
    title: "Notre Équipe | Rose Griffon",
    type: "website",
    url: absoluteUrl("/notre-equipe"),
  },
  title: "Notre Équipe | Rose Griffon",
};

// ISR : régénérée par les actions du staff (`revalidatePath`), au plus tard toutes les heures.
export const dynamic = "force-static";
export const revalidate = 3600;

interface MembreRaw {
  display_index: number | null;
  id: string;
  image_url: string | null;
  member_link: string | null;
  name: string;
  role: string | null;
  team_id: string;
  team_name: string | null;
}

export interface MembreStaff {
  displayIndex: number;
  id: string;
  image: string;
  link?: string;
  name: string;
  role: string;
  teamId: string;
  teamName: string;
}

interface DefinitionEquipe {
  badgeColor: string;
  borderTheme: string;
  description: string;
  glowColor: string;
  icon: typeof Users;
  id: string;
  medailleLibelle: string;
  nom: string;
}

const REFERENTIEL_EQUIPES: DefinitionEquipe[] = [
  {
    badgeColor: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
    borderTheme: "border-amber-400/40",
    description:
      "Les membres du bureau assurent la gouvernance, la gestion administrative, financière et légale de l'association loi 1901 Rose Griffon. Ils coordonnent les différents pôles et garantissent la vision globale du projet.",
    glowColor: "rgba(245, 158, 11, 0.25)",
    icon: Crown,
    id: "bureauteam",
    medailleLibelle: "Médailles d'Honneur du Bureau",
    nom: "Bureau de l'Association",
  },
  {
    badgeColor: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30",
    borderTheme: "border-rose-400/40",
    description:
      "L'équipe éditoriale et documentaire en charge du wiki Azalée. Rédacteurs, traducteurs et curateurs travaillent à documenter l'ensemble de l'univers Inazuma Eleven et du jeu Victory Road.",
    glowColor: "rgba(244, 63, 94, 0.25)",
    icon: BookOpen,
    id: "azaleeteam",
    medailleLibelle: "Médailles Azalée",
    nom: "Équipe Azalée",
  },
  {
    badgeColor: "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30",
    borderTheme: "border-achillea-violet/40",
    description:
      "Les créateurs et arbitres de la scène e-sport Achilléa et de l'Astral League. Organisateurs de tournois, casters et techniciens animent les compétitions communautaires.",
    glowColor: "rgba(139, 92, 246, 0.25)",
    icon: Swords,
    id: "achilleateam",
    medailleLibelle: "Médailles Achilléa",
    nom: "Équipe Achilléa",
  },
  {
    badgeColor: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/30",
    borderTheme: "border-indigo-400/40",
    description:
      "Les artistes visuels, concepteurs 2D/3D, storyboarders, illustrateurs et animateurs qui donnent corps à l'univers graphique et aux mascottes de Rose Griffon.",
    glowColor: "rgba(99, 102, 241, 0.25)",
    icon: Palette,
    id: "dessinateurteam",
    medailleLibelle: "Médailles Artistiques",
    nom: "Équipe Dessinateur",
  },
  {
    badgeColor: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    borderTheme: "border-emerald-400/40",
    description:
      "Les gardiens de la narration et de l'écriture. Ils tissent les intrigues, rédigent les fiches de personnages et enrichissent la mythologie de l'association.",
    glowColor: "rgba(16, 185, 129, 0.25)",
    icon: Scroll,
    id: "loreteam",
    medailleLibelle: "Médailles du Lore",
    nom: "Équipe Lore",
  },
  {
    badgeColor: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/30",
    borderTheme: "border-cyan-400/40",
    description:
      "Les développeurs et monteurs assurant l'infrastructure web, les outils interactifs et les réalisations techniques au service de la communauté.",
    glowColor: "rgba(6, 182, 212, 0.25)",
    icon: Video,
    id: "productionteam",
    medailleLibelle: "Médailles de Production",
    nom: "Équipe Production",
  },
  {
    badgeColor: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30",
    borderTheme: "border-sky-400/40",
    description:
      "L'équipe en première ligne sur nos plateformes : streamers, community managers et ambassadeurs qui partagent nos passions et animent le public.",
    glowColor: "rgba(14, 165, 233, 0.25)",
    icon: Share2,
    id: "socialteam",
    medailleLibelle: "Médailles de Diffusion",
    nom: "Équipe Réseaux",
  },
  {
    badgeColor: "bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/30",
    borderTheme: "border-teal-400/40",
    description:
      "Un espace neutre, confidentiel et bienveillant dédié à l'écoute des membres, au règlement des litiges et au respect de la charte d'engagement.",
    glowColor: "rgba(20, 184, 166, 0.25)",
    icon: ShieldCheck,
    id: "mediationteam",
    medailleLibelle: "Médailles de Bienveillance",
    nom: "Cellule de Médiation",
  },
  {
    badgeColor: "bg-gaelle-blue/10 text-gaelle-blue dark:text-gaelle-blue-light border-gaelle-blue/30",
    borderTheme: "border-gaelle-blue/40",
    description:
      "Les membres adhérents qui participent à la vie associative, soutiennent nos initiatives et font vivre la passion d'Inazuma Eleven au quotidien.",
    glowColor: "rgba(0, 162, 255, 0.25)",
    icon: Users,
    id: "assoteam",
    medailleLibelle: "Médailles Associatives",
    nom: "Membres de l'Association",
  },
  {
    badgeColor: "bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/30",
    borderTheme: "border-purple-400/40",
    description:
      "Nos partenaires, créateurs de contenus invités et intervenants extérieurs qui enrichissent les événements de l'association.",
    glowColor: "rgba(168, 85, 247, 0.25)",
    icon: Handshake,
    id: "collabteam",
    medailleLibelle: "Médailles de Collaboration",
    nom: "Collaborateurs & Partenaires",
  },
];

async function chargerEquipes(): Promise<{ definition: DefinitionEquipe; membres: MembreStaff[] }[]> {
  try {
    const pool = getPgPool();
    const { rows } = await pool.query<MembreRaw>(
      `SELECT id, team_id, team_name, name, role, display_index, member_link, image_url
			 FROM team_members
			 WHERE is_active = true
			 ORDER BY display_index ASC NULLS LAST, name ASC`,
    );

    const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");

    const membresNormalises: MembreStaff[] = (rows || []).map(row => {
      let imageUrl = row.image_url || "";
      if (imageUrl.includes("{url}")) {
        imageUrl = imageUrl.replace("{url}", supabaseUrl);
      }
      if (imageUrl.startsWith("https://https://")) {
        imageUrl = imageUrl.replace("https://https://", "https://");
      }

      return {
        displayIndex: row.display_index ?? 999,
        id: row.id,
        image: imageUrl || "/RG_Logo_V2.5.webp",
        link: row.member_link && row.member_link.startsWith("http") ? row.member_link : undefined,
        name: row.name,
        role: row.role && row.role.trim() !== "Staff" ? row.role.trim() : "Membre",
        teamId: row.team_id,
        teamName: row.team_name || row.team_id,
      };
    });

    // Grouper par équipe dans l'ordre de REFERENTIEL_EQUIPES
    const resultats: { definition: DefinitionEquipe; membres: MembreStaff[] }[] = [];

    for (const def of REFERENTIEL_EQUIPES) {
      const membres = membresNormalises.filter(m => m.teamId === def.id);
      if (membres.length > 0) {
        resultats.push({ definition: def, membres });
      }
    }

    // Ajouter d'éventuelles équipes personnalisées non référencées
    const teamsTraitees = new Set(REFERENTIEL_EQUIPES.map(d => d.id));
    const orphelins = membresNormalises.filter(m => !teamsTraitees.has(m.teamId));
    if (orphelins.length > 0) {
      const groupesOrphelins = new Map<string, MembreStaff[]>();
      for (const m of orphelins) {
        const existant = groupesOrphelins.get(m.teamId) ?? [];
        existant.push(m);
        groupesOrphelins.set(m.teamId, existant);
      }
      for (const [teamId, membres] of groupesOrphelins.entries()) {
        resultats.push({
          definition: {
            badgeColor: "bg-primary/10 text-primary border-primary/30",
            borderTheme: "border-primary/40",
            description: "Membres contributeurs de Rose Griffon.",
            glowColor: "rgba(59, 130, 246, 0.2)",
            icon: Users,
            id: teamId,
            medailleLibelle: "Médailles d'Équipe",
            nom: membres[0]?.teamName || teamId,
          },
          membres,
        });
      }
    }

    return resultats;
  } catch (error) {
    console.error("[notre-equipe] Erreur de lecture des équipes :", error);
    return [];
  }
}

/** Médaille d'honneur pour le bureau : or, argent ou bronze selon le rôle. */
function obtenirMedailleBureau(
  role: string,
  index: number,
): {
  badgeBg: string;
  borderClass: string;
  glowStyle: string;
  icon: typeof Crown;
  libelle: string;
  pinBg: string;
} {
  const roleLower = role.toLowerCase();
  if (roleLower.includes("président") && !roleLower.includes("vice")) {
    return {
      badgeBg: "bg-amber-400/15 text-amber-600 dark:text-amber-300 border-amber-400/40",
      borderClass: "border-4 border-amber-400 shadow-[0_0_20px_rgba(251,191,36,0.45)]",
      glowStyle: "bg-amber-400/20",
      icon: Crown,
      libelle: "Médaille d'Or",
      pinBg: "bg-amber-400 text-amber-950",
    };
  }
  if (roleLower.includes("vice-président")) {
    return {
      badgeBg: "bg-slate-300/20 text-slate-700 dark:text-slate-200 border-slate-300/50",
      borderClass: "border-4 border-slate-300 dark:border-slate-200 shadow-[0_0_20px_rgba(203,213,225,0.4)]",
      glowStyle: "bg-slate-300/20",
      icon: Award,
      libelle: "Médaille d'Argent",
      pinBg: "bg-slate-300 text-slate-900",
    };
  }
  if (roleLower.includes("trésorier") || roleLower.includes("secrétaire")) {
    return {
      badgeBg: "bg-amber-700/15 text-amber-800 dark:text-amber-300 border-amber-700/40",
      borderClass: "border-4 border-amber-700 dark:border-amber-600 shadow-[0_0_20px_rgba(180,83,9,0.4)]",
      glowStyle: "bg-amber-700/20",
      icon: Medal,
      libelle: "Médaille de Bronze",
      pinBg: "bg-amber-700 text-amber-100",
    };
  }
  return index === 1
    ? {
        badgeBg: "bg-amber-400/15 text-amber-600 dark:text-amber-300 border-amber-400/40",
        borderClass: "border-4 border-amber-400 shadow-[0_0_20px_rgba(251,191,36,0.45)]",
        glowStyle: "bg-amber-400/20",
        icon: Crown,
        libelle: "Médaille d'Or",
        pinBg: "bg-amber-400 text-amber-950",
      }
    : {
        badgeBg: "bg-primary/10 text-primary border-primary/30",
        borderClass: "border-4 border-primary/50 shadow-[0_0_15px_rgba(59,130,246,0.3)]",
        glowStyle: "bg-primary/20",
        icon: Award,
        libelle: "Médaille du Bureau",
        pinBg: "bg-primary text-on-primary",
      };
}

export default async function NotreEquipePage() {
  const equipes = await chargerEquipes();
  const totalMembres = equipes.reduce((acc, eq) => acc + eq.membres.length, 0);

  const tousLesMembresPourSchema = equipes.flatMap(eq =>
    eq.membres.map(m => ({
      image: m.image,
      name: m.name,
      role: `${m.role} — ${eq.definition.nom}`,
      sameAs: m.link ? [m.link] : undefined,
    })),
  );

  return (
    <div className="min-h-screen">
      <TeamStructuredData
        pageName="Notre Équipe — Rose Griffon"
        url={absoluteUrl("/notre-equipe")}
        members={tousLesMembresPourSchema}
      />

      <header className="container mx-auto flex flex-col gap-3 border-b border-outline-variant/30 px-4 py-4 min-[600px]:px-6 min-[600px]:py-6 min-[840px]:flex-row min-[840px]:items-center">
        <div className="flex shrink-0 items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Users className="size-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-foreground min-[840px]:text-3xl">Notre équipe</h1>
            <p className="text-xs font-medium text-muted-foreground">{totalMembres} contributeurs</p>
          </div>
        </div>

        <nav aria-label="Navigation rapide par équipe" className="flex gap-2 overflow-x-auto pb-1 min-[840px]:ml-auto">
          {equipes.map(({ definition, membres }) => {
            const Icone = definition.icon;
            return (
              <a
                key={definition.id}
                href={`#${definition.id}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-outline-variant/20 bg-surface-container/60 hover:bg-surface-container-high hover:border-primary/40 text-xs font-semibold text-foreground transition-colors"
              >
                <Icone className="size-3.5 text-primary" />
                <span>{definition.nom}</span>
                <span className="ml-0.5 px-1.5 py-0.2 rounded-full bg-surface-container-highest text-[10px] text-muted-foreground tabular-nums">
                  {membres.length}
                </span>
              </a>
            );
          })}
        </nav>
      </header>

      {/* Grilles d'Équipes & Médailles */}
      <main className="container mx-auto max-w-7xl space-y-10 px-4 py-6 min-[600px]:px-6 min-[840px]:space-y-14 min-[840px]:py-8">
        {equipes.map(({ definition, membres }, eqIdx) => {
          const IconeEquipe = definition.icon;
          const estBureau = definition.id === "bureauteam";

          return (
            <section
              key={definition.id}
              id={definition.id}
              aria-labelledby={`titre-${definition.id}`}
              className="scroll-mt-24 space-y-5"
            >
              {/* En-tête de section d'équipe */}
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-4 border-b border-outline-variant/15">
                <div className="space-y-2 max-w-3xl">
                  <div className="flex items-center gap-2.5">
                    <span className={cn("p-2 rounded-xl border", definition.badgeColor)}>
                      <IconeEquipe className="size-5" />
                    </span>
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        {definition.medailleLibelle}
                      </span>
                      <h2
                        id={`titre-${definition.id}`}
                        className="text-2xl sm:text-3xl font-black text-foreground tracking-tight"
                      >
                        {definition.nom}
                      </h2>
                    </div>
                  </div>
                  <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">{definition.description}</p>
                </div>
                <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-surface-container text-xs font-bold text-foreground border border-outline-variant/15 self-start md:self-auto shrink-0">
                  <span className="size-2 rounded-full bg-primary animate-pulse" />
                  <span>
                    {membres.length} membre{membres.length > 1 ? "s" : ""}
                  </span>
                </div>
              </div>

              {/* Grille des membres avec leurs médailles */}
              <div
                className={cn(
                  "grid gap-4 sm:gap-6",
                  estBureau
                    ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
                    : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6",
                )}
              >
                {membres.map((membre, mIdx) => {
                  const medailleBureau = estBureau ? obtenirMedailleBureau(membre.role, membre.displayIndex) : null;

                  const estLead =
                    !estBureau &&
                    (membre.role.toLowerCase().includes("lead") ||
                      membre.role.toLowerCase().includes("chef") ||
                      membre.role.toLowerCase().includes("responsable"));

                  const cardContent = (
                    <div
                      className={cn(
                        "group relative flex flex-col items-center text-center p-4 sm:p-5 rounded-3xl transition-all duration-300 border bg-surface-container-lowest hover:bg-surface-container-low",
                        estBureau
                          ? "border-outline-variant/30 hover:border-amber-400/50 hover:shadow-xl hover:shadow-amber-400/10"
                          : "border-outline-variant/15 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5",
                      )}
                    >
                      {/* Médaillon Photo */}
                      <div className="relative mb-3.5">
                        <div
                          className={cn(
                            "relative size-24 sm:size-28 lg:size-32 rounded-full overflow-hidden transition-all duration-300 group-hover:scale-105",
                            medailleBureau
                              ? medailleBureau.borderClass
                              : estLead
                                ? "border-3 border-primary ring-4 ring-primary/20 shadow-md"
                                : "border-3 border-outline-variant/30 group-hover:border-primary/60",
                          )}
                        >
                          <ImageWithSkeleton
                            src={membre.image}
                            alt={`${membre.name} — ${membre.role} (${definition.nom})`}
                            priority={eqIdx === 0 && mIdx < 5}
                          />
                        </div>

                        {/* Pin's médaille en surimpression */}
                        {medailleBureau && (
                          <div
                            className={cn(
                              "absolute -bottom-1 -right-1 size-7 sm:size-8 rounded-full flex items-center justify-center shadow-lg border-2 border-surface",
                              medailleBureau.pinBg,
                            )}
                            title={medailleBureau.libelle}
                          >
                            <medailleBureau.icon className="size-4" />
                          </div>
                        )}

                        {estLead && !medailleBureau && (
                          <div
                            className="absolute -bottom-1 -right-1 size-7 rounded-full flex items-center justify-center shadow-md bg-primary text-on-primary border-2 border-surface"
                            title="Responsable / Lead de Pôle"
                          >
                            <Star className="size-3.5 fill-current" />
                          </div>
                        )}

                        {/* Halo lumineux en arrière-plan */}
                        <div
                          className="absolute inset-0 rounded-full blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 -z-10"
                          style={{ backgroundColor: definition.glowColor }}
                        />
                      </div>

                      {/* Nom du membre */}
                      <h3 className="font-bold text-sm sm:text-base text-foreground group-hover:text-primary transition-colors truncate w-full">
                        {membre.name}
                      </h3>

                      {/* Médaille / Badge de Rôle */}
                      <div className="mt-1.5 flex flex-col items-center gap-1 w-full">
                        <span
                          className={cn(
                            "text-[11px] sm:text-xs font-semibold px-2.5 py-0.5 rounded-full border truncate max-w-full inline-block",
                            medailleBureau
                              ? medailleBureau.badgeBg
                              : estLead
                                ? "bg-primary/15 text-primary border-primary/30"
                                : definition.badgeColor,
                          )}
                          title={membre.role}
                        >
                          {membre.role}
                        </span>

                        {medailleBureau && (
                          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                            {medailleBureau.libelle}
                          </span>
                        )}
                      </div>

                      {/* Lien vers réseau externe si présent */}
                      {membre.link && (
                        <span className="mt-2 text-xs font-medium text-primary inline-flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                          <span>Profil</span>
                          <ExternalLink className="size-3" />
                        </span>
                      )}
                    </div>
                  );

                  return membre.link ? (
                    <a
                      key={membre.id}
                      href={membre.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block"
                      aria-label={`Profil de ${membre.name} (${membre.role})`}
                    >
                      {cardContent}
                    </a>
                  ) : (
                    <div key={membre.id}>{cardContent}</div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </main>
    </div>
  );
}
