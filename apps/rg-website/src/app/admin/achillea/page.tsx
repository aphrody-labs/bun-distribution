import Link from "next/link";
import {
  Trophy,
  ShieldAlert,
  Swords,
  ShieldCheck,
  ArrowUpRight,
  ExternalLink,
  Database,
  Layers,
  Radio,
} from "lucide-react";
import { AdminPageHeader, Card, CardHeader, CardTitle, CardContent, Badge, Button } from "@rosegriffon/ui";
import { recouperComptes, schemaAchilleaPresent, volumesAchillea } from "@/lib/achillea/admin-db";

export const dynamic = "force-dynamic";

export default async function AdminAchilleaPage() {
  const donneesPresentes = await schemaAchilleaPresent();

  let comptes = null;
  let volumes = null;

  if (donneesPresentes) {
    try {
      [comptes, volumes] = await Promise.all([recouperComptes(), volumesAchillea()]);
    } catch {
      // Lecture impossible : la page reste affichable, sans les compteurs.
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <AdminPageHeader
        icon={<Trophy className="size-5 text-amber-400" />}
        title="Achilléa Esport & rapprochement des comptes"
        description="Supervision de la ligue esport et recoupement des comptes Rose Griffon et Achilléa."
        actions={
          <Button asChild size="sm">
            <Link href="/achillea/admins/dashboard" className="inline-flex items-center gap-1.5">
              Ouvrir le Backoffice Achilléa
              <ExternalLink className="size-3.5" />
            </Link>
          </Button>
        }
      />

      {/* Statut du schéma fusionné */}
      <div className="rounded-2xl border border-border/80 bg-card p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className={`p-2.5 rounded-xl border ${
                donneesPresentes
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : "bg-rose-500/10 text-rose-400 border-rose-500/20"
              }`}
            >
              <Database className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-lg">Schéma achillea</h3>
                <Badge variant={donneesPresentes ? "default" : "destructive"}>
                  {donneesPresentes ? "Fusionné dans rg" : "Absent"}
                </Badge>
              </div>
              <p className="text-lg text-muted-foreground mt-0.5">
                {donneesPresentes
                  ? "Les tables d'Achilléa vivent dans la base rg : une seule base, une seule sauvegarde, des jointures directes avec les profils."
                  : "Le schéma achillea n'est pas présent. Lancez bun scripts/ops/achillea-merge.ts --copy pour le provisionner."}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Données de rapprochement des comptes */}
      {comptes && (
        <div className="space-y-3">
          <h3 className="text-lg font-bold uppercase tracking-wider text-muted-foreground">
            Rapprochement des comptes (par Discord ID)
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="border-border/60 bg-card/60">
              <CardContent className="p-5 space-y-1">
                <div className="text-lg text-muted-foreground">Profils Rose Griffon</div>
                <div className="text-2xl font-black font-mono">{comptes.profilsRg.toLocaleString("fr-FR")}</div>
                <div className="text-lg text-muted-foreground">Base locale RG</div>
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/60">
              <CardContent className="p-5 space-y-1">
                <div className="text-lg text-muted-foreground">Joueurs Achilléa</div>
                <div className="text-2xl font-black font-mono text-amber-400">
                  {comptes.joueursAchillea.toLocaleString("fr-FR")}
                </div>
                <div className="text-lg text-muted-foreground">Base esport Achilléa</div>
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/60">
              <CardContent className="p-5 space-y-1">
                <div className="text-lg text-muted-foreground">Comptes Communs</div>
                <div className="text-2xl font-black font-mono text-emerald-400">
                  {comptes.communs.toLocaleString("fr-FR")}
                </div>
                <div className="text-lg text-muted-foreground">
                  Discord ID apparié (
                  {comptes.profilsRg > 0 ? Math.round((comptes.communs / comptes.profilsRg) * 100) : 0}% de RG)
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/60">
              <CardContent className="p-5 space-y-1">
                <div className="text-lg text-muted-foreground">Joueurs Achilléa Seuls</div>
                <div className="text-2xl font-black font-mono text-cyan-400">
                  {comptes.achilleaSeuls.toLocaleString("fr-FR")}
                </div>
                <div className="text-lg text-muted-foreground">Cibles d'onboarding RG</div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Volumes d'activités Achilléa */}
      {volumes && (
        <div className="space-y-3">
          <h3 className="text-lg font-bold uppercase tracking-wider text-muted-foreground">
            Volumes & Activité Esportive
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <Card className="border-border/60 bg-card/60">
              <CardContent className="p-4 space-y-1">
                <div className="text-lg text-muted-foreground">Clans enregistrés</div>
                <div className="text-xl font-bold font-mono">{volumes.clans}</div>
                <div className="text-lg text-muted-foreground">Équipes de compétition</div>
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/60">
              <CardContent className="p-4 space-y-1">
                <div className="text-lg text-muted-foreground">Tournois disputés</div>
                <div className="text-xl font-bold font-mono">{volumes.tournois}</div>
                <div className="text-lg text-muted-foreground">Coupes et championnats</div>
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/60">
              <CardContent className="p-4 space-y-1">
                <div className="text-lg text-muted-foreground">Licences actives</div>
                <div className="text-xl font-bold font-mono text-emerald-400">{volumes.licencesActives}</div>
                <div className="text-lg text-muted-foreground">Joueurs officiels certifiés</div>
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/60">
              <CardContent className="p-4 space-y-1">
                <div className="text-lg text-muted-foreground">Sanctions actives</div>
                <div
                  className={`text-xl font-bold font-mono ${
                    volumes.sanctionsOuvertes > 0 ? "text-rose-400" : "text-muted-foreground"
                  }`}
                >
                  {volumes.sanctionsOuvertes}
                </div>
                <div className="text-lg text-muted-foreground">Mesures de discipline</div>
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/60">
              <CardContent className="p-4 space-y-1">
                <div className="text-lg text-muted-foreground">Matchs classés</div>
                <div className="text-xl font-bold font-mono text-amber-400">
                  {volumes.matchsClasses.toLocaleString("fr-FR")}
                </div>
                <div className="text-lg text-muted-foreground">Rencontres ELO / AP</div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Raccourcis vers les modules du Backoffice Achilléa */}
      <div className="space-y-3">
        <h3 className="text-lg font-bold uppercase tracking-wider text-muted-foreground">
          Modules d'Administration Achilléa
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="border-border/60 bg-card hover:border-border transition">
            <CardHeader className="p-5 pb-2">
              <CardTitle className="text-lg font-bold flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Trophy className="size-4 text-amber-400" />
                  Tableau de bord Esport
                </span>
                <ArrowUpRight className="size-4 text-muted-foreground" />
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 pt-2 text-lg text-muted-foreground space-y-3">
              <p>Supervision des saisons, télémétrie bot, serveurs surveillés et état opérationnel.</p>
              <Button asChild variant="outline" size="sm" className="w-full text-lg">
                <Link href="/achillea/admins/dashboard">Accéder au dashboard</Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card hover:border-border transition">
            <CardHeader className="p-5 pb-2">
              <CardTitle className="text-lg font-bold flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Swords className="size-4 text-rose-400" />
                  Litiges & Arbitrage Ranked
                </span>
                <ArrowUpRight className="size-4 text-muted-foreground" />
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 pt-2 text-lg text-muted-foreground space-y-3">
              <p>Tranchage des contestations de scores, annulation de matchs et réajustement des AP.</p>
              <Button asChild variant="outline" size="sm" className="w-full text-lg">
                <Link href="/achillea/admins/ranked-disputes">Gérer les litiges</Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card hover:border-border transition">
            <CardHeader className="p-5 pb-2">
              <CardTitle className="text-lg font-bold flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <ShieldAlert className="size-4 text-amber-500" />
                  Sanctions & Modération
                </span>
                <ArrowUpRight className="size-4 text-muted-foreground" />
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 pt-2 text-lg text-muted-foreground space-y-3">
              <p>Application d'avertissements, exclusions temporaires et bannissements du circuit.</p>
              <Button asChild variant="outline" size="sm" className="w-full text-lg">
                <Link href="/achillea/admins/sanctions">Voir les sanctions</Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card hover:border-border transition">
            <CardHeader className="p-5 pb-2">
              <CardTitle className="text-lg font-bold flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <ShieldCheck className="size-4 text-primary" />
                  Validation Organisations
                </span>
                <ArrowUpRight className="size-4 text-muted-foreground" />
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 pt-2 text-lg text-muted-foreground space-y-3">
              <p>Examen et approbation des structures candidates pour l'organisation de tournois.</p>
              <Button asChild variant="outline" size="sm" className="w-full text-lg">
                <Link href="/achillea/organizations/validate">Valider les orgs</Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card hover:border-border transition">
            <CardHeader className="p-5 pb-2">
              <CardTitle className="text-lg font-bold flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Radio className="size-4 text-purple-400" />
                  Casting & Disponibilités
                </span>
                <ArrowUpRight className="size-4 text-muted-foreground" />
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 pt-2 text-lg text-muted-foreground space-y-3">
              <p>Supervision des casters, gestion des disponibilités et plannings de stream.</p>
              <Button asChild variant="outline" size="sm" className="w-full text-lg">
                <Link href="/achillea/casts">Gestion des casts</Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card hover:border-border transition">
            <CardHeader className="p-5 pb-2">
              <CardTitle className="text-lg font-bold flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Layers className="size-4 text-cyan-400" />
                  Ligue Astrale & Championnat
                </span>
                <ArrowUpRight className="size-4 text-muted-foreground" />
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 pt-2 text-lg text-muted-foreground space-y-3">
              <p>Calendrier des journées, classements et résultats de la ligue par points.</p>
              <Button asChild variant="outline" size="sm" className="w-full text-lg">
                <Link href="/achillea/leagues/astral">Consulter la ligue</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
