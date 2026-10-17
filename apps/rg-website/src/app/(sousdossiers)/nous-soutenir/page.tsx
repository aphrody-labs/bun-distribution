import { Button, Card, CardContent, CardHeader, CardTitle } from "@rosegriffon/ui";
import type { Metadata } from "next";
import Link from "next/link";

import { PublicTiers } from "@/components/patreon/PublicTiers";
import {
  heroPrimaryButtonClass,
  heroSecondaryButtonClass,
  PageContainer,
  PageHero,
  SectionCard,
  SectionHeading,
} from "@/components/shared/PageShell";
import { BreadcrumbSchema, OrganizationSchema } from "@/components/shared/StructuredData";
import { ExternalLink, Eye, Heart, Mail, Megaphone, Server, Swords, Trophy, Users, Video } from "@/lib/icons-config";
import { absoluteUrl } from "@/lib/site-url";

export const metadata: Metadata = {
  description:
    "Rose Griffon est porté par sa communauté. Soutenez l'association via Patreon (mensuel) ou PayPal (don ponctuel). Transparence garantie.",
  title: "Nous soutenir · Rose Griffon",
  alternates: {
    canonical: absoluteUrl("/nous-soutenir"),
  },
  openGraph: {
    title: "Nous soutenir · Rose Griffon",
    description:
      "Rose Griffon est porté par sa communauté. Soutenez l'association via Patreon (mensuel) ou PayPal (don ponctuel). Transparence garantie.",
    url: absoluteUrl("/nous-soutenir"),
    type: "website",
    images: [
      {
        url: "/opengraph-image.png",
        width: 1200,
        height: 630,
        alt: "Rose Griffon - Nous soutenir",
      },
    ],
  },
};

export const dynamic = "force-static";

const WHY_CARDS = [
  {
    desc: "Articles, chroniques, lives, événements — tout ce contenu est gratuit pour la communauté grâce à vos soutiens.",
    icon: Megaphone,
    title: "Faire vivre Inazuma Eleven en France",
  },
  {
    desc: "Achilléa fait grandir l'e-sport IE en France. Tournois, coaching, format — tout ça coûte du temps et du matériel.",
    icon: Trophy,
    title: "Une scène compétitive structurée",
  },
  {
    desc: "Tous les contributeurs RG sont bénévoles. Vos dons financent les outils, l'infrastructure, le matériel — pas les salaires.",
    icon: Users,
    title: "Une équipe de bénévoles",
  },
];

const TRANSPARENCY = [
  {
    desc: "Tournois, conventions, rencontres physiques. Coût matériel, lots, déplacements.",
    icon: Trophy,
    title: "Événements communautaires",
  },
  {
    desc: "Azalée (chroniques + chaîne), Rose Griffon TV. Outils de production, hébergement.",
    icon: Video,
    title: "Projets médiatiques",
  },
  {
    desc: "Achilléa : scène compétitive structurée, tournois nationaux, coaching.",
    icon: Swords,
    title: "Développement e-sport",
  },
  {
    desc: "Serveurs, CDN, sites, bots Discord. Tout est auto-hébergé pour rester maîtres de nos données.",
    icon: Server,
    title: "Infrastructure technique",
  },
];

/** Carte d'information — même surface, même bordure, même rayon sur toute la page. */
function InfoCard({ icon: Icon, title, desc }: { icon: typeof Trophy; title: string; desc: string }) {
  return (
    <Card className="h-full gap-3 shadow-sm transition-shadow hover:shadow-md">
      <CardHeader>
        {/* Un seul enfant : au-delà de 448 px de conteneur le CardHeader partagé
				    bascule en ligne, ce qui poserait le titre à droite de l’icône. */}
        <div>
          <span className="block w-fit rounded-lg bg-primary/10 p-2 text-primary">
            <Icon className="size-6" aria-hidden />
          </span>
          <CardTitle className="mt-3 text-fluid-headline-md leading-tight">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-fluid-body-md text-muted-foreground">{desc}</p>
      </CardContent>
    </Card>
  );
}

