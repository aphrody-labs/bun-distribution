import { Badge } from "@rosegriffon/ui";
import { format, formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CalendarDays,
  ExternalLink,
  Lock,
  LockOpen,
  MessageSquare,
  Users,
} from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BreadcrumbSchema, PageContainer, PageHero, SectionCard } from "@/components/shared";
import { ContenuDiscord, TexteDiscordInline } from "@/lib/discord/markdown";
import {
  construireContexteSondages,
  estIdentifiantSondage,
  lireSondage,
  lireVoisins,
  listerIdentifiantsSondages,
} from "@/lib/discord/polls";
import {
  classement,
  gagnant,
  libelleChoixAutorises,
  libelleEtat,
  libelleParticipation,
  lienMessageDiscord,
  resumeQuestion,
  varianteBadgeEtat,
} from "@/lib/discord/polls-types";
import { absoluteUrl } from "@/lib/site-url";

import { ResultatsSondage } from "../_components/ResultatsSondage";

export const revalidate = 3600;

// Un sondage importé après le build reste servi : la page se rend à la demande
// puis rejoint le cache ISR.
export const dynamicParams = true;

export async function generateStaticParams() {
  // Une cinquantaine de sondages : les pré-rendre tous coûte moins cher qu'un
  // rendu à la demande par visiteur.
  const identifiants = await listerIdentifiantsSondages();
  return identifiants.map(pollId => ({ pollId }));
}

export async function generateMetadata({
  params,
}: {
  // Next 16 : `params` est une promesse, dans la page comme ici.
  params: Promise<{ pollId: string }>;
}): Promise<Metadata> {
  const { pollId } = await params;
  const sondage = estIdentifiantSondage(pollId) ? await lireSondage(pollId) : null;
  if (!sondage) return { title: "Sondage introuvable · Rose Griffon" };

  // Un `<title>` ne doit contenir ni `**gras**`, ni `<:emote:id>`, ni `<@&rôle>`.
  const titre = resumeQuestion(sondage.question, 80);
  const description = `Résultats du sondage « ${titre} » posé à la communauté Rose Griffon sur Discord.`;
  const url = absoluteUrl(`/sondages/${sondage.poll_id}`);

  return {
    alternates: { canonical: url },
    description,
    openGraph: {
      description,
      ...(sondage.visuel && { images: [{ url: sondage.visuel.url }] }),
      title: `${titre} · Sondages · Rose Griffon`,
      type: "article",
      url,
    },
    title: `${titre} · Sondages · Rose Griffon`,
  };
}

/** Ligne d'un encadré de métadonnées : intitulé + valeur. */
function LigneMeta({
  icone,
  intitule,
  children,
}: {
  icone?: React.ReactNode;
  intitule: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-outline-variant/20 pb-3 last:border-b-0 last:pb-0">
      <dt className="flex items-center gap-1.5 text-sm text-on-surface-variant">
        {icone}
        {intitule}
      </dt>
      <dd className="text-fluid-body-md break-words text-on-surface">{children}</dd>
    </div>
  );
}

