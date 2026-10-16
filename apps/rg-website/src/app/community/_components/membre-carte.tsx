import Image from "next/image";

import { couleurRole, type MembreClasse } from "@rosegriffon/types/discord-hierarchie";

import { cn } from "@/lib/utils";

/**
 * Carte d'un membre — UNIQUE.
 *
 * Il y en avait trois : celle de l'annuaire Discord (`MemberCard`, avec halo
 * animé pour un rôle codé en dur), celle du staff associatif
 * (`TeamMembersSection`) et celle des équipes (`teams.tsx`). Trois mises en page
 * pour « une photo, un nom, un rôle ».
 *
 * `role` est libre : c'est le nom du rôle Discord pour un membre du serveur, le
 * poste pour un membre de l'association. `couleur` vient de Discord quand elle
 * existe — une couleur de rôle est une information, pas une décoration.
 */
export function CarteMembre({
  nom,
  role,
  couleur,
  avatar,
  lien,
  detail,
  taille = "normale",
}: {
  nom: string;
  role?: string | null;
  couleur?: string | null;
  avatar?: string | null;
  lien?: string | null;
  /** Mention secondaire : ancienneté, plateforme, ce que la vue juge utile. */
  detail?: string | null;
  taille?: "normale" | "compacte";
}) {
  const compacte = taille === "compacte";

  const contenu = (
    <>
      <div
        className={cn("relative overflow-hidden rounded-full border", compacte ? "size-10" : "size-14")}
        style={couleur ? { borderColor: couleur } : undefined}
      >
        <Image
          src={avatar || "/default-avatar.webp"}
          alt=""
          fill
          sizes={compacte ? "40px" : "56px"}
          className="object-cover"
        />
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={cn("truncate font-semibold", compacte ? "text-xs" : "text-sm")}
          style={couleur ? { color: couleur } : undefined}
          title={nom}
        >
          {nom}
        </p>
        {role && (
          <p className="truncate text-[11px] text-on-surface-variant/80" title={role}>
            {role}
          </p>
        )}
        {detail && <p className="truncate text-[10px] text-on-surface-variant/50">{detail}</p>}
      </div>
    </>
  );

  const classes = cn(
    "flex items-center gap-2.5 rounded-xl border border-outline-variant/15 bg-surface-container-low p-2.5",
    lien && "transition-colors hover:border-primary/40 hover:bg-surface-container",
  );

  return lien ? (
    <a href={lien} target="_blank" rel="noopener noreferrer" className={classes}>
      {contenu}
    </a>
  ) : (
    <div className={classes}>{contenu}</div>
  );
}

/** Grille de membres Discord — une section de la hiérarchie. */
export function GrilleMembres({ membres, compacte }: { membres: MembreClasse[]; compacte?: boolean }) {
  return (
    <div
      className={cn(
        "grid gap-2",
        compacte
          ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
          : "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4",
      )}
    >
      {membres.map(membre => (
        <CarteMembre
          key={membre.discord_id}
          nom={membre.nomAffiche}
          role={membre.roleLePlusHaut?.name}
          couleur={couleurRole(membre.roleLePlusHaut)}
          avatar={membre.avatar_url}
          detail={membre.estBooster ? "Booster du serveur" : null}
          taille={compacte ? "compacte" : "normale"}
        />
      ))}
    </div>
  );
}

/** Titre d'une section, avec son effectif. */
export function TitreSection({
  titre,
  effectif,
  couleur,
}: {
  titre: string;
  effectif: number;
  couleur?: string | null;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <h3 className="text-sm font-bold uppercase tracking-wide" style={couleur ? { color: couleur } : undefined}>
        {titre}
      </h3>
      <span className="text-xs tabular-nums text-on-surface-variant/60">{effectif}</span>
      <div className="ml-1 h-px flex-1 bg-outline-variant/15" />
    </div>
  );
}
