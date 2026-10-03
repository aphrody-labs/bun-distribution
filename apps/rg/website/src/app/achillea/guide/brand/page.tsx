import Link from "next/link";
import Image from "next/image";
import { Card, CardHeader, CardTitle, CardContent, Badge } from "@rosegriffon/ui";
import { Palette, Type, Image as ImageIcon, ArrowLeft } from "lucide-react";
import { metadonneesAchillea } from "@/app/achillea/metadonnees";

export const metadata = metadonneesAchillea({
  titre: "Brand kit & direction artistique",
  description:
    "Charte graphique, palette des 11 paliers de ranking, typographies et logos d'Achilléa.",
  chemin: "/achillea/guide/brand",
});

interface BrandFont {
  family: string;
  label: string;
  source: string;
  fallback: string;
}

interface BrandPalette {
  rank: number;
  name: string;
  primary: string;
  stopsVar: string;
}

interface BrandLogo {
  label: string;
  path: string;
  note?: string;
}

const FONTS: BrandFont[] = [
  {
    family: "Achillea Display",
    label: "Dirtyline 36DOT — Display",
    source: "typo/titre/Dirtyline-36Daysoftype-2022",
    fallback: "Inter",
  },
  {
    family: "Achillea Title",
    label: "HUMANE — Titre",
    source: "typo/titre/HUMANE",
    fallback: "Inter",
  },
  {
    family: "Achillea Title Alt",
    label: "Neue Metana Next — Titre alternatif",
    source: "typo/titre/Neue-Metana-Next-Free-Font",
    fallback: "Inter",
  },
  {
    family: "Achillea Mono",
    label: "Liberation Mono — Intertitre",
    source: "typo/intertitre/liberation-mono",
    fallback: "ui-monospace",
  },
  {
    family: "Achillea Body",
    label: "MS Gothic — Corps",
    source: "typo/corps de texte/msgothic",
    fallback: "Inter",
  },
  {
    family: "Achillea Display Num",
    label: "Satoshi Black — Numéro Coupe d'Ilion",
    source: "typo/numéro coupe d'ilion/Satoshi-Black",
    fallback: "Inter",
  },
];

const PALETTES: BrandPalette[] = [
  { rank: 1, name: "Fer", primary: "#959595", stopsVar: "--achillea-rank-1-stops" },
  { rank: 2, name: "Bronze", primary: "#B17253", stopsVar: "--achillea-rank-2-stops" },
  { rank: 3, name: "Argent", primary: "#7FACB8", stopsVar: "--achillea-rank-3-stops" },
  { rank: 4, name: "Or", primary: "#C2AD88", stopsVar: "--achillea-rank-4-stops" },
  { rank: 5, name: "Platine", primary: "#897E8B", stopsVar: "--achillea-rank-5-stops" },
  { rank: 6, name: "Diamant", primary: "#88F6FF", stopsVar: "--achillea-rank-6-stops" },
  { rank: 7, name: "Émeraude", primary: "#2D925C", stopsVar: "--achillea-rank-7-stops" },
  { rank: 8, name: "Rubis", primary: "#FF5648", stopsVar: "--achillea-rank-8-stops" },
  { rank: 9, name: "Divin", primary: "#7EDCB5", stopsVar: "--achillea-rank-9-stops" },
  { rank: 10, name: "Supernova", primary: "#F010FF", stopsVar: "--achillea-rank-10-stops" },
  { rank: 11, name: "Légendaire", primary: "#FFA910", stopsVar: "--achillea-rank-11-stops" },
];

const LOGOS: BrandLogo[] = [
  { label: "Logo SVG", path: "/achillea/logo.svg", note: "Format vectoriel scalable" },
  { label: "Pictogramme Achilléa", path: "/achillea/achillea.png", note: "Symbole carré officiel" },
  {
    label: "Favicon / Icône",
    path: "/achillea/achillea_ico.png",
    note: "Format icône haute définition",
  },
  {
    label: "Bannière Officielle",
    path: "/achillea/achillea-banner.png",
    note: "Header et OpenGraph",
  },
];