export default async function PageSondage({ params }: { params: Promise<{ pollId: string }> }) {
  const { pollId } = await params;
  // Identifiant hors format : 404 immédiat, sans toucher la base.
  if (!estIdentifiantSondage(pollId)) notFound();

  const sondage = await lireSondage(pollId);
  // `lireSondage` renvoie aussi `null` quand le salon n'est plus suivi : les
  // deux cas donnent un 404 propre plutôt qu'une page vide.
  if (!sondage) notFound();

  const [contexte, voisins] = await Promise.all([construireContexteSondages([sondage]), lireVoisins(sondage.poll_id)]);

  const resume = resumeQuestion(sondage.question, 70);
  const ordonnees = classement(sondage);
  const enTete = gagnant(sondage);
  const participation = libelleParticipation(sondage);
  const publieLe = new Date(sondage.created_at);
  const finLe = sondage.ends_at ? new Date(sondage.ends_at) : null;
  const lienDiscord = lienMessageDiscord(sondage);

  return (
    <PageContainer>
      <BreadcrumbSchema
        items={[
          { item: "/", name: "Accueil" },
          { item: "/sondages", name: "Sondages" },
          { item: `/sondages/${sondage.poll_id}`, name: resume },
        ]}
      />

      {/* Pas de `lang` sur la question : `discord_polls.language` décrit la langue
			    d'INTERFACE de l'encart EasyPoll, pas celle du texte publié (48 questions
			    françaises y sont marquées « en »). Cf. le commentaire de CarteSondage. */}
      <PageHero
        description={`${libelleEtat(sondage)}${participation ? ` · ${participation}` : ""} · ${libelleChoixAutorises(sondage)}`}
        eyebrow={`Sondage nº ${sondage.poll_id}`}
        icon={<BarChart3 className="size-6 text-rg-or" aria-hidden />}
        title={
          <span>
            <TexteDiscordInline contenu={sondage.question} contexte={contexte} />
          </span>
        }
      />

      <Link
        href="/sondages"
        className="inline-flex items-center gap-1.5 text-fluid-body-md font-semibold text-primary underline-offset-4 hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Retour à tous les sondages
      </Link>

      {sondage.visuel && (
        <figure className="space-y-2">
          <Image
            src={sondage.visuel.url}
            // Même règle que sur la carte de liste : 11 des 15 questions
            // illustrées désignent l'image, un `alt` vide la rendrait
            // invisible aux lecteurs d'écran.
            alt={sondage.visuel.alt ?? `Visuel du sondage : ${resumeQuestion(sondage.question, 80)}`}
            width={sondage.visuel.width ?? 1600}
            height={sondage.visuel.height ?? 1200}
            sizes="(max-width: 1280px) 100vw, 1280px"
            quality={75}
            priority
            className="h-auto w-full rounded-3xl border border-outline-variant/20 object-cover"
          />
          <figcaption className="text-sm text-on-surface-variant">
            {sondage.visuel.alt ?? "Visuel publié dans le salon avec ce sondage."}
          </figcaption>
        </figure>
      )}

      {sondage.chapo && (
        <SectionCard>
          <h2 className="mb-2 text-fluid-headline-md font-bold text-foreground">Présentation</h2>
          <ContenuDiscord contenu={sondage.chapo} contexte={contexte} />
        </SectionCard>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <SectionCard className="lg:col-span-2">
          <h2 className="mb-4 text-fluid-headline-lg font-bold text-foreground">Résultats</h2>
          {/* Classement par nombre de votes, vainqueur mis en avant. Le rang
					    d'origine de chaque choix reste rappelé sous la barre. */}
          <ResultatsSondage classe contexte={contexte} optionEnTete={enTete} options={ordonnees} sondage={sondage} />
        </SectionCard>

        <SectionCard>
          <h2 className="mb-4 text-fluid-headline-md font-bold text-foreground">Paramètres du sondage</h2>
          <dl className="space-y-3">
            <LigneMeta intitule="État">
              <Badge variant={varianteBadgeEtat(sondage)}>{libelleEtat(sondage)}</Badge>
            </LigneMeta>
            <LigneMeta intitule="Choix autorisés">{libelleChoixAutorises(sondage)}</LigneMeta>
            <LigneMeta
              icone={
                sondage.locked ? <Lock className="size-4" aria-hidden /> : <LockOpen className="size-4" aria-hidden />
              }
              intitule="Votes"
            >
              {sondage.locked ? "Verrouillés — plus aucun vote possible" : "Ouverts"}
            </LigneMeta>
            <LigneMeta icone={<CalendarDays className="size-4" aria-hidden />} intitule="Publié le">
              <time dateTime={sondage.created_at}>{format(publieLe, "d MMMM yyyy 'à' HH'h'mm", { locale: fr })}</time>
            </LigneMeta>
            {finLe && (
              <LigneMeta
                icone={<CalendarDays className="size-4" aria-hidden />}
                intitule={sondage.ended ? "Terminé le" : "Fin prévue le"}
              >
                <time dateTime={sondage.ends_at ?? undefined}>
                  {format(finLe, "d MMMM yyyy 'à' HH'h'mm", { locale: fr })}
                </time>{" "}
                <span className="text-on-surface-variant">
                  ({formatDistanceToNow(finLe, { addSuffix: true, locale: fr })})
                </span>
              </LigneMeta>
            )}
            {participation && (
              <LigneMeta icone={<Users className="size-4" aria-hidden />} intitule="Participation">
                {participation}
              </LigneMeta>
            )}
            {/* Le créateur n'est affiché que si l'API Discord l'a réellement
						    donné : jamais déduit d'un message voisin. */}
            {sondage.creator_username && <LigneMeta intitule="Sondage lancé par">{sondage.creator_username}</LigneMeta>}
            {sondage.command && (
              <LigneMeta intitule="Commande">
                <code className="rounded-sm border border-outline-variant/40 bg-surface-container-highest px-1.5 py-0.5 font-mono text-sm">
                  /{sondage.command}
                </code>
              </LigneMeta>
            )}
          </dl>

          {lienDiscord && (
            <a
              href={lienDiscord}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex items-center gap-2 rounded-full border border-outline-variant/60 bg-surface-container px-4 py-2 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container-high"
            >
              <MessageSquare className="size-4" aria-hidden />
              Voir le message d'origine sur Discord
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          )}
        </SectionCard>
      </div>

      {(voisins.plusRecent || voisins.plusAncien) && (
        <nav
          aria-label="Sondages voisins"
          className="grid gap-4 border-t border-outline-variant/20 pt-6 sm:grid-cols-2"
        >
          {voisins.plusAncien ? (
            <Link
              href={`/sondages/${voisins.plusAncien.poll_id}`}
              className="group flex flex-col gap-1 rounded-2xl border border-outline-variant/30 bg-surface-container-low p-4 transition-colors hover:bg-surface-container"
            >
              <span className="inline-flex items-center gap-1.5 text-sm text-on-surface-variant">
                <ArrowLeft className="size-4" aria-hidden />
                Sondage précédent
              </span>
              <span className="text-fluid-body-md font-semibold break-words text-on-surface">
                {resumeQuestion(voisins.plusAncien.question, 70)}
              </span>
            </Link>
          ) : (
            <span />
          )}
          {voisins.plusRecent && (
            <Link
              href={`/sondages/${voisins.plusRecent.poll_id}`}
              className="group flex flex-col gap-1 rounded-2xl border border-outline-variant/30 bg-surface-container-low p-4 text-right transition-colors hover:bg-surface-container"
            >
              <span className="inline-flex items-center justify-end gap-1.5 text-sm text-on-surface-variant">
                Sondage suivant
                <ArrowRight className="size-4" aria-hidden />
              </span>
              <span className="text-fluid-body-md font-semibold break-words text-on-surface">
                {resumeQuestion(voisins.plusRecent.question, 70)}
              </span>
            </Link>
          )}
        </nav>
      )}
    </PageContainer>
  );
}
