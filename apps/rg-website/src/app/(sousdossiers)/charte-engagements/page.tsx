import { Card, CardContent, CardHeader, CardTitle } from "@rosegriffon/ui";
import type { Metadata } from "next";

import { PageContainer, PageHero, SectionCard, SectionHeading } from "@/components/shared/PageShell";
import { BreadcrumbSchema } from "@/components/shared/StructuredData";
import { Award, Eye, Handshake, Palette, Scale, Users } from "@/lib/icons-config";
import { absoluteUrl } from "@/lib/site-url";

// Page statique avec ISR - Revalidate toutes les semaines (charte rarement modifiée)
export const dynamic = "force-static";
export const revalidate = 604_800; // 1 semaine

export const metadata: Metadata = {
  title: "Charte d'engagements · Rose Griffon",
  description:
    "Les cinq engagements que Rose Griffon, Achilléa et Azalée tiennent dans toutes leurs activités : crédit des créateurs, transparence, refus de l'IA générative, respect inconditionnel, réinvestissement dans la communauté.",
  alternates: {
    canonical: absoluteUrl("/charte-engagements"),
  },
  openGraph: {
    title: "Charte d'engagements · Rose Griffon",
    description: "Les cinq engagements que Rose Griffon, Achilléa et Azalée tiennent dans toutes leurs activités.",
    url: absoluteUrl("/charte-engagements"),
    type: "website",
  },
};

/**
 * Les cinq engagements. Un seul accent (`primary`) pour les cinq cartes : la
 * version précédente peignait chaque carte d'une teinte brute différente
 * (hexadécimal et palette Tailwind par défaut), qui ne survivait ni au
 * changement de thème ni au contraste. Seule l'icône distingue désormais un
 * engagement d'un autre.
 */
const ENGAGEMENTS = [
  {
    icon: Award,
    title: "Crédit systématique des productions",
    text: "Nous nous engageons à créditer toutes les personnes ayant contribué à nos projets : artistes, développeurs, compositeurs, organisateurs, etc. Chaque travail mérite d'être reconnu.",
  },
  {
    icon: Eye,
    title: "Transparence sur nos actions",
    text: "Chaque projet, chaque action menée est justifiée, expliquée et rendue publique. Nous nous engageons à toujours expliciter nos intentions et décisions de manière claire et accessible.",
  },
  {
    icon: Palette,
    title: "Refus de l'IA générative comme substitut à la création humaine",
    text: "Rose Griffon privilégie la création humaine. Nous nous engageons à limiter drastiquement l'utilisation d'IA générative (visuelle, sonore, textuelle) dans nos productions pour garantir l'authenticité, la qualité et l'éthique du travail fourni.",
  },
  {
    icon: Users,
    title: "Respect et tolérance inconditionnels",
    text: "Rose Griffon est une structure inclusive. Nous défendons activement le respect de toutes les identités (LGBTQIA+, croyances religieuses, origines, genres) et nous nous engageons à intervenir fermement contre tout comportement discriminatoire.",
  },
  {
    icon: Handshake,
    title: "Une finalité commune : faire grandir la communauté Inazuma Eleven",
    text: "Tous nos projets — qu'ils soient bénévoles ou rémunérateurs — ont un seul but : soutenir, rassembler et faire prospérer la communauté Inazuma Eleven. Même nos revenus sont réinvestis pour développer la scène, financer des projets et faire émerger de nouveaux talents.",
  },
] as const;

/** Les quatre critères rédhibitoires pour un partenariat. */
const REFUS_PARTENARIAT = [
  {
    id: "nsfw",
    content: (
      <>
        Tolèrent un salon <strong className="font-bold">NSFW</strong> ou équivalent.
      </>
    ),
  },
  {
    id: "moderation",
    content: (
      <>
        Ont une <strong className="font-bold">modération laxiste</strong> face aux{" "}
        <strong className="font-bold">discriminations</strong>, <strong className="font-bold">agressions</strong> ou
        autres cas d&apos;
        <strong className="font-bold">abus</strong>.
      </>
    ),
  },
  {
    id: "outils",
    content: (
      <>
        Utilisent des outils liés à des personnes reconnues comme <strong className="font-bold">nuisibles</strong> pour
        certaines <strong className="font-bold">communautés</strong>.
      </>
    ),
  },
  {
    id: "ia",
    content: (
      <>
        Dépendent fortement d&apos;<strong className="font-bold">IA générative artistique</strong>.
      </>
    ),
  },
];

export default function CharteEngagementsPage() {
  return (
    <PageContainer>
      <BreadcrumbSchema
        items={[
          { item: "/", name: "Accueil" },
          { item: "/charte-engagements", name: "Charte d'engagements" },
        ]}
      />

      <PageHero
        icon={<Scale className="size-7 shrink-0 text-rg-or md:size-8" aria-hidden />}
        eyebrow="Rose Griffon · Achilléa · Azalée"
        title="Charte d'engagements"
        description="Cinq engagements que nous tenons dans toutes nos activités et productions — et quatre critères qui nous font refuser un partenariat."
      />

      {/* Les engagements */}
      <section aria-labelledby="engagements">
        <SectionHeading
          id="engagements"
          icon={<Award className="size-6" aria-hidden />}
          iconClassName="bg-primary text-primary-foreground shadow-primary/20"
          title="Nos engagements"
          subtitle="Applicables à Rose Griffon, Achilléa et Azalée, sans exception."
        />
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {ENGAGEMENTS.map(engagement => (
            <Card
              key={engagement.title}
              className="border-l-8 border-l-primary shadow-lg transition-shadow hover:shadow-xl"
            >
              <CardHeader>
                <div className="flex items-start gap-3">
                  <div className="shrink-0 rounded-xl bg-primary/10 p-2.5 text-primary">
                    <engagement.icon className="size-6" aria-hidden />
                  </div>
                  <CardTitle className="text-fluid-headline-md leading-tight">{engagement.title}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-fluid-body-md text-muted-foreground">{engagement.text}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Partenariats refusés */}
      <SectionCard>
        <SectionHeading
          icon={<Handshake className="size-6" aria-hidden />}
          iconClassName="bg-secondary text-secondary-foreground shadow-secondary/20"
          title="Partenariats avec les projets Rose Griffon"
          subtitle="Rose Griffon, Achilléa et Azalée appliquent les mêmes critères."
        />
        <h3 className="mb-4 text-fluid-headline-md font-bold text-foreground">
          Les partenariats ne seront pas acceptés avec des projets qui :
        </h3>
        <ol className="flex flex-col gap-5">
          {REFUS_PARTENARIAT.map((critere, index) => (
            <li key={critere.id} className="flex items-start gap-3">
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-destructive font-bold text-rg-sur-marine"
                aria-hidden
              >
                {index + 1}
              </span>
              <p className="text-fluid-body-md text-foreground">{critere.content}</p>
            </li>
          ))}
        </ol>
      </SectionCard>
    </PageContainer>
  );
}