export default function AchilleaBrandPage() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-10">
      <div className="space-y-2 border-b border-border/60 pb-6">
        <Link
          href="/achillea/guide"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition mb-2"
        >
          <ArrowLeft className="size-3.5" />
          Retour au guide
        </Link>
        <h1 className="text-3xl font-extrabold tracking-tight">Brand Kit & Direction Artistique</h1>
        <p className="text-muted-foreground">
          Charte visuelle d&apos;Achilléa : palettes chromatiques des 11 paliers, typographies et
          assets officiels.
        </p>
      </div>

      {/* Palette des 11 Paliers */}
      <Card className="border-border/60">
        <CardHeader className="p-6 pb-2">
          <CardTitle className="text-xl flex items-center gap-2.5">
            <Palette className="size-5 text-primary" />
            Palette des 11 Paliers de Ranking
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Définies dans <code className="text-primary font-mono">achillea.css</code> sous forme de
            gradients et variables CSS{" "}
            <code className="font-mono">--achillea-rank-[1-11]-stops</code>.
          </p>
        </CardHeader>
        <CardContent className="p-6 pt-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {PALETTES.map((p) => (
              <div
                key={p.rank}
                className="rounded-xl overflow-hidden border border-border/60 bg-muted/20 flex flex-col"
              >
                <div
                  className="h-20 w-full"
                  style={{
                    background: `linear-gradient(135deg, var(${p.stopsVar}))`,
                  }}
                  aria-label={`Gradient palier ${p.name}`}
                />
                <div className="p-3 space-y-1 flex-1 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm">
                      #{p.rank} — {p.name}
                    </span>
                    <Badge variant="outline" className="font-mono text-[10px] px-1.5 py-0">
                      {p.primary}
                    </Badge>
                  </div>
                  <code className="text-[11px] font-mono text-muted-foreground truncate block">
                    var({p.stopsVar})
                  </code>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Typographies */}
      <Card className="border-border/60">
        <CardHeader className="p-6 pb-2">
          <CardTitle className="text-xl flex items-center gap-2.5">
            <Type className="size-5 text-primary" />
            Typographies du Projet
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 pt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {FONTS.map((font) => (
              <div
                key={font.family}
                className="border border-border/60 rounded-xl p-4 bg-muted/20 space-y-2"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <div className="font-bold text-sm">{font.label}</div>
                  <Badge variant="outline" className="text-[10px] font-mono text-muted-foreground">
                    {font.fallback}
                  </Badge>
                </div>
                <div className="text-xl font-bold tracking-wide">
                  Achilléa — Aa Bb Cc 0123456789
                </div>
                <div className="text-xs text-muted-foreground font-mono truncate">
                  Source : {font.source}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Logos & Visuels */}
      <Card className="border-border/60">
        <CardHeader className="p-6 pb-2">
          <CardTitle className="text-xl flex items-center gap-2.5">
            <ImageIcon className="size-5 text-primary" />
            Logos & Identité Visuelle
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {LOGOS.map((logo) => (
              <div
                key={logo.path}
                className="border border-border/60 rounded-xl p-4 bg-muted/20 flex flex-col items-center text-center space-y-3"
              >
                <div className="h-28 w-full flex items-center justify-center p-2 bg-black/40 rounded-lg relative">
                  <Image
                    src={logo.path}
                    alt={logo.label}
                    width={120}
                    height={80}
                    className="max-h-24 max-w-full object-contain"
                  />
                </div>
                <div className="space-y-1">
                  <div className="font-bold text-sm">{logo.label}</div>
                  {logo.note && <div className="text-xs text-muted-foreground">{logo.note}</div>}
                </div>
                <code className="text-[11px] font-mono text-muted-foreground/80 break-all">
                  {logo.path}
                </code>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
