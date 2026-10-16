import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

interface Tier {
  name: string;
  priceCents: number;
  color: string;
  perks: string[];
  highlight?: boolean;
}

const TIERS: Tier[] = [
  {
    color: "#aac9d9",
    name: "Niveau Roy 🌹",
    perks: ["Rôle Discord Roy", "Newsletter exclusive", "Mention dans le générique des chroniques"],
    priceCents: 250,
  },
  {
    color: "#e54a4a",
    name: "Niveau Gaëlle 🌹",
    perks: ["Tous les avantages Roy", "Accès en avant-première aux articles", "Vote sur les futurs sujets"],
    priceCents: 750,
  },
  {
    color: "#5fa893",
    highlight: true,
    name: "Niveau Evans 🌹",
    perks: [
      "Tous les avantages Gaëlle",
      "Pack Personnage trimestriel offert (print A5 + marque-page + sticker + badge)",
      "Crédit boutique 5 €/mois",
      "Discord chat privé avec l'équipe",
    ],
    priceCents: 1450,
  },
];

function formatPrice(cents: number): string {
  return `${(cents / 100).toFixed(2).replace(".", ",")} €`;
}

export function TierComparator() {
  return (
    <div className="grid gap-6 md:grid-cols-3">
      {TIERS.map(tier => (
        <div
          key={tier.name}
          className={cn(
            "relative rounded-2xl border p-6 transition",
            tier.highlight
              ? "border-[#c9a958] bg-card shadow-[0_0_24px_rgba(201,169,88,0.2)]"
              : "border-border bg-card",
          )}
        >
          {tier.highlight && (
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[#c9a958] px-3 py-1 text-xs font-bold text-[#0c1730]">
              TIER PHARE
            </div>
          )}
          <div
            className="mb-3 inline-block rounded-md px-2 py-1 text-xs font-semibold"
            style={{
              backgroundColor: `${tier.color}33`,
              color: tier.color,
            }}
          >
            Patreon → Stripe
          </div>
          <h3 className="text-lg font-bold text-foreground">{tier.name}</h3>
          <p className="mb-4 mt-1 text-2xl font-bold text-[#a08540] dark:text-[#c9a958]">
            {formatPrice(tier.priceCents)}
            <span className="text-sm font-normal text-muted-foreground">/mois</span>
          </p>
          <ul className="space-y-2 text-sm text-foreground/85">
            {tier.perks.map((perk, i) => (
              <li key={i} className="flex gap-2">
                <Check className="mt-0.5 size-4 shrink-0" style={{ color: tier.color }} />
                <span>{perk}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
