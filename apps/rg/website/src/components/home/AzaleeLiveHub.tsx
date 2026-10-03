"use client";

import { Card } from "@rosegriffon/ui";
import { ArrowRight, Layers, Newspaper, Shield, Swords, Users } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import type { AzaleePreviewData, PreviewCharacter } from "@/app/api/public/azalee/preview/route";
import { CommonSpriteIcon } from "@/components/ui/CommonSpriteIcon";
import { ItemCard } from "@/components/wiki/ItemCard";
import { MoveCard } from "@/components/wiki/MoveCard";
import { TeamCard } from "@/components/wiki/TeamCard";
import type { SpriteCommonKey } from "@/config/sprites-common";
import { getCharacterImageUrl, resolveLegacyMenuAsset } from "@rosegriffon/azalee/images";

export interface WikiSectionStats {
  characters: number;
  items: number;
  keshins: number;
  passives: number;
  skills: number;
  souls: number;
}

export interface AzaleeLiveHubProps {
  previewData?: AzaleePreviewData;
  stats?: WikiSectionStats;
  articles?: ArticlePreview[];
}

export interface ArticlePreview {
  id: string;
  slug: string;
  title: string;
  featured_image_url: string | null;
  published_at: string | null;
}

type PreviewTab = "characters" | "skills" | "items" | "teams";

const POSITION_SHORT: Record<string, string> = {
  Attaquant: "ATT",
  Défenseur: "DEF",
  Gardien: "GAR",
  Milieu: "MIL",
};

const POSITION_COLORS: Record<string, string> = {
  Attaquant: "bg-poste-attaquant/20 text-poste-attaquant border-poste-attaquant/30",
  Défenseur: "bg-poste-defenseur/20 text-poste-defenseur border-poste-defenseur/30",
  Gardien: "bg-poste-gardien/20 text-poste-gardien border-poste-gardien/30",
  Milieu: "bg-poste-milieu/20 text-poste-milieu border-poste-milieu/30",
};

const ELEMENT_SPRITE_MAP: Record<string, SpriteCommonKey> = {
  Feu: "fire",
  Fire: "fire",
  Forest: "forest",
  Forêt: "forest",
  Montagne: "mountain",
  Mountain: "mountain",
  Vent: "wind",
  Wind: "wind",
};

const PREVIEW_TABS: Array<{
  id: PreviewTab;
  label: string;
  icon: typeof Users;
}> = [
  { icon: Users, id: "characters", label: "Joueurs" },
  { icon: Swords, id: "skills", label: "Techniques" },
  { icon: Shield, id: "items", label: "Objets" },
  { icon: Layers, id: "teams", label: "Équipes" },
];

const PREVIEW_LINKS: Record<PreviewTab, { href: string; label: string }> = {
  characters: { href: "/wiki/chara", label: "Tous les joueurs" },
  items: { href: "/wiki/item", label: "Tous les objets" },
  skills: { href: "/wiki/skill", label: "Toutes les techniques" },
  teams: { href: "/wiki/equipe", label: "Toutes les équipes" },
};

