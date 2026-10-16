import { Settings2 } from "lucide-react";

import { AdminPageHeader } from "@rosegriffon/ui";
import { RG_GUILD_ID } from "@rosegriffon/types/discord";

import { requireAdmin } from "@/lib/auth-helpers";
import { lireReglagesGuilde } from "@/lib/bot/reglages";
import { annuaireGuilde } from "@/lib/bot/serveur";

import { FormulaireReglages } from "./FormulaireReglages";

export const dynamic = "force-dynamic";

export const metadata = {
  description:
    "Niveaux, tickets, journal de modération, accueil, suggestions et jetons Kizuna — les réglages que le bot applique sur le serveur.",
  title: "Réglages du bot — Administration",
};

/**
 * Réglages de communauté, édités depuis le site.
 *
 * ── LA MÊME COLONNE QUE `/administration réglages` ─────────────────────────
 * Ce formulaire écrit `bot_reglages_guilde.valeurs`, exactement comme les slash
 * commands. Les deux surfaces appliquent le MÊME schéma zod partagé
 * (`@rosegriffon/types/bot`) : c'est la seule chose qui empêche l'une
 * d'enregistrer une valeur que l'autre refuserait de relire — et comme la
 * lecture du bot ne lève jamais, une valeur illisible ferait retomber tout le
 * serveur sur les défauts sans le moindre signal.
 */
export default async function ReglagesBotPage() {
  const { role } = await requireAdmin();

  const [reglages, annuaire] = await Promise.all([lireReglagesGuilde(RG_GUILD_ID), annuaireGuilde(RG_GUILD_ID)]);

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <AdminPageHeader
        breadcrumbs={[
          { href: "/admin", label: "Administration" },
          { href: "/admin/bot", label: "Bot Discord" },
          { label: "Réglages" },
        ]}
        icon={<Settings2 className="size-5" />}
        title="Réglages de communauté"
        description={
          reglages.parDefaut
            ? "Ce serveur n'a jamais rien réglé : le bot applique ses défauts et ne publie nulle part."
            : reglages.majLe
              ? `Dernière modification ${new Date(reglages.majLe).toLocaleString("fr-FR")}.`
              : "Date de modification non renseignée."
        }
      />

      <FormulaireReglages
        guildId={RG_GUILD_ID}
        initiaux={reglages.reglages}
        salons={annuaire.salons}
        roles={annuaire.roles}
        erreurAnnuaire={annuaire.erreur}
        peutReinitialiser={role === "admin"}
      />
    </div>
  );
}
