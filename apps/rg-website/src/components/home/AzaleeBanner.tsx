import { Button, Card, CardContent } from "@rosegriffon/ui";
import { ArrowRight, BookOpen, FileText, Newspaper, Shield, Swords, Users } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { Twitter } from "@/lib/icons-config";
import { InstagramIcon as Instagram } from "@/shared/icons/instagram";
import type { WikiSectionStats } from "./WikiCarousel";

export interface AzaleeBannerProps {
  title?: string;
  tag?: string;
  description?: string;
  image?: string;
  logo?: string;
  wikiLink?: string;
  twitterLink?: string;
  instagramLink?: string;
  stats?: WikiSectionStats;
}

export function AzaleeBanner({
  title = "AZALÉE",
  tag = "Wiki & Actualités",
  description = "Le pilier médiatique et le wiki de Rose Griffon. Le wiki Azalée couvre tout Inazuma Eleven: Victory Road — personnages, techniques, esprits guerriers — avec traductions exclusives, interviews et analyses.",
  image = "https://azalee.rosegriffon.fr/opengraph-image.png",
  logo = "/RG_Azalee-logo.webp",
  wikiLink: _wikiLink = "https://azalee.rosegriffon.fr",
  twitterLink = "https://x.com/Azalee_IE",
  instagramLink = "https://www.instagram.com/azaleefr/",
  stats,
}: AzaleeBannerProps) {
  const mostVisitedPages = [
    {
      badge: "Base de données",
      count: stats?.characters
        ? `${stats.characters.toLocaleString("fr-FR")} profils`
        : "Tous les joueurs",
      description: "Fiches complètes, stats Lv99, passifs et recrutement.",
      href: "/wiki/chara",
      icon: Users,
      title: "Joueurs & Personnages",
    },
    {
      badge: "Catalogue",
      count: stats?.skills
        ? `${stats.skills.toLocaleString("fr-FR")} mouvements`
        : "Tir, dribble, défense",
      description: "Puissance, éléments, arbres d'évolution et vidéos.",
      href: "/wiki/skill",
      icon: Swords,
      title: "Techniques Spéciales",
    },
    {
      badge: "Inventaire",
      count: stats?.items ? `${stats.items.toLocaleString("fr-FR")} items` : "Équipements & stades",
      description: "Crampons, bracelets, objets clés et drops.",
      href: "/wiki/item",
      icon: Shield,
      title: "Objets & Équipements",
    },
    {
      badge: "Actu Victory Road",
      count: "Dernières notes",
      description: "Équilibrages, corrections de bugs et annonces.",
      href: "/wiki/patch-notes",
      icon: FileText,
      title: "Patch Notes du Jeu",
    },
  ];

  return (
    <div className="w-full">
      <Card className="overflow-hidden border border-[#b78250]/40 shadow-[0_0_40px_-10px_rgba(200,60,81,0.25)] bg-[#240112] relative group rounded-3xl p-0">
        {/* Soft Paper/Noise Texture effect */}
        <div
          className="absolute inset-0 opacity-10 mix-blend-overlay pointer-events-none"
          style={{ backgroundImage: "url(/images/noise.svg)" }}
        />
        <div className="absolute -right-20 -top-20 size-96 bg-[#C83C51] rounded-full blur-[128px] opacity-20 pointer-events-none" />
        <div className="absolute -left-20 -bottom-20 size-96 bg-[#FECD50] rounded-full blur-[128px] opacity-10 pointer-events-none" />

        <div className="grid md:grid-cols-2 gap-0 relative z-20 md:min-h-[320px] lg:min-h-[360px]">
          {/* Left: Image — aspect natif (1.91:1) sur mobile pour éviter le crop, remplissage sur desktop. */}
          <div className="relative aspect-[1200/630] md:aspect-auto md:h-auto w-full overflow-hidden">
            <Image
              src={image}
              alt={`Bannière ${title}`}
              fill
              priority
              className="object-cover object-center transition-transform duration-700 group-hover:scale-105"
              sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 640px"
            />
          </div>

          {/* Right: Text Content */}
          <CardContent className="px-6 pb-6 pt-0 sm:px-10 sm:pb-10 sm:pt-0 md:p-12 md:pt-0 flex flex-col justify-center gap-6 bg-transparent relative">
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between w-full">
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#FECD50]/15 border border-[#FECD50]/30 text-[#FECD50] text-xs font-bold uppercase tracking-wide shadow-sm">
                  <Newspaper className="size-3 fill-[#FECD50]" />
                  {tag}
                </div>
                <div className="relative size-12 sm:w-16 sm:h-16 shrink-0">
                  <Image
                    src={logo}
                    alt={`Logo ${title} Miniature`}
                    fill
                    unoptimized
                    className="object-contain drop-shadow-sm"
                  />
                </div>
              </div>
              <h2
                className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl text-white font-bold"
                style={{ fontFamily: '"BradBunR", system-ui' }}
              >
                <span className="bg-clip-text text-transparent bg-linear-to-r from-[#FECD50] to-[#C83C51] drop-shadow-sm">
                  {title}
                </span>
              </h2>
            </div>

            <p className="text-gray-300 text-base sm:text-lg leading-relaxed max-w-md font-light">
              {description}
            </p>

            <div className="flex flex-wrap gap-3 pt-0">
              <Button
                asChild
                size="lg"
                className="bg-white hover:bg-gray-100 text-[#240112] font-bold rounded-full shadow-lg hover:shadow-white/20 transition-all duration-300 px-5 text-sm sm:text-base"
              >
                <Link href="/wiki">
                  <BookOpen className="mr-2 size-4 sm:w-5 sm:h-5 text-[#C83C51]" />
                  Explorer le wiki Azalée
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                size="lg"
                className="border-[#C83C51] text-[#FECD50] hover:bg-[#C83C51]/20 hover:text-white hover:border-[#FECD50] rounded-full backdrop-blur-sm bg-[#240112]/50 transition-all duration-300 px-5 text-sm sm:text-base"
              >
                <a href={twitterLink} target="_blank" rel="noopener noreferrer">
                  <Twitter className="mr-2 size-4 sm:w-5 sm:h-5 fill-current" />
                  Suivre sur X
                </a>
              </Button>
              <Button
                asChild
                variant="outline"
                size="lg"
                className="border-[#C83C51] text-[#FECD50] hover:bg-[#C83C51]/20 hover:text-white hover:border-[#FECD50] rounded-full backdrop-blur-sm bg-[#240112]/50 transition-all duration-300 px-5 text-sm sm:text-base"
              >
                <a href={instagramLink} target="_blank" rel="noopener noreferrer">
                  <Instagram className="mr-2 size-4 sm:w-5 sm:h-5" />
                  Instagram
                </a>
              </Button>
            </div>
          </CardContent>
        </div>

        {/* ── Live Preview : Pages les plus consultées du Wiki ── */}
        <div className="border-t border-[#b78250]/30 bg-black/20 p-5 sm:p-6 lg:p-8 flex flex-col gap-4 relative z-20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-[#FECD50] animate-pulse" />
              <span className="text-xs font-bold uppercase tracking-wider text-[#FECD50]">
                Live Preview — Pages les plus consultées
              </span>
            </div>
            <Link
              href="/wiki"
              className="text-xs font-semibold text-gray-300 hover:text-[#FECD50] transition-colors flex items-center gap-1"
            >
              Voir tout le wiki
              <ArrowRight className="size-3" />
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {mostVisitedPages.map((page) => {
              const Icon = page.icon;
              return (
                <Link
                  key={page.href}
                  href={page.href}
                  className="group/card p-4 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-[#FECD50]/50 transition-all duration-200 flex flex-col justify-between gap-3"
                >
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-[#FECD50]/15 text-[#FECD50] border border-[#FECD50]/20">
                        {page.badge}
                      </span>
                      <Icon className="size-4 text-[#FECD50] opacity-80 group-hover/card:scale-110 transition-transform" />
                    </div>
                    <h3 className="text-sm sm:text-base font-bold text-white group-hover/card:text-[#FECD50] transition-colors">
                      {page.title}
                    </h3>
                    <p className="text-xs text-gray-300 line-clamp-2 leading-relaxed font-light">
                      {page.description}
                    </p>
                  </div>

                  <div className="pt-2 border-t border-white/10 flex items-center justify-between text-xs">
                    <span className="font-bold text-[#FECD50] tabular-nums">{page.count}</span>
                    <span className="text-[11px] text-gray-400 group-hover/card:text-white flex items-center gap-0.5 transition-colors">
                      Consulter
                      <ArrowRight className="size-3 transition-transform group-hover/card:translate-x-0.5" />
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </Card>
    </div>
  );
}
