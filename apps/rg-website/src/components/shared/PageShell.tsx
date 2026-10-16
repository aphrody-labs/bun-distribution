import { cn } from "@/lib/utils";

/*
 * Coque commune des pages institutionnelles (à propos, contact, rejoindre-rg,
 * charte d'engagements, nous soutenir, cellule de médiation, événements).
 *
 * Le motif était copié-collé — et dérivé — d'une page à l'autre : largeurs
 * maximales différentes (`container`, `max-w-5xl`, `max-w-6xl`), gouttières
 * différentes (`px-2`, `px-4`, `px-6`), bannières de marque toutes repeintes à
 * la main en hexadécimal. Ces quatre briques figent le motif une seule fois.
 *
 * Aucune couleur en dur ici : uniquement les tokens du design system
 * (`bg-card`, `border-border`, `text-muted-foreground`) et les tokens de marque
 * Rose Griffon (`rg-marine`, `rg-brique`, `rg-or`, `rg-sur-marine`), qui sont
 * volontairement constants d'un thème à l'autre.
 */

/**
 * Habillage des boutons posés SUR la bannière de marque. Le `Button` partagé
 * suppose un fond d'interface ; sur le dégradé marine ses variantes `default`
 * (primaire sombre) et `outline` (fond `background`) passent sous le seuil de
 * contraste. Ces deux classes le rétablissent avec les seuls tokens de marque —
 * à passer en `className` du `Button`, jamais à réécrire à la main.
 *
 * `whitespace-normal` + `h-auto min-h-12` : le `Button` partagé impose
 * `whitespace-nowrap`, ce qui fait déborder un libellé long dès 320 px.
 */
const heroButtonBase = "h-auto min-h-11 rounded-xl px-4 py-2 text-center text-sm font-semibold whitespace-normal";
export const heroPrimaryButtonClass = `${heroButtonBase} bg-rg-or text-rg-marine hover:bg-rg-or/90`;
export const heroSecondaryButtonClass = `${heroButtonBase} border border-rg-or/60 bg-rg-sur-marine/10 text-rg-sur-marine backdrop-blur-sm hover:border-rg-or hover:bg-rg-sur-marine/20 hover:text-rg-sur-marine`;

/** Conteneur de page — même largeur maximale et mêmes gouttières que la home. */
export function PageContainer({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-4 min-[600px]:px-6 min-[600px]:py-6 min-[840px]:gap-8",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * En-tête d'application compact. Le nom historique `PageHero` est conservé
 * pour ne pas casser ses consommateurs, mais le composant n'est plus une
 * bannière éditoriale : identité, titre et éventuelles actions tiennent dans
 * une seule barre responsive.
 */
export function PageHero({
  eyebrow,
  icon,
  title,
  description,
  actions,
  image,
  children,
}: {
  /** Sur-titre court (ex. « Association loi 1901 »). */
  eyebrow?: React.ReactNode;
  /** Icône décorative affichée devant le sur-titre. */
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Zone d'actions — un contrôle donné ne doit exister qu'une fois par écran. */
  actions?: React.ReactNode;
  /**
   * Photo de fond optionnelle. Le dégradé de marque est alors appliqué
   * par-dessus, à opacité quasi pleine : le texte garde son contraste quelle
   * que soit la photo, et la bannière reste reconnaissable.
   */
  image?: { src: string };
  children?: React.ReactNode;
}) {
  void description;
  void image;

  return (
    <header className="flex min-h-16 flex-col gap-3 border-b border-border pb-4 min-[600px]:flex-row min-[600px]:items-center min-[600px]:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        {icon && (
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          {eyebrow && (
            <div className="truncate text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {eyebrow}
            </div>
          )}
          <h1 className="truncate text-2xl font-bold tracking-tight text-foreground min-[840px]:text-3xl">{title}</h1>
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      {children && <div className="min-[600px]:basis-full">{children}</div>}
    </header>
  );
}

/** En-tête de section : pastille d'icône + titre + sous-titre + action. */
export function SectionHeading({
  icon,
  iconClassName,
  title,
  subtitle,
  action,
  id,
}: {
  icon?: React.ReactNode;
  /** Couleurs de la pastille — tokens uniquement (`bg-primary text-primary-foreground`…). */
  iconClassName?: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  id?: string;
}) {
  return (
    <div className="mb-4 flex flex-col items-start justify-between gap-3 min-[600px]:flex-row min-[600px]:items-center">
      <div className="flex items-center gap-3">
        {icon && <div className={cn("rounded-lg p-2 shadow-lg", iconClassName)}>{icon}</div>}
        <div>
          <h2 id={id} className="text-fluid-headline-lg font-bold text-foreground">
            {title}
          </h2>
          {subtitle && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

/** Carte de section : surface thématisée, jamais un blanc codé en dur. */
export function SectionCard({
  children,
  className,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-24 rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-sm min-[600px]:p-6",
        className,
      )}
    >
      {children}
    </section>
  );
}