function CharacterMiniCard({ character }: { character: PreviewCharacter }) {
  const faceUrl = getCharacterImageUrl(character.internal_code || character.id);
  const posColor =
    POSITION_COLORS[character.position] ??
    "bg-surface-container-highest text-foreground border-outline-variant/30";
  const elementSprite = ELEMENT_SPRITE_MAP[character.element];
  const href = `/wiki/chara/${character.base_slug || character.slug || character.id}`;

  return (
    <Link
      href={href}
      className="group/char flex min-w-0 items-center gap-3 rounded-2xl border border-outline-variant/20 bg-surface-container-low/60 p-3 transition-colors hover:border-azalee-yellow/60 hover:bg-surface-container"
    >
      <div className="relative size-12 shrink-0 overflow-hidden rounded-xl border border-outline-variant/30 bg-surface-container-highest">
        <Image
          src={faceUrl}
          alt={character.name_fr || character.name_en}
          fill
          unoptimized
          className="object-cover transition-transform group-hover/char:scale-105"
        />
      </div>
      <div className="min-w-0 grow">
        <div className="mb-1 flex items-center gap-1.5">
          <span className={`rounded border px-1.5 py-0.5 text-xs font-black ${posColor}`}>
            {POSITION_SHORT[character.position] || character.position}
          </span>
          {elementSprite && (
            <span className="size-4 shrink-0">
              <CommonSpriteIcon name={elementSprite} scale={0.32} />
            </span>
          )}
        </div>
        <h3 className="truncate text-sm font-bold text-foreground transition-colors group-hover/char:text-azalee-yellow">
          {character.name_fr || character.name_en}
        </h3>
      </div>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}

function EmptyPreview() {
  return (
    <div className="col-span-full rounded-2xl border border-outline-variant/15 bg-surface-container-low/30 p-5 text-center text-xs text-muted-foreground">
      Chargement…
    </div>
  );
}

export function AzaleeLiveHub({ stats, previewData, articles = [] }: AzaleeLiveHubProps) {
  const [activePreview, setActivePreview] = useState<PreviewTab>("characters");
  const [fetchedData, setLiveData] = useState<AzaleePreviewData | undefined>(previewData);
  const liveData = previewData ?? fetchedData;

  useEffect(() => {
    if (previewData) return;

    let isMounted = true;
    fetch("/api/public/azalee/preview")
      .then((response) => response.json())
      .then((data) => {
        if (isMounted && data && !data.error) {
          setLiveData(data);
        }
        return undefined;
      })
      .catch(() => undefined);

    return () => {
      isMounted = false;
    };
  }, [previewData]);

  const activeLink = PREVIEW_LINKS[activePreview];
  const activeCount =
    activePreview === "characters"
      ? stats?.characters
      : activePreview === "skills"
        ? stats?.skills
        : activePreview === "items"
          ? stats?.items
          : undefined;

  return (
    <section aria-labelledby="azalee-hub-title" className="w-full px-4 min-[600px]:px-0">
      <Card className="azalee-card-gradient azalee-glow-card relative flex flex-col gap-4 overflow-hidden rounded-3xl border border-azalee-gold/40 p-3.5 min-[600px]:p-5">
        <Image
          src="/azalee-bg.webp"
          alt=""
          fill
          sizes="100vw"
          className="pointer-events-none object-cover opacity-[0.07]"
          aria-hidden
        />
        <div className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-azalee-pink opacity-20 blur-[130px]" />
        <header className="relative z-10 flex items-center gap-3 border-b border-azalee-gold/20 pb-3">
          <div className="relative flex size-11 shrink-0 items-center justify-center rounded-2xl border border-azalee-yellow/30 bg-surface-container-highest/40 p-1">
            <Image
              src="/RG_Azalee-logo.webp"
              alt="Logo Azalée"
              width={42}
              height={42}
              className="object-contain"
              unoptimized
            />
          </div>
          <h2 id="azalee-hub-title" className="text-xl font-black tracking-tight text-foreground">
            <span className="azalee-text-gradient bg-clip-text text-transparent">Azalée</span>
          </h2>
        </header>

        <div className="relative z-10 flex gap-1 overflow-x-auto rounded-xl border border-outline-variant/20 bg-surface-container-high/40 p-1">
          {PREVIEW_TABS.map(({ icon: Icon, id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActivePreview(id)}
              className={`flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-bold transition-colors ${
                activePreview === id
                  ? "bg-azalee-yellow text-azalee-dark"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="size-3.5" aria-hidden />
              {label}
            </button>
          ))}
        </div>

        <div className="relative z-10 flex items-center justify-between gap-3 text-xs">
          <span className="text-muted-foreground">
            {activeCount ? activeCount.toLocaleString("fr-FR") : "Wiki"}
          </span>
          <Link
            href={activeLink.href}
            className="flex items-center gap-1 font-bold text-azalee-yellow hover:underline"
          >
            {activeLink.label}
            <ArrowRight className="size-3" aria-hidden />
          </Link>
        </div>

        <div className="relative z-10 grid grid-cols-1 gap-2.5 max-[599px]:[&>*:nth-child(n+3)]:hidden min-[600px]:grid-cols-2">
          {activePreview === "characters" &&
            (liveData?.characters?.length ? (
              liveData.characters
                .slice(0, 4)
                .map((character) => <CharacterMiniCard key={character.id} character={character} />)
            ) : (
              <EmptyPreview />
            ))}

          {activePreview === "skills" &&
            (liveData?.skills?.length ? (
              liveData.skills
                .slice(0, 4)
                .map((skill) => (
                  <MoveCard
                    key={skill.id}
                    id={skill.id}
                    name={skill.name_fr || skill.name_en}
                    category={skill.category}
                    element={skill.element}
                    powerMax={skill.power_max ?? undefined}
                    tensionCost={skill.tension_cost ?? undefined}
                  />
                ))
            ) : (
              <EmptyPreview />
            ))}

          {activePreview === "items" &&
            (liveData?.items?.length ? (
              liveData.items
                .slice(0, 4)
                .map((item) => (
                  <ItemCard
                    key={item.id}
                    id={item.id}
                    name={item.name_fr || item.name_en}
                    category={item.category}
                    internalCode={item.internal_code}
                    rarity={item.rarity ?? undefined}
                  />
                ))
            ) : (
              <EmptyPreview />
            ))}

          {activePreview === "teams" &&
            (liveData?.teams?.length ? (
              liveData.teams.slice(0, 4).map((team) => (
                <TeamCard
                  key={team.id}
                  team={{
                    emblemUrl: resolveLegacyMenuAsset(team.emblem_url),
                    id: team.id,
                    name: team.name_fr || team.name_en,
                    nameEn: team.name_en,
                    nameJa: team.name_ja,
                    order: 0,
                    rosterCount: 0,
                    seasons: {},
                    seriesKeys: [],
                  }}
                />
              ))
            ) : (
              <EmptyPreview />
            ))}
        </div>

        {articles.length > 0 && (
          <div className="relative z-10 border-t border-azalee-gold/20 pt-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-azalee-yellow">
                <Newspaper className="size-3.5" /> Actualités Azalée
              </span>
              <Link href="/news" className="text-xs font-bold text-azalee-yellow hover:underline">
                Tout le fil
              </Link>
            </div>
            <div className="grid gap-2 min-[600px]:grid-cols-2">
              {articles.slice(0, 2).map((article) => (
                <Link
                  key={article.id}
                  href={`/news/${article.slug}`}
                  className="group/article flex min-w-0 items-center gap-3 rounded-xl border border-outline-variant/15 bg-surface-container-low/70 p-2 transition-colors hover:border-azalee-yellow/50 hover:bg-surface-container"
                >
                  <div className="relative size-12 shrink-0 overflow-hidden rounded-lg bg-surface-container-highest">
                    {article.featured_image_url ? (
                      <Image
                        src={article.featured_image_url}
                        alt=""
                        fill
                        sizes="48px"
                        className="object-cover"
                      />
                    ) : (
                      <Image
                        src="/RG_Azalee-logo.webp"
                        alt=""
                        fill
                        sizes="48px"
                        className="object-contain p-2"
                      />
                    )}
                  </div>
                  <span className="min-w-0 flex-1 truncate text-sm font-bold text-foreground group-hover/article:text-azalee-yellow">
                    {article.title}
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              ))}
            </div>
          </div>
        )}
      </Card>
    </section>
  );
}
