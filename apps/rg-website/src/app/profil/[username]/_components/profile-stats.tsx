import { Card, CardContent } from "@rosegriffon/ui";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { CalendarDays, Coins, Flame, Gem, MessageSquare, Star, TrendingUp, Trophy, UserCheck } from "lucide-react";

/**
 * La fiche détaillée du profil — ce que le membre a réellement fait.
 *
 * ── POURQUOI TOUT EN BAS, ET PAS DANS LA CARTE ─────────────────────────────
 * La carte de joueur porte l'identité : qui c'est, son élément, son niveau.
 * Ces chiffres-là sont d'un autre ordre — ils se consultent, ils ne se
 * regardent pas. Les empiler dans la carte l'aurait transformée en tableau de
 * bord ; ici ils forment une grille qu'on parcourt quand on veut savoir depuis
 * quand quelqu'un est là.
 *
 * ── AUCUNE CASE INVENTÉE ───────────────────────────────────────────────────
 * Chaque tuile vient d'une colonne réelle : `discord_members.joined_at`,
 * `bot_profils.messages_comptes`, `profiles.claimed_at`… Une donnée absente
 * (compte non lié au Discord, bot qui n'a jamais vu ce membre) fait disparaître
 * sa tuile — on ne montre pas « 0 message » à quelqu'un dont on ne sait rien.
 */
export interface StatistiquesProfil {
  /** Arrivée sur le serveur Discord. */
  arriveeDiscord?: string | null;
  /** Réclamation du compte sur le site. */
  inscriptionSite?: string | null;
  /** Messages comptés par le bot (jamais lus — seulement dénombrés). */
  messages?: number | null;
  /** Solde de jetons Kizuna. */
  jetons?: number | null;
  /** Jours consécutifs de récompense quotidienne. */
  serie?: number | null;
  /** Expérience cumulée. */
  xp?: number | null;
  /** Boost du serveur, depuis cette date. */
  boostDepuis?: string | null;
  /** Rôles Discord portés, du plus haut au plus bas. */
  roles?: ReadonlyArray<{ nom: string; couleur: number | null }>;
  /** Données publiques Achilléa, lues dans le schéma partagé. */
  clanAchillea?: string | null;
  eloMax?: number | null;
  partiesClassees?: number | null;
}

export function ProfileStats({ stats }: { stats: StatistiquesProfil }) {
  const tuiles = [
    {
      icone: CalendarDays,
      libelle: "Sur le serveur depuis",
      valeur: dateLongue(stats.arriveeDiscord),
    },
    { icone: UserCheck, libelle: "Compte du site créé", valeur: dateLongue(stats.inscriptionSite) },
    { icone: MessageSquare, libelle: "Messages", valeur: nombre(stats.messages) },
    { icone: TrendingUp, libelle: "Expérience", valeur: nombre(stats.xp, " XP") },
    { icone: Coins, libelle: "Jetons Kizuna", valeur: nombre(stats.jetons) },
    { icone: Trophy, libelle: "Clan Achilléa", valeur: stats.clanAchillea ?? null },
    { icone: Trophy, libelle: "Meilleur ELO", valeur: nombre(stats.eloMax) },
    { icone: Trophy, libelle: "Parties classées", valeur: nombre(stats.partiesClassees) },
    {
      icone: Flame,
      libelle: "Série quotidienne",
      valeur: stats.serie ? `${stats.serie} jour${stats.serie > 1 ? "s" : ""}` : null,
    },
    { icone: Gem, libelle: "Boost du serveur", valeur: dateLongue(stats.boostDepuis) },
  ].filter(tuile => tuile.valeur !== null);

  const roles = stats.roles ?? [];

  if (tuiles.length === 0 && roles.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardContent className="p-6">
        <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-foreground">
          <Star className="size-4 text-muted-foreground" aria-hidden />
          Fiche
        </h2>

        {tuiles.length > 0 && (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {tuiles.map(tuile => (
              <div key={tuile.libelle} className="rounded-xl border border-border bg-muted/30 p-3">
                <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <tuile.icone className="size-3.5 shrink-0" aria-hidden />
                  {tuile.libelle}
                </dt>
                <dd className="mt-1 text-sm font-bold text-foreground">{tuile.valeur}</dd>
              </div>
            ))}
          </dl>
        )}

        {roles.length > 0 && (
          <div className="mt-5">
            <h3 className="mb-2 text-xs font-semibold text-muted-foreground uppercase">Rôles sur le Discord</h3>
            <ul className="flex flex-wrap gap-1.5">
              {roles.map(role => (
                <li
                  key={role.nom}
                  className="rounded-full border px-2.5 py-0.5 text-xs font-semibold"
                  // La couleur du rôle telle que Discord la donne : c'est celle qui
                  // colore déjà le pseudo dans les salons.
                  style={
                    role.couleur
                      ? {
                          borderColor: `#${role.couleur.toString(16).padStart(6, "0")}66`,
                          color: `#${role.couleur.toString(16).padStart(6, "0")}`,
                        }
                      : undefined
                  }
                >
                  {role.nom}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** « 11 février 2025 », ou `null` quand la date manque — pas « Date inconnue ». */
function dateLongue(valeur: string | null | undefined): string | null {
  if (!valeur) {
    return null;
  }
  const date = new Date(valeur);
  return Number.isNaN(date.getTime()) ? null : format(date, "d MMMM yyyy", { locale: fr });
}

/** Un compteur n'a de sens qu'à partir de 1 : à zéro, la tuile disparaît. */
function nombre(valeur: number | null | undefined, suffixe = ""): string | null {
  const n = Number(valeur ?? 0);
  return Number.isFinite(n) && n > 0 ? `${n.toLocaleString("fr-FR")}${suffixe}` : null;
}
