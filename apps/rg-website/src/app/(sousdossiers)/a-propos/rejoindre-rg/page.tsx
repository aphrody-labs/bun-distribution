import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@rosegriffon/ui";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { getAllTeamMembers } from "@/app/admin/staff/actions";
import {
  heroPrimaryButtonClass,
  heroSecondaryButtonClass,
  PageContainer,
  PageHero,
  SectionCard,
  SectionHeading,
} from "@/components/shared/PageShell";
import { BreadcrumbSchema } from "@/components/shared/StructuredData";
import {
  ArrowRight,
  Award,
  Briefcase,
  CheckCircle,
  Heart,
  Mail,
  MapPin,
  MessageCircle,
  Shield,
  UserPlus,
  Users,
} from "@/lib/icons-config";
import { absoluteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Rejoindre Rose Griffon · Recrutement",
  description:
    "Rose Griffon recrute : staff convention, artistes, développeurs, rédacteurs et community managers pour Azalée, modérateurs Discord. Conditions, postes ouverts et processus de candidature.",
  alternates: {
    canonical: absoluteUrl("/a-propos/rejoindre-rg"),
  },
  openGraph: {
    title: "Rejoindre Rose Griffon · Recrutement",
    description: "Contribuez à l'essor de la communauté Inazuma Eleven en France selon vos disponibilités.",
    url: absoluteUrl("/a-propos/rejoindre-rg"),
    type: "website",
  },
};

/**
 * Les trois formulaires de candidature. Ils n'apparaissent QU'UNE fois sur la
 * page, dans la section « Candidater » : la version précédente les répétait à
 * l'identique dans la bannière et dans le pied de page (mêmes URL, libellés
 * différents), soit deux fois le même contrôle par écran.
 */
const CANDIDATURES = [
  {
    id: "rose-griffon",
    href: "https://forms.gle/NK2RkbZa3WzsoHkw5",
    label: "Rejoindre Rose Griffon",
    variant: "default" as const,
    logo: { src: "/RG_Logo_V2.5.webp", alt: "" },
  },
  {
    id: "azalee",
    href: "https://forms.gle/cLSGYcF1JAWB83Qn6",
    label: "Rejoindre Azalée",
    variant: "secondary" as const,
    logo: { src: "/azale.webp", alt: "" },
  },
  {
    id: "moderation",
    href: "https://forms.gle/JjiptG8aQybDnHni8",
    label: "Rejoindre la modération",
    variant: "outline" as const,
    logo: null,
  },
];

/** Pré-requis. Le titre court était présent dans les données mais jamais affiché. */
const CONDITIONS = [
  {
    id: "age",
    titre: "18 ans minimum",
    texte: "Être majeur (18 ans révolus). Cette condition est stricte pour des raisons légales et organisationnelles.",
  },
  {
    id: "mobilite",
    titre: "Mobilité ou compétences",
    texte:
      "Pour l'association Rose Griffon : être mobile pour les événements physiques (conventions) ou avoir des compétences spécifiques (art, développement, musique).",
  },
  {
    id: "media",
    titre: "Plume, réseaux ou graphisme",
    texte:
      "Pour le média Azalée : avoir une plume (rédaction), savoir gérer des réseaux (community management) ou créer des visuels (graphisme).",
  },
  {
    id: "discord",
    titre: "Expérience Discord",
    texte:
      "Pour la modération : avoir de l'expérience dans la gestion de communautés Discord et faire preuve de sang-froid.",
  },
];

/** Postes ouverts, par structure. */
const POSTES = [
  {
    id: "asso",
    titre: "Rose Griffon (association)",
    texte:
      "Staff convention, artistes, musiciens, développeurs, bricoleurs. Aidez-nous à faire vivre la licence sur le terrain comme en ligne.",
  },
  {
    id: "azalee",
    titre: "Média Azalée",
    texte:
      "Rédacteurs, community managers, graphistes et correcteurs. Rejoignez l'équipe qui couvre l'actualité Inazuma Eleven.",
  },
  {
    id: "moderation",
    titre: "Modération",
    texte:
      "Gardiens de la communauté Discord. Expérience requise pour maintenir un environnement sain et bienveillant.",
  },
];