export default function NousSoutenirPage() {
  return (
    <PageContainer>
      <BreadcrumbSchema
        items={[
          { name: "Accueil", item: "/" },
          { name: "Nous soutenir", item: "/nous-soutenir" },
        ]}
      />
      <OrganizationSchema />

      <PageHero
        icon={<Heart className="size-7 shrink-0 text-rg-or md:size-8" aria-hidden />}
        eyebrow="Communauté & soutien"
        title="Nous soutenir"
        description="Rose Griffon est une association à but non lucratif portée par une équipe de bénévoles. Vos soutiens financent les projets, pas les salaires."
        actions={
          <>
            <Button asChild className={heroPrimaryButtonClass}>
              <a href="#tiers">Voir les paliers</a>
            </Button>
            <Button asChild variant="outline" className={heroSecondaryButtonClass}>
              <a href="#transparence">Où va votre soutien ?</a>
            </Button>
          </>
        }
      />

      {/* Paliers Patreon — seul endroit de la page où l'on part vers Patreon. */}
      <section id="tiers" aria-labelledby="paliers-titre" className="scroll-mt-24">
        <SectionHeading
          id="paliers-titre"
          icon={<Heart className="size-6" aria-hidden />}
          iconClassName="bg-primary text-primary-foreground shadow-primary/20"
          title="Les paliers de mécénat"
          subtitle="Trois paliers principaux sur Patreon — Roy, Gaëlle, Evans — plus deux options complémentaires. Chaque palier a son propre bouton."
        />
        <PublicTiers />
        <p className="mx-auto mt-8 max-w-2xl text-center text-xs text-muted-foreground">
          Patreon prélève une commission de 8 à 12 % plus les frais de paiement. Pour maximiser le soutien net à
          l&apos;association, un don unique PayPal est plus efficace côté frais.
        </p>
      </section>

      {/* Pourquoi nous soutenir */}
      <section aria-labelledby="pourquoi">
        <SectionHeading
          id="pourquoi"
          icon={<Megaphone className="size-6" aria-hidden />}
          iconClassName="bg-secondary text-secondary-foreground shadow-secondary/20"
          title="Pourquoi nous soutenir ?"
          subtitle="Ce que votre contribution rend possible au quotidien."
        />
        <div className="grid gap-6 md:grid-cols-3">
          {WHY_CARDS.map(card => (
            <InfoCard key={card.title} icon={card.icon} title={card.title} desc={card.desc} />
          ))}
        </div>
      </section>

      {/* Don ponctuel & contact — pas de second bouton Patreon : les paliers
			    ci-dessus sont déjà l'unique porte d'entrée vers le mécénat. */}
      <section aria-labelledby="autres">
        <SectionHeading
          id="autres"
          icon={<Heart className="size-6" aria-hidden />}
          iconClassName="bg-primary text-primary-foreground shadow-primary/20"
          title="Autres façons de nous soutenir"
          subtitle="Un coup de main ponctuel, ou simplement une question à nous poser."
        />
        <div className="grid gap-6 md:grid-cols-2">
          <Card className="h-full shadow-sm">
            <CardHeader>
              <div>
                <CardTitle className="text-fluid-headline-md">Don ponctuel via PayPal</CardTitle>
                <p className="mt-1 text-xs font-semibold tracking-wider text-primary uppercase">Coup de main unique</p>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <p className="text-fluid-body-md text-muted-foreground">
                Vous souhaitez faire un don unique pour soutenir nos actions ? PayPal vous permet de contribuer
                facilement et en toute sécurité, quel que soit le montant.
              </p>
              <Button
                asChild
                size="lg"
                className="h-auto min-h-12 w-full rounded-full py-3 whitespace-normal sm:w-auto"
              >
                <a href="https://www.paypal.com/paypalme/rosegriffon" target="_blank" rel="noopener noreferrer">
                  Faire un don
                  <ExternalLink className="size-4" aria-hidden />
                </a>
              </Button>
            </CardContent>
          </Card>

          <Card className="h-full shadow-sm">
            <CardHeader>
              <div>
                <CardTitle className="text-fluid-headline-md">Mécénat, dons en nature, presse</CardTitle>
                <p className="mt-1 text-xs font-semibold tracking-wider text-primary uppercase">Nous écrire</p>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <p className="text-fluid-body-md text-muted-foreground">
                Entreprise, association, média ou simple curieux : écrivez-nous et nous construirons ensemble la forme
                de soutien la plus utile.
              </p>
              <Button
                asChild
                variant="secondary"
                size="lg"
                className="h-auto min-h-12 w-full rounded-full py-3 whitespace-normal sm:w-auto"
              >
                <Link href="/a-propos/contact">
                  <Mail className="size-4" aria-hidden />
                  Nous contacter
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Transparence */}
      <section id="transparence" aria-labelledby="transparence-titre" className="scroll-mt-24">
        <SectionHeading
          id="transparence-titre"
          icon={<Eye className="size-6" aria-hidden />}
          iconClassName="bg-secondary text-secondary-foreground shadow-secondary/20"
          title="Où va votre soutien ?"
          subtitle="Bilan financier annuel partagé en assemblée générale."
        />
        <div className="grid gap-6 md:grid-cols-2">
          {TRANSPARENCY.map(card => (
            <InfoCard key={card.title} icon={card.icon} title={card.title} desc={card.desc} />
          ))}
        </div>
      </section>

      {/* Remerciement — bloc de clôture, sans bouton : chaque action de la page
			    existe déjà une seule fois plus haut. */}
      <SectionCard className="text-center">
        <Heart className="mx-auto size-8 text-primary" aria-hidden />
        <h2 className="mt-3 text-fluid-headline-lg font-bold text-foreground">Merci de faire vivre Rose Griffon</h2>
        <p className="mx-auto mt-3 max-w-2xl text-fluid-body-md text-muted-foreground">
          Chaque soutien — petit ou grand — fait avancer la communauté. Les comptes de l&apos;association sont présentés
          chaque année à ses adhérents.
        </p>
      </SectionCard>
    </PageContainer>
  );
}
