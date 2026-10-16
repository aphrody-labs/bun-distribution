import { Button, Card } from "@rosegriffon/ui";
import Image from "next/image";
import Link from "next/link";

import RgEmote from "@/components/shared/emotes/RgEmote";
import { BreadcrumbSchema, ImageObjectSchema } from "@/components/shared/StructuredData";

import { ExternalLink, Info, Users } from "@/lib/icons-config";
import { absoluteUrl } from "@/lib/site-url";

import type { Metadata } from "next";

export const metadata: Metadata = {
  alternates: { canonical: absoluteUrl("/projets/muraux") },
  description:
    "Les fresques murales Inazuma Eleven réalisées par la communauté Rose Griffon : genèse, lieux et coulisses.",
  title: "Fresques murales | Rose Griffon",
};

export default function MurauxPage() {
  const murals = [
    {
      color: "from-[#a14b3f] to-orange-600",
      description:
        "Première galerie collaborative rassemblant des dizaines de créations originales et d'histoires développées autour des personnages inventés par la communauté (OC)",
      href: "https://app.mural.co/t/test07988/m/test07988/1697613494251/021f27cb0d01ff0ef10d8dd9a1d15104bf592c07",
      image: "/mural1.webp",
      title: "Mural  1",
    },
    {
      color: "from-gaelle-blue to-purple-600",
      description:
        "Deuxième galerie collaborative formant un véritable univers alternatif d'Inazuma Eleven avec des créations de qualité exceptionnelle",
      href: "https://app.mural.co/t/rosegriffon0367/m/rosegriffon0367/1699660105968/d8ed3bf55dc33d4b7bf288fcdbed4bb1ff5bf992",
      image: "/mural2.webp",
      title: "Mural  2",
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <BreadcrumbSchema
        items={[
          { item: "/", name: "Accueil" },
          { item: "/projets", name: "Projets" },
          { item: "/projets/muraux", name: "Muraux Communautaires" },
        ]}
      />
      {murals.map((mural, index) => (
        <ImageObjectSchema
          key={index}
          url={absoluteUrl(mural.image)}
          name={mural.title}
          description={mural.description}
          author="Communauté Rose Griffon"
        />
      ))}
      {/* Header Section avec Mise à jour en haut à droite */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 sm:pt-10 lg:pt-12 pb-8 sm:pb-10 lg:pb-12 animate-in fade-in duration-300">
        <div className="space-y-6 sm:space-y-8">
          {/* Grid: Title + Mise à jour + Cartes Muraux */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6">
            {/* Title - 8 colonnes sur desktop */}
            <div className="lg:col-span-8 space-y-3 sm:space-y-4">
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold text-[var(--md-sys-color-primary)] leading-tight [font-family:var(--font-super-cartoon,system-ui)] [-webkit-text-stroke:0.5px_var(--md-sys-color-primary)]">
                  Projets communautaires
                </h1>
              </div>
              <p className="text-base sm:text-lg md:text-xl text-[var(--md-sys-color-on-surface-variant)] max-w-3xl">
                Découvrez les initiatives créatives qui rassemblent la communauté Rose Griffon
              </p>

              {/* Cartes Muraux compactes */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-6">
                {murals.map((mural, index) => (
                  <Link key={index} href={mural.href} target="_blank" rel="noopener noreferrer" className="group block">
                    <Card className="overflow-hidden bg-[var(--md-sys-color-surface-container-low)] border border-[var(--md-sys-color-outline-variant)] hover:border-[var(--md-sys-color-primary)] hover:bg-[var(--md-sys-color-surface-container)] transition-all duration-300 hover:shadow-[var(--md-ref-elevation-2)] h-full">
                      {/* Image Container */}
                      <div className="relative overflow-hidden bg-linear-to-br from-[var(--md-sys-color-surface-container)] to-[var(--md-sys-color-surface-container-high)] aspect-video">
                        <Image
                          src={mural.image}
                          alt={mural.title}
                          fill
                          className="object-cover transition-transform duration-500 group-hover:scale-110"
                          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 25vw"
                          priority={index < 4}
                        />

                        {/* Gradient Glow */}
                        <div
                          className={`absolute inset-0 bg-linear-to-br ${mural.color} opacity-30 transition-opacity duration-500 mix-blend-overlay pointer-events-none group-hover:opacity-50`}
                        />

                        {/* Emote Badge */}
                        <div className="absolute top-2 left-2">
                          <div className="bg-[var(--md-sys-color-surface)] rounded-full size-8 flex items-center justify-center shadow-lg">
                            <RgEmote name={index === 0 ? "roy-coeur" : "gaelle-coeur"} size={28} animated />
                          </div>
                        </div>

                        {/* External Link Badge */}
                        <div className="absolute top-2 right-2">
                          <div className="bg-[var(--md-sys-color-primary-container)] rounded-full p-1.5 shadow-lg opacity-0 group-hover:opacity-100 transition-all duration-300">
                            <ExternalLink className="w-3.5 h-3.5 text-[var(--md-sys-color-on-primary-container)]" />
                          </div>
                        </div>
                      </div>

                      {/* Content */}
                      <div className="p-3 space-y-2">
                        <h3 className="text-base sm:text-lg font-bold text-[var(--md-sys-color-on-surface)] group-hover:text-[var(--md-sys-color-primary)] transition-colors duration-300 line-clamp-1">
                          {mural.title}
                        </h3>
                        <p className="text-sm text-[var(--md-sys-color-on-surface-variant)] line-clamp-2 group-hover:text-[var(--md-sys-color-on-surface)] transition-colors duration-300">
                          {mural.description}
                        </p>
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>

            {/* Mise à jour Card - 4 colonnes sur desktop, en haut à droite */}
            <div className="lg:col-span-4">
              <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800 p-4 sm:p-5 transition-all duration-300 hover:shadow-lg hover:scale-[1.02]">
                <div className="flex gap-2 items-center mb-3">
                  <div className="text-blue-600 dark:text-blue-400 shrink-0">
                    <Info className="size-5" />
                  </div>
                  <h2 className="text-base font-bold text-blue-900 dark:text-blue-100">Mise à jour</h2>
                </div>
                <div className="space-y-3 text-sm leading-relaxed text-blue-800 dark:text-blue-200">
                  <p>Chère communauté,</p>
                  <p>
                    La politique du mural des artistes Rose Griffon a été ajustée : Désormais, une attention
                    particulière et un discernement accru seront appliqués lors de la modération des contenus{" "}
                    <strong>jugés</strong> ambigus.
                  </p>
                  <p>
                    Notre objectif reste le même : « protéger, défendre et aider les artistes et leur liberté de
                    création » tout en garantissant un environnement sûr et respectueux de la sensibilité de chaque
                    membre.
                  </p>
                  <p className="flex items-center gap-2 text-sm">
                    Merci de faire vivre cet écosystème créatif avec nous.
                  </p>
                </div>
              </Card>
            </div>
          </div>

          {/* Description */}
          <div className="space-y-4 sm:space-y-5 text-sm sm:text-base md:text-lg text-[var(--md-sys-color-on-surface)] leading-relaxed max-w-5xl">
            <p>
              <span className="font-bold text-base sm:text-lg md:text-xl text-[var(--md-sys-color-primary)]">
                Rose Griffon valorise et encourage la créativité collective à travers une série d&apos;initiatives
                conçues pour faire vivre l&apos;imaginaire des fans.
              </span>
            </p>
            <p className="flex items-start gap-2">
              <span>
                Nos deux <span className="font-semibold text-[var(--md-sys-color-primary)]">Muraux communautaires</span>{" "}
                rassemblent des dizaines de créations originales et d&apos;histoires développées autour des personnages
                inventés par la communauté (OC), formant un véritable univers alternatif d&apos;Inazuma Eleven. Cette
                dynamique est enrichie par nos concours réguliers — <span className="font-semibold">InazumaRG</span>,{" "}
                <span className="font-semibold">InazumaSona</span> ou encore{" "}
                <span className="font-semibold">La Route du Sacre</span> — qui invitent chacun à inventer, scénariser ou
                illustrer sa propre vision d&apos;Inazuma.
              </span>
              <RgEmote name="gaelle-coeur" size={28} animated className="shrink-0 mt-1" />
            </p>
            <p>
              Enfin, via l&apos;onglet{" "}
              <span className="font-semibold text-[var(--md-sys-color-primary)]">Vitrine Projet</span> sur notre{" "}
              <Link
                href="https://discord.gg/sVc3r87g"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-[var(--md-sys-color-secondary)] hover:underline transition-colors duration-300"
              >
                Discord
              </Link>
              , chaque membre peut proposer son projet personnel, partager ses avancées et bénéficier du soutien actif
              de la communauté pour le faire évoluer.
            </p>
          </div>
        </div>
      </section>

      {/* Call to Action Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 lg:py-12">
        <Card className="bg-linear-to-br from-[var(--md-sys-color-primary-container)] to-[var(--md-sys-color-secondary-container)] border border-[var(--md-sys-color-outline-variant)] p-6 sm:p-8 md:p-10 text-center space-y-4 sm:space-y-5 transition-all duration-300 hover:shadow-[var(--md-ref-elevation-3)]">
          <div className="flex items-center justify-center gap-3">
            <h3 className="text-xl sm:text-2xl md:text-3xl font-bold text-[var(--md-sys-color-on-primary-container)]">
              Envie de participer ?
            </h3>
          </div>
          <p className="text-sm sm:text-base md:text-lg text-[var(--md-sys-color-on-secondary-container)] max-w-2xl mx-auto">
            Rejoignez notre communauté Discord et découvrez comment vous pouvez contribuer à nos projets collaboratifs.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center pt-2 sm:pt-4">
            <Button
              asChild
              size="lg"
              className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 hover:shadow-lg transition-all duration-300 text-white font-semibold h-auto py-3 sm:py-3.5 text-base sm:text-lg hover:scale-[1.05]"
            >
              <Link
                href="https://discord.gg/sVc3r87g"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2"
              >
                <Users className="size-5" />
                Rejoindre le Discord
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30 font-semibold h-auto py-3 sm:py-3.5 text-base sm:text-lg transition-all duration-300 hover:scale-[1.05]"
            >
              <Link href="/">Retour à l&apos;accueil</Link>
            </Button>
          </div>
        </Card>
      </section>
    </div>
  );
}
