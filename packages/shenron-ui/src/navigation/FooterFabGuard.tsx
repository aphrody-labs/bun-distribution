"use client";

/**
 * Efface les boutons flottants (`.fab-secondary` : « Signaler une erreur »,
 * invitation Discord) quand le pied de page entre à l'écran.
 *
 * Ils sont ancrés en bas à gauche, en `position: fixed` — donc au-dessus de
 * TOUT, pied de page compris. Mesuré sur `/wiki/chronologie` : le lien
 * « Accueil » du pied de page était recouvert par le bouton « Signaler une
 * erreur » et ne répondait plus au clic. Le pied de page compte une trentaine
 * de liens, dont plusieurs sont la seule porte d'entrée de leur section.
 *
 * Une sentinelle `IntersectionObserver` plutôt qu'un écouteur de `scroll` :
 * aucun calcul par image, et le navigateur ne réveille le fil principal que
 * lorsque le seuil est franchi.
 */
import { useEffect, useRef } from "react";

export function FooterFabGuard() {
  const sentinelle = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelle.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entree]) => {
        document.documentElement.toggleAttribute(
          "data-footer-visible",
          !!entree?.isIntersecting,
        );
      },
      // Une marge basse généreuse : les boutons doivent s'être effacés AVANT
      // que le pied de page n'arrive sous eux, pas au moment où il y est.
      { rootMargin: "0px 0px 120px 0px" },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      document.documentElement.removeAttribute("data-footer-visible");
    };
  }, []);

  return <div ref={sentinelle} aria-hidden className="h-px w-full" />;
}
