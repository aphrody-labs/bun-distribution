"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@rosegriffon/ui";
import { CheckCircle2, CircleAlert, Eye, EyeOff, Hash, Play, RefreshCw, Star, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import type { BilanCampagne, CampagneAdmin, CreationAdmin, SalonSuivi } from "@/lib/x-campagnes/admin";

import {
  enregistrerCampagne,
  lancerTache,
  modererCreation,
  rejouerRelais,
  TACHES_CAMPAGNE,
  type ConfigCampagne,
  type TacheCampagne,
} from "./actions";

/*
 * L'écran de pilotage, côté navigateur.
 *
 * Quatre onglets pour les quatre choses qui bougent pendant une campagne :
 * le SUIVI (des chiffres, rien à cliquer), les SALONS Discord, les TÂCHES cron,
 * la CONFIGURATION. La modération vit dans le suivi, au plus près des créations
 * qu'elle concerne.
 *
 * ⚠ AUCUN COMPTEUR N'EST CALCULÉ ICI. Tout vient du serveur, mesuré en base. Un
 * total recalculé côté client diverge le jour où une requête change, et personne
 * ne s'en aperçoit — ce sont précisément les écrans de suivi qu'on ne relit pas.
 */

/** Une date lisible, en heure de Paris (le VPS tourne en UTC). */
function quand(iso: string | null): string {
  if (!iso) return "jamais";
  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Paris",
    year: "numeric",
  });
}

/** Une valeur ISO ramenée au format qu'attend `<input type="datetime-local">`. */
function pourChampDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // `toISOString()` rendrait de l'UTC : le champ afficherait 21:59 pour une
  // clôture annoncée à 23:59 heure de Paris. On compense le décalage local.
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/** Un compteur, sans décor. */
function Chiffre({ valeur, libelle, alerte = false }: { valeur: number | string; libelle: string; alerte?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card px-2.5 py-1.5">
      <p className={`text-base font-bold leading-tight tabular-nums ${alerte ? "text-destructive" : ""}`}>{valeur}</p>
      <p className="text-xs leading-tight text-muted-foreground">{libelle}</p>
    </div>
  );
}