/** Le parcours de candidature, en trois temps. */
const ETAPES = [
  {
    id: "candidature",
    icon: Mail,
    numero: "01",
    titre: "Candidature",
    texte: "Remplissez le formulaire en ligne avec vos motivations.",
  },
  {
    id: "entretien",
    icon: Users,
    numero: "02",
    titre: "Entretien",
    texte: "Échange convivial avec un responsable pour faire connaissance.",
  },
  {
    id: "integration",
    icon: Award,
    numero: "03",
    titre: "Intégration",
    texte: "Bienvenue ! Vous recevez vos accès et rejoignez l'équipe.",
  },
];

export default async function RejoindreRGPage() {
  const { data: members } = await getAllTeamMembers();
  // `getAllTeamMembers` retourne aussi les inactifs (côté admin), on ne compte que les actifs.
  const activeMembersCount = members ? members.filter(m => m.is_active !== false).length : 50; // Repli à 50 si la requête échoue
  const discordMemberCount = 3000;

  const STATS = [
    { id: "adherents", icon: Users, label: "Adhérents", value: activeMembersCount },
    { id: "discord", icon: MessageCircle, label: "Membres Discord", value: discordMemberCount },
    { id: "regions", icon: MapPin, label: "Rayonnement", value: "France" },
    { id: "passion", icon: Heart, label: "Passion", value: "100 %" },
  ];

  return (
    <PageContainer>
      <BreadcrumbSchema
        items={[
          { item: "/", name: "Accueil" },
          { item: "/a-propos", name: "À propos" },
          { item: "/a-propos/rejoindre-rg", name: "Rejoindre Rose Griffon" },
        ]}
      />

      <PageHero
        icon={<UserPlus className="size-7 shrink-0 text-rg-or md:size-8" aria-hidden />}
        eyebrow="Recrutement ouvert"
        title="Rejoignez l'aventure Rose Griffon"
        description="Une association dynamique et passionnée qui recherche constamment de nouveaux talents. Contribuez à l'essor de la communauté Inazuma Eleven en France, selon vos disponibilités."
        image={{ src: "/stand.webp" }}
        actions={
          <>
            <Button asChild className={heroPrimaryButtonClass}>
              <a href="#candidater">
                Candidater
                <ArrowRight className="size-5" aria-hidden />
              </a>
            </Button>
            <Button asChild variant="outline" className={heroSecondaryButtonClass}>
              <a href="#postes">Voir les postes ouverts</a>
            </Button>
          </>
        }
      />

      {/* Chiffres clés */}
      <section aria-labelledby="chiffres">
        <h2 id="chiffres" className="sr-only">
          L&apos;association en chiffres
        </h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {STATS.map(stat => (
            <Card key={stat.id} className="py-4 shadow-lg transition-shadow hover:shadow-xl">
              <CardContent className="flex flex-col items-center gap-3 text-center">
                <span className="rounded-2xl bg-primary/10 p-3 text-primary">
                  <stat.icon className="size-6" aria-hidden />
                </span>
                <div>
                  <p className="text-2xl font-black text-foreground">{stat.value}</p>
                  <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{stat.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Conditions & postes */}
      <section aria-labelledby="profils" className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-8">
        <h2 id="profils" className="sr-only">
          Conditions d&apos;intégration et postes ouverts
        </h2>
        <Card className="flex h-full flex-col border-t-4 border-t-primary shadow-lg">
          <CardHeader>
            {/* Un seul enfant : le CardHeader partagé bascule en ligne au-delà de
						    448 px de conteneur, ce qui mettrait la description à droite du titre. */}
            <div>
              <div className="mb-2 flex items-center gap-3">
                <span className="rounded-xl bg-primary/10 p-2.5 text-primary">
                  <CheckCircle className="size-6" aria-hidden />
                </span>
                <CardTitle className="text-fluid-headline-md font-bold">Conditions d&apos;intégration</CardTitle>
              </div>
              <CardDescription>Les pré-requis pour rejoindre l&apos;aventure.</CardDescription>
            </div>
          </CardHeader>

          <CardContent className="flex grow flex-col gap-3">
            {CONDITIONS.map(condition => (
              <div
                key={condition.id}
                className="rounded-xl border border-border bg-muted p-3 transition-colors hover:bg-accent"
              >
                <p className="font-semibold text-foreground">{condition.titre}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{condition.texte}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card id="postes" className="flex h-full scroll-mt-24 flex-col border-t-4 border-t-secondary shadow-lg">
          <CardHeader>
            <div>
              <div className="mb-2 flex items-center gap-3">
                <span className="rounded-xl bg-secondary/10 p-2.5 text-secondary">
                  <Briefcase className="size-6" aria-hidden />
                </span>
                <CardTitle className="text-fluid-headline-md font-bold">Postes ouverts</CardTitle>
              </div>
              <CardDescription>Les rôles que nous recherchons activement.</CardDescription>
            </div>
          </CardHeader>

          <CardContent className="flex grow flex-col gap-3">
            {POSTES.map(poste => (
              <div
                key={poste.id}
                className="rounded-xl border border-border p-4 transition-colors hover:border-secondary hover:bg-accent"
              >
                <h3 className="mb-1 flex items-center gap-2 text-lg font-bold text-foreground">
                  <span className="size-2 shrink-0 rounded-full bg-secondary" aria-hidden />
                  {poste.titre}
                </h3>
                <p className="text-sm text-muted-foreground">{poste.texte}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      {/* Processus */}
      <section aria-labelledby="processus">
        <SectionHeading
          id="processus"
          icon={<UserPlus className="size-6" aria-hidden />}
          iconClassName="bg-primary text-primary-foreground shadow-primary/20"
          title="Comment nous rejoindre ?"
          subtitle="Un processus simple et transparent, en trois étapes."
        />
        <ol className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {ETAPES.map(etape => (
            <li key={etape.id}>
              <Card className="h-full py-6 shadow-lg transition-shadow hover:shadow-xl">
                <CardContent className="flex flex-col items-center gap-2 text-center">
                  <span className="mb-2 flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <etape.icon className="size-7" aria-hidden />
                  </span>
                  <span className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
                    Étape {etape.numero}
                  </span>
                  <h3 className="text-lg font-bold text-foreground">{etape.titre}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{etape.texte}</p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      {/* Candidater — unique emplacement des trois formulaires */}
      <SectionCard id="candidater" className="text-center">
        <h2 className="text-fluid-headline-xl font-black tracking-tight text-foreground">
          Prêt à écrire l&apos;histoire avec nous ?
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-fluid-body-lg leading-relaxed text-muted-foreground">
          Que vous soyez artiste, organisateur, développeur ou simplement passionné, il y a une place pour vous chez
          Rose Griffon. Choisissez le formulaire qui correspond à votre profil.
        </p>

        <div className="mt-8 flex flex-col flex-wrap items-stretch justify-center gap-4 sm:flex-row sm:items-center">
          {CANDIDATURES.map(candidature => (
            <Button
              key={candidature.id}
              asChild
              size="lg"
              variant={candidature.variant}
              // `whitespace-normal` : sans lui, un libellé long déborde du bouton à 320 px.
              className="h-auto min-h-14 rounded-2xl px-5 py-3 text-base font-bold whitespace-normal sm:px-8"
            >
              <a href={candidature.href} target="_blank" rel="noopener noreferrer">
                {candidature.logo ? (
                  <Image
                    src={candidature.logo.src}
                    alt={candidature.logo.alt}
                    width={24}
                    height={24}
                    className="size-6 rounded-full"
                  />
                ) : (
                  <Shield className="size-5" aria-hidden />
                )}
                {candidature.label}
                <ArrowRight className="size-5" aria-hidden />
              </a>
            </Button>
          ))}
        </div>

        <p className="mt-6 flex items-center justify-center gap-2 text-sm font-medium text-muted-foreground">
          <span className="size-2 shrink-0 animate-pulse rounded-full bg-succes" aria-hidden />
          Réponse sous 48 h en moyenne
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Une question avant de candidater ?{" "}
          <Link href="/a-propos/contact" className="font-medium text-primary underline">
            Écrivez-nous
          </Link>
          .
        </p>
      </SectionCard>
    </PageContainer>
  );
}
