import Link from "next/link";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@rosegriffon/ui";
import { UserPlus, Users, Trophy, Megaphone, Palette, ExternalLink, ShieldCheck, Scale } from "lucide-react";
import { FaDiscord, FaXTwitter, FaYoutube, FaTwitch } from "react-icons/fa6";
import { metadonneesAchillea } from "@/app/achillea/metadonnees";

export const metadata = metadonneesAchillea({
  // Le suffixe « — Achilléa » était recopié dans chaque titre ALORS QUE le
  // `title.template` du layout ajoute déjà « | Achilléa — Rose Griffon » :
  // l'onglet affichait la marque deux fois.
  titre: "Guide compétitif",
  description: "Règles officielles, création de clan, format des tournois et commandes Discord d'Achilléa.",
  chemin: "/achillea/guide",
});

export default function AchilleaGuidePage() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      <div className="space-y-2 border-b border-border/60 pb-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight">Guide Compétitif</h1>
            <p className="text-muted-foreground mt-1">
              Fonctionnement d&apos;Achilléa, création de clans, règles officielles et commandes Discord.
            </p>
          </div>
          <Link
            href="/achillea/guide/brand"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/80 bg-muted/40 hover:bg-muted text-xs font-semibold transition"
          >
            <Palette className="size-4 text-primary" />
            Brand Kit & Palette
          </Link>
        </div>
      </div>

      {/* Créer son compte */}
      <Card className="border-border/60">
        <CardHeader className="p-6 pb-2">
          <CardTitle className="text-xl flex items-center gap-2.5">
            <UserPlus className="size-5 text-primary" />
            Créer son compte compétiteur
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 pt-2 space-y-3 text-sm">
          <ol className="list-decimal list-inside space-y-2 leading-relaxed">
            <li>
              Rejoins le{" "}
              <a
                href="https://discord.gg/achillea"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline font-semibold"
              >
                Discord officiel Achilléa
              </a>
              .
            </li>
            <li>
              Connecte-toi via Discord sur le site : ton profil est généré instantanément avec ton avatar et ton pseudo.
            </li>
            <li>
              Tu peux ensuite associer ta chaîne Twitch, renseigner ta biographie et suivre tes statistiques en temps
              réel.
            </li>
          </ol>
        </CardContent>
      </Card>

      {/* Les Clans */}
      <Card className="border-border/60">
        <CardHeader className="p-6 pb-2">
          <CardTitle className="text-xl flex items-center gap-2.5">
            <Users className="size-5 text-primary" />
            Les Clans
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 pt-2 space-y-5 text-sm">
          <div>
            <h3 className="font-semibold text-foreground mb-2">Rejoindre un Clan</h3>
            <ol className="list-decimal list-inside space-y-1.5 text-muted-foreground">
              <li>
                Consulte la{" "}
                <Link href="/achillea/clans" className="text-primary hover:underline font-medium">
                  liste des clans
                </Link>{" "}
                pour trouver ceux qui recrutent.
              </li>
              <li>
                Postule directement via le site ou avec la commande Discord{" "}
                <code className="px-1.5 py-0.5 rounded bg-muted font-mono text-xs text-primary">
                  /clan apply &lt;sigle&gt;
                </code>
                .
              </li>
              <li>
                Le staff du clan examine ta candidature. Si l&apos;approbation automatique est activée,
                l&apos;intégration est immédiate.
              </li>
            </ol>
          </div>

          <div>
            <h3 className="font-semibold text-foreground mb-2">Fonder un Clan</h3>
            <ul className="list-disc list-inside space-y-1.5 text-muted-foreground">
              <li>Nécessite 4 membres fondateurs réunis.</li>
              <li>Nom (3-30 caractères) et sigle (2-3 lettres) uniques.</li>
              <li>Logo officiel PNG/JPG et au moins un réseau social officiel (X, Instagram ou TikTok).</li>
              <li>Vote d&apos;approbation des 4 fondateurs requis sous 24 heures.</li>
            </ul>
          </div>

          <div className="pt-2 border-t border-border/40 space-y-2">
            <h3 className="font-semibold text-foreground">Hiérarchie & Quotas</h3>
            <div className="flex flex-wrap gap-2 py-1">
              <Badge variant="outline" className="border-border text-muted-foreground">
                À l&apos;essai
              </Badge>
              <Badge variant="outline" className="border-sky-500/30 text-sky-400 bg-sky-500/10">
                Membre
              </Badge>
              <Badge variant="outline" className="border-amber-500/30 text-amber-400 bg-amber-500/10">
                Vice-Président
              </Badge>
              <Badge variant="outline" className="border-rose-500/30 text-rose-400 bg-rose-500/10">
                Président
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Maximum 30 joueurs et 7 membres de staff par clan. En dessous de 5 membres, un délai de 24h est accordé
              pour recruter avant dissolution automatique.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Commandes Discord */}
      <Card className="border-border/60">
        <CardHeader className="p-6 pb-2">
          <CardTitle className="text-xl flex items-center gap-2.5">
            <FaDiscord className="size-5 text-[#5865F2]" />
            Commandes Bot Discord
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 pt-2">
          <Accordion type="multiple" className="w-full">
            <AccordionItem value="clans">
              <AccordionTrigger className="text-sm font-semibold hover:no-underline">Commandes Clan</AccordionTrigger>
              <AccordionContent className="space-y-3 pt-2 text-xs">
                <div className="p-3 rounded-lg bg-muted/40 space-y-1">
                  <div className="font-mono font-bold text-primary">/create-clan @m1 @m2 @m3 @m4</div>
                  <div className="text-muted-foreground">Fonder un clan avec 4 membres fondateurs.</div>
                </div>
                <div className="p-3 rounded-lg bg-muted/40 space-y-1">
                  <div className="font-mono font-bold text-primary">/clan infos [sigle]</div>
                  <div className="text-muted-foreground">
                    Afficher la fiche d&apos;un clan ou lister tous les clans.
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-muted/40 space-y-1">
                  <div className="font-mono font-bold text-primary">/clan apply &lt;sigle&gt;</div>
                  <div className="text-muted-foreground">Déposer une candidature dans un clan.</div>
                </div>
                <div className="p-3 rounded-lg bg-muted/40 space-y-1">
                  <div className="font-mono font-bold text-primary">/clan invite-member @joueur</div>
                  <div className="text-muted-foreground">Inviter un joueur à rejoindre le clan (VP ou Président).</div>
                </div>
                <div className="p-3 rounded-lg bg-muted/40 space-y-1">
                  <div className="font-mono font-bold text-primary">/clan manage</div>
                  <div className="text-muted-foreground">Gérer les membres, paramètres et candidatures.</div>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="tournois">
              <AccordionTrigger className="text-sm font-semibold hover:no-underline">
                Commandes Joueurs & Matchs
              </AccordionTrigger>
              <AccordionContent className="space-y-3 pt-2 text-xs">
                <div className="p-3 rounded-lg bg-muted/40 space-y-1">
                  <div className="font-mono font-bold text-primary">/player infos [@joueur]</div>
                  <div className="text-muted-foreground">
                    Afficher les statistiques ELO et circuit d&apos;un joueur.
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-muted/40 space-y-1">
                  <div className="font-mono font-bold text-primary">/player settings</div>
                  <div className="text-muted-foreground">Lier Twitch, mettre à jour sa bio ou son pseudo en jeu.</div>
                </div>
                <div className="p-3 rounded-lg bg-muted/40 space-y-1">
                  <div className="font-mono font-bold text-primary">/interclan request &lt;sigle&gt; &lt;date&gt;</div>
                  <div className="text-muted-foreground">Défier un clan adverse en rencontre officielle 5v5.</div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>

      {/* Règles des Tournois */}
      <Card className="border-border/60">
        <CardHeader className="p-6 pb-2">
          <CardTitle className="text-xl flex items-center gap-2.5">
            <Trophy className="size-5 text-amber-500" />
            Règles Officielles des Tournois
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 pt-2 space-y-6 text-sm">
          <div className="space-y-2">
            <div className="font-semibold flex items-center gap-2">
              <ShieldCheck className="size-4 text-emerald-400" />
              Éthique & Fair-play
            </div>
            <p className="text-muted-foreground text-xs leading-relaxed">
              Tout usage de logiciels tiers, modification de sauvegarde (save editor) ou exploitation volontaire de bugs
              entraîne la disqualification immédiate. Les organisateurs peuvent exiger un partage d&apos;écran en cas de
              doute raisonnable.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border border-border/60 bg-muted/20 space-y-1">
              <div className="font-bold">Phase Suisse (Swiss Stage)</div>
              <p className="text-xs text-muted-foreground">
                Matchs en <strong>BO3</strong>. En cas d&apos;égalité parfaite, 4e match décisif au but en or.
              </p>
            </div>

            <div className="p-4 rounded-xl border border-border/60 bg-muted/20 space-y-1">
              <div className="font-bold">Playoffs & Arbre Final</div>
              <p className="text-xs text-muted-foreground">
                Arbre éliminatoire en <strong>BO5</strong>. Matchs décisifs au but en or en cas d&apos;égalité après la
                5e manche.
              </p>
            </div>
          </div>

          {/* Restrictions & Bannissements */}
          <div className="space-y-3 pt-2">
            <div className="font-semibold flex items-center gap-2">
              <Scale className="size-4 text-rose-400" />
              Restrictions d&apos;Équipe & Tactiques Bannies
            </div>
            <ul className="list-disc list-inside space-y-1 text-xs text-muted-foreground">
              <li>Doublons stricts interdits : aucune version dupliquée d&apos;un même personnage.</li>
              <li>Stades modifiant le gameplay ou la friction du terrain interdits.</li>
            </ul>

            <div className="pt-2 space-y-2">
              <div className="text-xs font-semibold text-foreground">Tactiques dropables bannies :</div>
              <div className="flex flex-wrap gap-1.5">
                {[
                  "Tir Direct Ultime",
                  "Supériorité Durable",
                  "Super Barrière",
                  "Mur Infranchissable",
                  "Explosion",
                  "Bonne Étoile",
                ].map(t => (
                  <Badge
                    key={t}
                    variant="outline"
                    className="border-rose-500/30 text-rose-400 bg-rose-500/10 text-[11px]"
                  >
                    {t}
                  </Badge>
                ))}
              </div>
            </div>

            <div className="pt-2 space-y-2">
              <div className="text-xs font-semibold text-foreground">
                Tactiques d&apos;immobilisation et mouvement bannies :
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[
                  "Ailes Jumelles",
                  "Typhons Jumeaux",
                  "Attaque Cyclique",
                  "Enfermement du joueur clé",
                  "Formation Carapace",
                  "Impulsion Circulaire",
                  "Blocage Spectral",
                ].map(t => (
                  <Badge
                    key={t}
                    variant="outline"
                    className="border-amber-500/30 text-amber-400 bg-amber-500/10 text-[11px]"
                  >
                    {t}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Réseaux officiels */}
      <Card className="border-border/60">
        <CardHeader className="p-6 pb-2">
          <CardTitle className="text-xl flex items-center gap-2.5">
            <Megaphone className="size-5 text-sky-400" />
            Réseaux Officiels Achilléa
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 pt-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <a
              href="https://discord.gg/achillea"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between p-3 rounded-lg border border-border/60 hover:bg-muted/40 transition"
            >
              <div className="flex items-center gap-2.5">
                <FaDiscord className="size-4 text-[#5865F2]" />
                <span className="font-semibold">Discord</span>
              </div>
              <ExternalLink className="size-3.5 text-muted-foreground" />
            </a>

            <a
              href="https://x.com/Achillea_IE"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between p-3 rounded-lg border border-border/60 hover:bg-muted/40 transition"
            >
              <div className="flex items-center gap-2.5">
                <FaXTwitter className="size-4 text-foreground" />
                <span className="font-semibold">X / Twitter</span>
              </div>
              <ExternalLink className="size-3.5 text-muted-foreground" />
            </a>

            <a
              href="https://twitch.tv/Achillea_IE"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between p-3 rounded-lg border border-border/60 hover:bg-muted/40 transition"
            >
              <div className="flex items-center gap-2.5">
                <FaTwitch className="size-4 text-purple-400" />
                <span className="font-semibold">Twitch</span>
              </div>
              <ExternalLink className="size-3.5 text-muted-foreground" />
            </a>

            <a
              href="https://youtube.com/@AchilleaRG"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between p-3 rounded-lg border border-border/60 hover:bg-muted/40 transition"
            >
              <div className="flex items-center gap-2.5">
                <FaYoutube className="size-4 text-red-500" />
                <span className="font-semibold">YouTube</span>
              </div>
              <ExternalLink className="size-3.5 text-muted-foreground" />
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