export function GestionCampagne({
  campagne,
  campagnes,
  salons,
  bilan,
  creations,
}: {
  campagne: CampagneAdmin;
  campagnes: Array<{ slug: string; titre: string; principale: boolean; publiee: boolean }>;
  salons: SalonSuivi[];
  bilan: BilanCampagne;
  creations: CreationAdmin[];
}) {
  const router = useRouter();
  const [enCours, demarrer] = useTransition();

  const [config, setConfig] = useState<ConfigCampagne>({
    actif: campagne.actif,
    debutLe: pourChampDate(campagne.debutLe),
    description: campagne.description ?? "",
    finLe: pourChampDate(campagne.finLe),
    hashtags: campagne.hashtags.join("\n"),
    hashtagsAffichage: campagne.hashtagsAffichage.join("\n"),
    hashtagsRattrapage: campagne.hashtagsRattrapage.join("\n"),
    imageAffiche: campagne.imageAffiche ?? "",
    imageCouverture: campagne.imageCouverture ?? "",
    imageReglement: campagne.imageReglement ?? "",
    noteAffiche: campagne.noteAffiche ?? "",
    publiee: campagne.publiee,
    reglement: campagne.reglement.join("\n"),
    relaisDepuis: pourChampDate(campagne.relaisDepuis),
    relaisSalon: campagne.relaisSalon ?? "",
    salonDepot: campagne.salonsDepot[0] ?? "",
    slug: campagne.slug,
    surTitre: campagne.surTitre ?? "",
    titre: campagne.titre,
  });

  const champ = (cle: keyof ConfigCampagne) => (valeur: string) =>
    setConfig(precedent => ({ ...precedent, [cle]: valeur }));

  /** Enveloppe commune : une action, un toast, un rafraîchissement serveur. */
  const agir = (
    action: () => Promise<{ success: boolean; error?: string; message?: string }>,
    succesParDefaut: string,
  ) =>
    demarrer(async () => {
      const r = await action();
      if (r.success) {
        toast.success(r.message ?? succesParDefaut);
        router.refresh();
      } else {
        toast.error(r.error ?? "Échec");
      }
    });

  return (
    <Tabs defaultValue="suivi" className="space-y-6">
      <TabsList className="grid w-full grid-cols-2 lg:w-fit lg:grid-cols-4">
        <TabsTrigger value="suivi">Suivi</TabsTrigger>
        <TabsTrigger value="salons">Salons</TabsTrigger>
        <TabsTrigger value="taches">Tâches</TabsTrigger>
        <TabsTrigger value="config">Configuration</TabsTrigger>
      </TabsList>

      {/* ── SUIVI ─────────────────────────────────────────────────────── */}
      <TabsContent value="suivi" className="space-y-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <Chiffre valeur={bilan.postsX} libelle="publications X" />
          <Chiffre valeur={bilan.creationsDiscord} libelle="créations Discord" />
          <Chiffre valeur={bilan.misEnAvant} libelle="mises en avant" />
          <Chiffre valeur={bilan.relayes} libelle="relayées" />
          {/* Le seul compteur qui doit sauter aux yeux : des créations en base
					    que le salon de suivi n'a pas encore vues. */}
          <Chiffre valeur={bilan.relaisEnAttente} libelle="en attente de relais" alerte={bilan.relaisEnAttente > 0} />
          <Chiffre
            valeur={bilan.postsXMasques + bilan.creationsDiscordMasquees}
            libelle="masquées"
            alerte={bilan.postsXMasques + bilan.creationsDiscordMasquees > 0}
          />
          <Chiffre valeur={bilan.relaisSautes} libelle="relais sautés" />
        </div>

        <div className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
          <p>
            Dernière récolte&nbsp;: <strong>{quand(bilan.collecteLe)}</strong>
          </p>
          <p>
            Dernier relais&nbsp;: <strong>{quand(bilan.dernierRelaisLe)}</strong>
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Créations récentes</CardTitle>
            <CardDescription className="text-xs">Les 40 dernières, masquées comprises.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {creations.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Aucune création à ce jour.</p>
            ) : (
              creations.map(creation => (
                <div
                  key={`${creation.source}-${creation.reference}`}
                  className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-start"
                >
                  {creation.image && (
                    // eslint-disable-next-line @next/next/no-img-element -- vignette
                    // d'exploitation : la source est déjà une URL de notre Storage ou de
                    // X, et passer par l'optimiseur pour un écran d'admin consommerait
                    // le quota d'optimisation d'images sans bénéfice.
                    <img src={creation.image} alt="" className="size-20 shrink-0 rounded-md object-cover" />
                  )}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{creation.source === "x" ? "X" : "Discord"}</Badge>
                      <span className="text-sm font-semibold">{creation.auteur}</span>
                      {creation.hashtag && <span className="text-xs text-muted-foreground">#{creation.hashtag}</span>}
                      <span className="text-xs text-muted-foreground">{quand(creation.publieLe)}</span>
                      {creation.masque && <Badge variant="destructive">Masquée</Badge>}
                      {creation.misEnAvant && <Badge>À la une</Badge>}
                      {creation.relaisMessageId ? (
                        <Badge variant="secondary">Relayée</Badge>
                      ) : creation.relaisSauteMotif ? (
                        <Badge variant="outline">Sautée</Badge>
                      ) : (
                        <Badge variant="outline">En attente</Badge>
                      )}
                    </div>
                    <p className="line-clamp-2 text-sm text-muted-foreground">{creation.texte || "(sans texte)"}</p>
                    {creation.motifMasquage && (
                      <p className="text-xs text-destructive">Motif : {creation.motifMasquage}</p>
                    )}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button asChild size="sm" variant="link" className="h-7 px-0">
                        <a href={creation.lien} target="_blank" rel="noopener noreferrer">
                          Ouvrir l&apos;original
                        </a>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={enCours}
                        onClick={() =>
                          agir(
                            () =>
                              modererCreation({
                                masque: !creation.masque,
                                motif: creation.masque ? undefined : "Retirée depuis l'écran d'administration",
                                reference: creation.reference,
                                slug: campagne.slug,
                                source: creation.source,
                              }),
                            creation.masque ? "Création démasquée." : "Création masquée.",
                          )
                        }
                      >
                        {creation.masque ? <Eye className="mr-1 size-3.5" /> : <EyeOff className="mr-1 size-3.5" />}
                        {creation.masque ? "Démasquer" : "Masquer"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={enCours}
                        onClick={() =>
                          agir(
                            () =>
                              modererCreation({
                                misEnAvant: !creation.misEnAvant,
                                reference: creation.reference,
                                slug: campagne.slug,
                                source: creation.source,
                              }),
                            creation.misEnAvant ? "Retirée de la une." : "Mise à la une.",
                          )
                        }
                      >
                        <Star className="mr-1 size-3.5" />
                        {creation.misEnAvant ? "Retirer de la une" : "Mettre à la une"}
                      </Button>
                      {(creation.relaisMessageId || creation.relaisSauteMotif) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={enCours}
                          onClick={() =>
                            agir(
                              () => rejouerRelais(campagne.slug, creation.source, creation.reference),
                              "Relais oublié.",
                            )
                          }
                        >
                          <RefreshCw className="mr-1 size-3.5" />
                          Rejouer le relais
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* ── SALONS ────────────────────────────────────────────────────── */}
      <TabsContent value="salons" className="space-y-4">
        {salons.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-sm text-muted-foreground">
              Aucun salon déclaré. Renseignez le salon de dépôt et le salon de suivi dans l&apos;onglet Configuration.
            </CardContent>
          </Card>
        ) : (
          salons.map(salon => {
            // Le MÊME `suivi: false` est une panne côté dépôt et l'état normal
            // côté relais : le bot écrit dans le salon de suivi, il n'y lit pas.
            const depot = salon.role === "depot";
            const enPanne = depot && !salon.suivi;
            return (
              <Card key={salon.salonId}>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                    {enPanne ? (
                      <XCircle className="size-4 text-destructive" />
                    ) : (
                      <CheckCircle2 className="size-4 text-primary" />
                    )}
                    {salon.nom ?? `Salon ${salon.salonId}`}
                    <Badge variant={depot ? "default" : "secondary"}>{depot ? "Dépôt public" : "Suivi du staff"}</Badge>
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {depot
                      ? "Les membres y déposent ; la veille archive, la récolte rattache."
                      : "Le bot y dépose les relais. Pas besoin de veille."}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Chiffre valeur={salon.messages} libelle="messages archivés" />
                    <Chiffre valeur={salon.creations} libelle="créations rattachées" />
                    <Chiffre valeur={salon.suivi ? "oui" : "non"} libelle="sous veille" alerte={enPanne} />
                    <Chiffre valeur={salon.backfillComplet ? "oui" : "en cours"} libelle="historique remonté" />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Dernier message&nbsp;: {quand(salon.dernierMessageLe)} · identifiant{" "}
                    <code className="rounded bg-muted px-1 py-0.5">{salon.salonId}</code>
                  </p>
                  {enPanne && (
                    <p className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
                      <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
                      <span>
                        Ce salon de dépôt n&apos;est <strong>pas sous veille</strong> : la récolte lit{" "}
                        <code>discord_messages</code>, pas Discord, donc aucune création n&apos;en remontera jamais.
                        Lancez «&nbsp;discord:archives&nbsp;» dans l&apos;onglet Tâches — ou vérifiez que le bot a bien
                        accès au salon.
                      </span>
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </TabsContent>

      {/* ── TÂCHES ────────────────────────────────────────────────────── */}
      <TabsContent value="taches" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Tâches cron de la campagne</CardTitle>
            <CardDescription className="text-xs">
              Le daemon travaille en tâche de fond&nbsp;: un lancement confirme le démarrage, pas le résultat.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(Object.entries(TACHES_CAMPAGNE) as Array<[TacheCampagne, string]>).map(([nom, quoi]) => (
              <div
                key={nom}
                className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-mono text-sm font-semibold">{nom}</p>
                  <p className="text-xs text-muted-foreground">{quoi}</p>
                </div>
                <Button
                  size="sm"
                  disabled={enCours}
                  onClick={() => agir(() => lancerTache(nom), `« ${nom} » démarrée.`)}
                >
                  <Play className="mr-1 size-3.5" />
                  Lancer
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </TabsContent>

      {/* ── CONFIGURATION ─────────────────────────────────────────────── */}
      <TabsContent value="config" className="space-y-4">
        {campagnes.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {campagnes.map(autre => (
              <Button key={autre.slug} asChild size="sm" variant={autre.slug === campagne.slug ? "default" : "outline"}>
                <a href={`/admin/iergday?campagne=${autre.slug}`}>
                  {autre.titre}
                  {!autre.publiee && " (brouillon)"}
                </a>
              </Button>
            ))}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Identité et visuels</CardTitle>
            <CardDescription className="text-xs">
              Tout ce qu&apos;affiche la page publique vient d&apos;ici.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="titre">Titre</Label>
              <Input id="titre" value={config.titre} onChange={e => champ("titre")(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="surTitre">Sur-titre</Label>
              <Input id="surTitre" value={config.surTitre} onChange={e => champ("surTitre")(e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                rows={3}
                value={config.description}
                onChange={e => champ("description")(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="imageAffiche">Affiche (URL)</Label>
              <Input
                id="imageAffiche"
                value={config.imageAffiche}
                onChange={e => champ("imageAffiche")(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="imageReglement">Carte des règles (URL)</Label>
              <Input
                id="imageReglement"
                value={config.imageReglement}
                onChange={e => champ("imageReglement")(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="imageCouverture">Bannière (URL)</Label>
              <Input
                id="imageCouverture"
                value={config.imageCouverture}
                onChange={e => champ("imageCouverture")(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="noteAffiche">Rectification sous l&apos;affiche</Label>
              <Input
                id="noteAffiche"
                placeholder="Vide = aucune rectification"
                value={config.noteAffiche}
                onChange={e => champ("noteAffiche")(e.target.value)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="reglement">Règlement — une règle par ligne</Label>
              <Textarea
                id="reglement"
                rows={5}
                value={config.reglement}
                onChange={e => champ("reglement")(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Hashtags</CardTitle>
            <CardDescription className="text-xs">
              Minuscules, sans croisillon. L&apos;affichage ne change que la casse. Les variantes sont récoltées sans
              jamais être montrées&nbsp;; les fautes de frappe ordinaires sont rattrapées toutes seules.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="hashtags">Hashtags</Label>
              <Textarea
                id="hashtags"
                rows={4}
                value={config.hashtags}
                onChange={e => champ("hashtags")(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hashtagsAffichage">Casse d&apos;affichage</Label>
              <Textarea
                id="hashtagsAffichage"
                rows={4}
                value={config.hashtagsAffichage}
                onChange={e => champ("hashtagsAffichage")(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hashtagsRattrapage">Variantes silencieuses</Label>
              <Textarea
                id="hashtagsRattrapage"
                rows={4}
                value={config.hashtagsRattrapage}
                onChange={e => champ("hashtagsRattrapage")(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Salons, dates et diffusion</CardTitle>
            <CardDescription className="text-xs">
              Dépôt = public, suivi = staff. Jamais le même identifiant dans les deux.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="salonDepot">Salon de dépôt (public)</Label>
              <Input id="salonDepot" value={config.salonDepot} onChange={e => champ("salonDepot")(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="relaisSalon">Salon de suivi (staff)</Label>
              <Input id="relaisSalon" value={config.relaisSalon} onChange={e => champ("relaisSalon")(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="debutLe">Ouverture</Label>
              <Input
                id="debutLe"
                type="datetime-local"
                value={config.debutLe}
                onChange={e => champ("debutLe")(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="finLe">Clôture</Label>
              <Input
                id="finLe"
                type="datetime-local"
                value={config.finLe}
                onChange={e => champ("finLe")(e.target.value)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="relaisDepuis">Relayer les créations à partir de</Label>
              <Input
                id="relaisDepuis"
                type="datetime-local"
                value={config.relaisDepuis}
                onChange={e => champ("relaisDepuis")(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Garde anti-déluge. Reculer cette date fait repartir les créations antérieures.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="publiee"
                checked={config.publiee}
                onCheckedChange={v => setConfig(p => ({ ...p, publiee: v }))}
              />
              <Label htmlFor="publiee">Visible du public</Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch id="actif" checked={config.actif} onCheckedChange={v => setConfig(p => ({ ...p, actif: v }))} />
              <Label htmlFor="actif">Récolte active</Label>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center gap-3">
          <Button disabled={enCours} onClick={() => agir(() => enregistrerCampagne(config), "Campagne enregistrée.")}>
            <Hash className="mr-1 size-4" />
            Enregistrer
          </Button>
          <p className="text-xs text-muted-foreground">Dernière modification&nbsp;: {quand(campagne.updatedAt)}</p>
        </div>
      </TabsContent>
    </Tabs>
  );
}
