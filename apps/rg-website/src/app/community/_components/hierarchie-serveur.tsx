import { couleurRole } from "@rosegriffon/types/discord-hierarchie";

import { chercherMembres, lireHierarchie, type CleServeur } from "@/lib/discord/hierarchie";

import { GrilleMembres, TitreSection } from "./membre-carte";

/**
 * Hiérarchie d'un serveur Discord — la vraie, celle du serveur.
 *
 * Les sections sont les rôles DÉTACHÉS (`hoist`) du serveur, dans l'ordre où
 * Discord les range, et les membres y sont placés par leur rôle détaché le plus
 * haut. Aucun barème inventé, aucun identifiant recopié : un rôle créé,
 * renommé, déplacé ou supprimé sur Discord apparaît ici à la synchronisation
 * suivante sans qu'une ligne de code change.
 */
export async function HierarchieServeur({
  cle,
  recherche,
  staffSeulement = false,
}: {
  cle: CleServeur;
  recherche?: string;
  /** Ne montrer que ceux qui ont des pouvoirs réels sur le serveur. */
  staffSeulement?: boolean;
}) {
  if (recherche) {
    const trouves = await chercherMembres(cle, recherche);
    return (
      <div className="flex flex-col gap-3">
        <TitreSection titre={`Résultats pour « ${recherche} »`} effectif={trouves.length} />
        {trouves.length > 0 ? (
          <GrilleMembres membres={trouves} compacte />
        ) : (
          <p className="py-8 text-center text-sm text-on-surface-variant">
            Aucun membre ne porte ce nom sur ce serveur.
          </p>
        )}
      </div>
    );
  }

  const hierarchie = await lireHierarchie(cle);

  if (staffSeulement) {
    const rien = hierarchie.administration.length === 0 && hierarchie.moderation.length === 0;
    return (
      <div className="flex flex-col gap-6">
        {rien && (
          <p className="text-sm text-on-surface-variant">
            Aucun rôle de ce serveur ne porte de permission d&apos;administration ou de modération.
          </p>
        )}
        {hierarchie.administration.length > 0 && (
          <section className="flex flex-col gap-3">
            <TitreSection titre="Administration" effectif={hierarchie.administration.length} />
            <p className="-mt-1 text-xs text-on-surface-variant/70">
              Membres dont un rôle porte la permission « Administrateur » ou « Gérer le serveur ».
            </p>
            <GrilleMembres membres={hierarchie.administration} />
          </section>
        )}
        {hierarchie.moderation.length > 0 && (
          <section className="flex flex-col gap-3">
            <TitreSection titre="Modération" effectif={hierarchie.moderation.length} />
            <p className="-mt-1 text-xs text-on-surface-variant/70">
              Membres habilités à exclure, bannir, isoler ou gérer les messages.
            </p>
            <GrilleMembres membres={hierarchie.moderation} />
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {hierarchie.sections.map(section => (
        <section key={section.role?.role_id ?? "sans-role"} className="flex flex-col gap-3">
          <TitreSection
            titre={section.role?.name ?? "Membres"}
            effectif={section.membres.length}
            couleur={couleurRole(section.role)}
          />
          <GrilleMembres membres={section.membres} compacte />
        </section>
      ))}
    </div>
  );
}

/** Effectif et fraîcheur, sous le sélecteur de serveur. */
export async function ResumeServeur({ cle }: { cle: CleServeur }) {
  const { total, misAJourLe, administration, moderation } = await lireHierarchie(cle);

  return (
    <p className="text-xs text-on-surface-variant/70">
      {total.toLocaleString("fr-FR")} membres · {administration.length + moderation.length} au staff
      {misAJourLe && (
        <>
          {" · relevé "}
          {new Intl.DateTimeFormat("fr-FR", {
            dateStyle: "short",
            timeStyle: "short",
          }).format(new Date(misAJourLe))}
        </>
      )}
    </p>
  );
}
