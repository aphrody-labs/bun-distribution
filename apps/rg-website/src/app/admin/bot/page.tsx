import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Coins,
  Inbox,
  LifeBuoy,
  ListTree,
  MessageSquare,
  Settings2,
  Timer,
  TrendingUp,
  Users,
  XCircle,
} from "lucide-react";

import {
  AdminPageHeader,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DashboardStatsCard,
} from "@rosegriffon/ui";
import { manquesParSection, LIBELLES_SECTIONS, SECTIONS_REGLAGES } from "@rosegriffon/types/bot";
import { RG_GUILD_ID } from "@rosegriffon/types/discord";

import { etatDuCron } from "@/lib/bot/cron";
import { lireReglagesGuilde, statistiquesCommunaute } from "@/lib/bot/reglages";
import { etatDesBots } from "@/lib/bot/serveur";

export const dynamic = "force-dynamic";

export const metadata = {
  description: "État des deux bots Discord, réglages de communauté et ordonnanceur des tâches planifiées.",
  title: "Bot Discord — Administration",
};

/** Durée lisible à partir d'un nombre de secondes. */
function duree(secondes: number): string {
  if (secondes < 60) {
    return `${secondes} s`;
  }
  const minutes = Math.floor(secondes / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const heures = Math.floor(minutes / 60);
  if (heures < 24) {
    return `${heures} h ${minutes % 60} min`;
  }
  return `${Math.floor(heures / 24)} j ${heures % 24} h`;
}

function mega(octets: number): string {
  return `${Math.round(octets / 1024 / 1024)} Mo`;
}

export default async function BotDashboardPage() {
  const [bots, cron, reglages, stats] = await Promise.all([
    etatDesBots(),
    etatDuCron(),
    lireReglagesGuilde(RG_GUILD_ID),
    statistiquesCommunaute(RG_GUILD_ID),
  ]);

  const manques = manquesParSection(reglages.reglages);
  const sectionsIncompletes = SECTIONS_REGLAGES.filter(section => manques[section].length > 0);
  const commandesTotales = bots.reduce((somme, b) => somme + (b.etat?.nombreCommandes ?? 0), 0);
  const guildesAbsentes = bots.flatMap(b => b.etat?.guildesAbsentes ?? []);

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <AdminPageHeader
        icon={<Bot className="size-5" />}
        title="Bot Discord"
        description="Deux identités, un seul programme. État d'exécution, réglages de communauté et tâches planifiées."
        actions={
          <>
            <Link
              href="/admin/bot/reglages"
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
            >
              <Settings2 className="size-4" aria-hidden />
              Réglages
            </Link>
            <Link
              href="/admin/bot/commandes"
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
            >
              <ListTree className="size-4" aria-hidden />
              Commandes
            </Link>
            <Link
              href="/admin/cron"
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
            >
              <Timer className="size-4" aria-hidden />
              Tâches planifiées
            </Link>
          </>
        }
      />

      {/* ── Les deux profils ─────────────────────────────────────────────── */}
      <section className="grid gap-4 lg:grid-cols-2">
        {bots.map(bot => (
          <Card key={bot.profil.nom} className="overflow-hidden">
            <div className="h-1 w-full" style={{ backgroundColor: bot.profil.couleurHex }} aria-hidden />
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="flex items-center gap-2">
                    {bot.joignable ? (
                      <CheckCircle2 className="size-4 text-succes" aria-hidden />
                    ) : (
                      <XCircle className="size-4 text-destructive" aria-hidden />
                    )}
                    {bot.profil.titre}
                  </CardTitle>
                  <CardDescription className="mt-1">{bot.profil.role}</CardDescription>
                </div>
                <Badge variant={bot.joignable ? "secondary" : "destructive"}>{bot.profil.unite}</Badge>
              </div>
            </CardHeader>
            <CardContent>
              {bot.etat ? (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-muted-foreground">Identité</dt>
                    <dd className="truncate font-medium">{bot.etat.etiquette ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">En ligne depuis</dt>
                    <dd className="font-medium">{duree(bot.etat.uptimeSecondes)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Latence passerelle</dt>
                    <dd className="font-medium">{bot.etat.latenceMs < 0 ? "—" : `${bot.etat.latenceMs} ms`}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Commandes</dt>
                    <dd className="font-medium">{bot.etat.nombreCommandes}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Modules</dt>
                    <dd className="font-medium">{bot.etat.modulesCharges}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Mémoire</dt>
                    <dd className="font-medium">{mega(bot.etat.memoireOctets)}</dd>
                  </div>
                  <div className="col-span-full">
                    <dt className="text-xs text-muted-foreground">Serveurs</dt>
                    <dd className="mt-1 flex flex-wrap gap-1.5">
                      {bot.etat.guildes.length === 0 ? (
                        <span className="text-muted-foreground">aucun</span>
                      ) : (
                        bot.etat.guildes.map(guilde => (
                          <Badge
                            key={guilde.id}
                            variant={guilde.servie ? "default" : "outline"}
                            title={
                              guilde.servie
                                ? "Les commandes de ce profil y sont enregistrées."
                                : "Rejoint, mais hors de la liste des guildes servies."
                            }
                          >
                            {guilde.nom} · {guilde.membres}
                          </Badge>
                        ))
                      )}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground">{bot.erreur}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </section>

      {/*
       * Une guilde configurée mais non rejointe est la panne la plus
       * silencieuse du bot : le service tourne, le journal est propre, et les
       * commandes n'apparaissent nulle part sur ce serveur.
       */}
      {guildesAbsentes.length > 0 && (
        <Card className="border-alerte/40 bg-alerte/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-alerte" aria-hidden />
              Serveur configuré mais non rejoint
            </CardTitle>
            <CardDescription>
              Les commandes n&apos;apparaîtront pas tant que le bot n&apos;y aura pas été autorisé via son URL OAuth2 :{" "}
              {[...new Set(guildesAbsentes)].join(", ")}.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* ── Vie de communauté ────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Vie de communauté</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <DashboardStatsCard
            title="Membres suivis"
            value={stats.profils}
            icon={Users}
            description={`Niveau moyen ${stats.niveauMoyen}`}
            accent="primary"
          />
          <DashboardStatsCard
            title="Expérience cumulée"
            value={stats.xpTotale.toLocaleString("fr-FR")}
            icon={TrendingUp}
            description="Tous les membres du serveur"
            accent="sky"
          />
          <DashboardStatsCard
            title="Jetons Kizuna"
            value={stats.jetonsEnCirculation.toLocaleString("fr-FR")}
            icon={Coins}
            description="En circulation"
            accent="amber"
          />
          <DashboardStatsCard
            title="Tickets ouverts"
            value={stats.ticketsOuverts}
            icon={LifeBuoy}
            description={`${stats.ticketsTotal} depuis l'ouverture`}
            accent="rose"
          />
          <DashboardStatsCard
            title="Suggestions en attente"
            value={stats.suggestionsOuvertes}
            icon={Inbox}
            description="Boîte à suggestions"
            accent="violet"
          />
          <DashboardStatsCard
            title="Menus de rôles"
            value={stats.menusRoles}
            icon={MessageSquare}
            description="Panneaux publiés"
            accent="emerald"
          />
          <DashboardStatsCard
            title="Commandes servies"
            value={commandesTotales}
            icon={ListTree}
            description="Les deux profils réunis"
            href="/admin/bot/commandes"
            accent="primary"
          />
          <DashboardStatsCard
            title="Ordonnanceur"
            value={cron.joignable ? "en ligne" : "arrêté"}
            icon={Activity}
            description={cron.sante ? `Depuis ${duree(Math.round(cron.sante.uptime))}` : "rg-cron.service"}
            href="/admin/cron"
            accent={cron.joignable ? "emerald" : "rose"}
          />
        </div>
      </section>

      {/* ── Ce qu'il reste à configurer ──────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configuration</CardTitle>
          <CardDescription>
            {reglages.parDefaut
              ? "Ce serveur n'a jamais rien réglé : le bot applique ses défauts, et ne publie donc nulle part."
              : reglages.majLe
                ? `Dernière modification ${new Date(reglages.majLe).toLocaleString("fr-FR")}.`
                : "Date de modification non renseignée."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {sectionsIncompletes.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-succes">
              <CheckCircle2 className="size-4" aria-hidden />
              Les six sections sont exploitables.
            </p>
          ) : (
            <ul className="space-y-2">
              {sectionsIncompletes.map(section => (
                <li key={section} className="flex items-start gap-2 text-sm">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-alerte" aria-hidden />
                  <span>
                    <strong>{LIBELLES_SECTIONS[section].titre}</strong> — il manque {manques[section].join(", ")}.
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/admin/bot/reglages"
            className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
          >
            <Settings2 className="size-4" aria-hidden />
            Ouvrir les réglages
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
