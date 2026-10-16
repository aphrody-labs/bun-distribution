import { ArrowRight, Swords } from "lucide-react";
import Link from "next/link";

/**
 * Section « réseau Rose Griffon » de la home Azalée.
 *
 * Azalée est le wiki du réseau Rose Griffon : cette section présente l'association
 * (site principal) et le pôle compétitif Achilléa, pour qu'un visiteur du wiki
 * découvre l'écosystème. Aligné sur le pattern de la home website (bannières
 * Rose Griffon / Azalée / Achilléa) et sur les en-têtes de section de la home
 * (barre colorée + titre `font-expressive-title`). Les cartes restent des
 * passerelles : elles ne réinjectent pas les accueils complets dans le wiki.
 */
export function NetworkSection() {
  return (
    <section className="w-full md:px-8 lg:px-12" aria-labelledby="network-heading">
      <div className="mb-5 md:mb-6">
        <h2
          id="network-heading"
          className="text-xl md:text-3xl font-black text-on-surface font-expressive-title flex items-center gap-3"
        >
          <span className="w-2 h-8 rounded-full bg-primary" />
          Le réseau Rose Griffon
        </h2>
        <p className="mt-2 text-sm md:text-base text-on-surface-variant max-w-2xl text-pretty">
          Azalée fait partie de Rose Griffon, l'association de la communauté Inazuma Eleven en France. Découvrez le site
          de l'association et Achilléa, son pôle compétitif (clans, tournois et matchs classés).
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/"
          className="group rounded-2xl border border-outline-variant/20 bg-surface-container-low p-5 transition-colors hover:border-primary/50 hover:bg-surface-container"
        >
          <p className="text-xs font-black uppercase tracking-wider text-primary">Association</p>
          <h3 className="mt-1 text-xl font-black text-on-surface">Rose Griffon</h3>
          <p className="mt-2 text-sm text-on-surface-variant">
            Actualités, événements et la communauté Inazuma Eleven.
          </p>
          <span className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-primary">
            Découvrir <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
          </span>
        </Link>
        <Link
          href="/achillea"
          className="group rounded-2xl border border-achillea-purple/30 bg-achillea-purple-dark/70 p-5 transition-colors hover:border-achillea-lime/60 hover:bg-achillea-purple-hover"
        >
          <p className="inline-flex items-center gap-1 text-xs font-black uppercase tracking-wider text-achillea-lime">
            <Swords className="size-3.5" /> Compétition
          </p>
          <h3 className="mt-1 text-xl font-black text-white">Achilléa</h3>
          <p className="mt-2 text-sm text-white/70">Clans, tournois et classement officiel.</p>
          <span className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-achillea-lime">
            Accéder à l&apos;esport <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
          </span>
        </Link>
      </div>
    </section>
  );
}
