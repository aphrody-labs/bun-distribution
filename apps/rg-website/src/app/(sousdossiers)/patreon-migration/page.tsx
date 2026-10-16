import { Coins, EyeOff, Heart, Users } from "lucide-react";
import type { Metadata } from "next";

import { MigrationFAQ } from "@/components/patreon/MigrationFAQ";
import { PatreonConnectButton } from "@/components/patreon/PatreonConnectButton";
import { TierComparator } from "@/components/patreon/TierComparator";
import { requireAdmin } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  description: "Page de prévisualisation interne — accès restreint au staff RG.",
  robots: { follow: false, index: false, nocache: true },
  title: "Migration Patreon (preview admin) · Rose Griffon",
};

export default async function PatreonMigrationPage() {
  await requireAdmin();
  return <PatreonMigrationPreview />;
}

function PatreonMigrationPreview() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Banner preview staff */}
      <div className="border-b border-amber-500/40 bg-amber-500/15 px-6 py-3">
        <div className="mx-auto flex max-w-5xl items-center gap-3 text-sm text-amber-700 dark:text-amber-200">
          <EyeOff className="size-4 shrink-0" />
          <span>
            <strong>Preview interne staff RG</strong> — page non publiée. Aucune communication tant que l'annonce
            migration Patreon n'est pas validée.
          </span>
        </div>
      </div>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-20 dark:opacity-30"
          style={{
            background:
              "radial-gradient(circle at 30% 20%, rgba(201,169,88,0.4), transparent 50%), radial-gradient(circle at 70% 60%, rgba(229,74,74,0.3), transparent 50%)",
          }}
        />
        <div className="relative mx-auto max-w-5xl px-6 py-20 text-center">
          <div className="mb-4 inline-block rounded-full border border-[#c9a958]/40 bg-[#c9a958]/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-[#a08540] dark:text-[#c9a958]">
            Migration en cours
          </div>
          <h1 className="text-4xl font-bold sm:text-5xl md:text-6xl">
            <span className="bg-linear-to-r from-[#a08540] via-[#c9a958] to-[#a08540] bg-clip-text text-transparent dark:from-[#c9a958] dark:via-[#dab86a] dark:to-[#c9a958]">
              Rose Griffon prend son envol
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            Nous quittons Patreon pour notre propre plateforme. Liez votre compte en 2 clics, gardez votre rôle Discord,
            et conservez le
            <strong className="text-[#a08540] dark:text-[#c9a958]"> même tarif pendant 12 mois</strong>.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <PatreonConnectButton variant="patron-link" />
            <a href="#tiers" className="text-sm text-muted-foreground hover:text-foreground">
              Voir les paliers ↓
            </a>
          </div>
        </div>
      </section>

      {/* Why */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <div className="grid gap-6 md:grid-cols-3">
          {[
            {
              desc: "Patreon prend 8-12% + frais de paiement. Stripe direct = 1.4% + 0.25€. Plus de soutien réel pour la création.",
              icon: Coins,
              title: "Frais réduits",
            },
            {
              desc: "Soutiens récurrents + achats one-shot (prints, packs, stickers) au même endroit, dans la même communauté.",
              icon: Heart,
              title: "Une vraie boutique",
            },
            {
              desc: "Votre rôle Discord est attribué automatiquement à la souscription. Pas d'intermédiaire, pas de bug.",
              icon: Users,
              title: "Discord auto-géré",
            },
          ].map((card, i) => (
            <div key={i} className="rounded-2xl border border-border bg-card p-6 text-card-foreground">
              <card.icon className="size-6 text-[#c9a958]" />
              <h3 className="mt-4 font-bold">{card.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{card.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Tiers */}
      <section id="tiers" className="mx-auto max-w-5xl px-6 py-16">
        <div className="mb-10 text-center">
          <h2 className="text-3xl font-bold">Les paliers, sans changement</h2>
          <p className="mt-3 text-muted-foreground">Mêmes tarifs Patreon garantis 12 mois. Pas de mauvaise surprise.</p>
        </div>
        <TierComparator />
      </section>

      {/* CTA milieu */}
      <section className="mx-auto max-w-3xl px-6 py-12 text-center">
        <div className="rounded-3xl border border-[#c9a958]/40 bg-card p-10 text-card-foreground">
          <h2 className="text-2xl font-bold">Prêt·e à basculer ?</h2>
          <p className="mt-3 text-muted-foreground">
            En 2 clics : OAuth Patreon → choix du palier → paiement Stripe. Le rôle Discord arrive dans la minute.
          </p>
          <div className="mt-6">
            <PatreonConnectButton variant="patron-link" />
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-6 py-16">
        <h2 className="mb-8 text-center text-3xl font-bold">Questions fréquentes</h2>
        <MigrationFAQ />
      </section>
    </div>
  );
}
