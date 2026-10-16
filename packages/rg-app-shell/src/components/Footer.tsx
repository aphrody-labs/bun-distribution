import Link from "next/link";

export interface FooterProps {
  className?: string;
}

/**
 * Pied de page applicatif compact.
 *
 * La navigation principale et les réseaux sont déjà disponibles dans le
 * chrome de l'application. Le footer ne conserve donc que les accès légaux
 * indispensables, sans recréer plusieurs colonnes de navigation.
 */
export function Footer({ className }: FooterProps = {}) {
  const currentYear = new Date().getFullYear();

  return (
    <footer className={`mt-auto w-full border-t border-outline-variant/10 bg-surface-container ${className ?? ""}`}>
      <div className="mx-auto flex w-full max-w-[1800px] flex-wrap items-center justify-between gap-x-5 gap-y-2 px-4 py-3 text-xs text-on-surface-variant md:px-8">
        <p>© {currentYear} Rose Griffon</p>
        <nav aria-label="Informations légales" className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link href="/a-propos/contact" className="transition-colors hover:text-primary">
            Contact
          </Link>
          <Link href="/legal/mentions-legales" className="transition-colors hover:text-primary">
            Mentions légales
          </Link>
          <Link href="/legal/cgu" className="transition-colors hover:text-primary">
            CGU
          </Link>
          <Link href="/legal/confidentialite" className="transition-colors hover:text-primary">
            Confidentialité
          </Link>
        </nav>
      </div>
    </footer>
  );
}

export { Footer as AzaleeFooter };
export default Footer;
