import { AlertTriangle, ListTree } from "lucide-react";

import { AdminPageHeader, Card, CardDescription, CardHeader, CardTitle } from "@rosegriffon/ui";

import { commandesDesBots } from "@/lib/bot/serveur";

import { TableauCommandes } from "./TableauCommandes";

export const dynamic = "force-dynamic";

export const metadata = {
  description: "Toutes les slash commands réellement enregistrées par les deux bots Discord.",
  title: "Commandes du bot — Administration",
};

/**
 * Catalogue des slash commands.
 *
 * ── LA SEULE LISTE QUI NE PEUT PAS MENTIR ──────────────────────────────────
 * Elle vient des décorateurs `discordx` exécutés au chargement de chaque
 * processus — c'est-à-dire de l'arbre que Discord a reçu, pas d'un inventaire
 * tenu à la main dans le site. Un fichier de commandes ajouté au profil
 * apparaît ici au redémarrage du service, sans qu'il y ait rien à mettre à jour
 * de ce côté.
 *
 * Corollaire : un bot arrêté ne rend AUCUNE commande, et la page le dit
 * explicitement plutôt que d'afficher une liste tronquée qui passerait pour
 * complète.
 */
export default async function CommandesBotPage() {
  const { commandes, indisponibles } = await commandesDesBots();

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <AdminPageHeader
        breadcrumbs={[
          { href: "/admin", label: "Administration" },
          { href: "/admin/bot", label: "Bot Discord" },
          { label: "Commandes" },
        ]}
        icon={<ListTree className="size-5" />}
        title="Commandes"
        description="L'arbre tel que Discord l'a reçu — lu dans les processus, pas recopié."
      />

      {indisponibles.length > 0 && (
        <Card className="border-alerte/40 bg-alerte/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-alerte" aria-hidden />
              Catalogue incomplet
            </CardTitle>
            <CardDescription>
              {indisponibles.map(manquant => (
                <span key={manquant.profil.nom} className="block">
                  {manquant.profil.titre} n&apos;a pas répondu : {manquant.erreur}. Ses commandes manquent à cette
                  liste.
                </span>
              ))}
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <TableauCommandes commandes={commandes} />
    </div>
  );
}
