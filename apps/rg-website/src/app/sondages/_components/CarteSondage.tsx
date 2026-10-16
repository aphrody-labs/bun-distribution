// Carte d'un sondage dans la liste — composant serveur, aucun JS envoyé.
//
// On garde `Card` de `@rosegriffon/ui` pour la surface (tokens, bordure, thème)
// mais on structure l'intérieur en balises sémantiques : `CardHeader` bascule en
// `flex-row` au-delà de 28rem de carte (requête de conteneur), ce qui mettrait
// les badges, la question et le chapô côte à côte dès la grille deux colonnes.

import { Badge, Card } from "@rosegriffon/ui";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { ArrowRight, CalendarDays, Users } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { ContenuDiscord, TexteDiscordInline } from "@/lib/discord/markdown";
import type { ContexteMentions } from "@/lib/discord/markdown-ast";
import {
  type Sondage,
  classement,
  gagnant,
  libelleChoixAutorises,
  libelleEtat,
  libelleParticipation,
  resumeQuestion,
  varianteBadgeEtat,
} from "@/lib/discord/polls-types";

import { ResultatsSondage } from "./ResultatsSondage";

/** Options montrées sur une carte de liste ; le détail les affiche toutes. */
const OPTIONS_VISIBLES = 5;

export function CarteSondage({ sondage, contexte }: { sondage: Sondage; contexte: ContexteMentions }) {
  const publieLe = new Date(sondage.created_at);
  const participation = libelleParticipation(sondage);
  const resume = resumeQuestion(sondage.question, 70);
  const ordonnees = classement(sondage);
  const enTete = gagnant(sondage);

  return (
    <Card className="flex flex-col gap-0 overflow-hidden rounded-[24px] border-outline-variant/10 bg-surface-container-low p-0 py-0 transition-transform duration-300 hover:-translate-y-1">
      <header className="flex flex-col gap-3 p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={varianteBadgeEtat(sondage)}>{libelleEtat(sondage)}</Badge>
          {sondage.source === "reactions" && <Badge variant="outline">Décompte reconstitué</Badge>}
          {sondage.provider === "discord" && <Badge variant="outline">Sondage Discord</Badge>}
        </div>
        {/* AUCUN `lang` ICI. `discord_polls.language` est la langue d'INTERFACE
				    de l'encart EasyPoll (déduite de ses en-têtes « Choices »/« Choix »),
				    pas celle du texte publié : 48 des 51 questions y valent « en » alors
				    qu'elles sont écrites en français — deux sondages portant la MÊME
				    question française sont même classés l'un « fr », l'autre « en ».
				    Le `<html lang="fr">` du site est correct pour 51/51 ; poser « en »
				    par-dessus faisait lire des questions françaises par une synthèse
				    vocale anglaise. */}
        {/* `TexteDiscordInline` et non `ContenuDiscord` : un titre ne peut
				    contenir que du contenu de phrase, pas les `<p>` du rendu de bloc.
				    Les retours à la ligne de la question sont préservés (`<br>`). */}
        <h2 className="text-fluid-headline-md leading-snug font-semibold break-words text-on-surface">
          <TexteDiscordInline contenu={sondage.question} contexte={contexte} />
        </h2>
        {sondage.chapo && (
          <div className="text-fluid-body-md text-on-surface-variant">
            <ContenuDiscord contenu={sondage.chapo} contexte={contexte} />
          </div>
        )}
      </header>

      {sondage.visuel && (
        <figure className="px-5 pb-4 sm:px-6">
          <Image
            src={sondage.visuel.url}
            /*
             * PAS D'`alt=""` ICI. Sur 15 sondages illustrés, 11 posent une
             * question qui DÉSIGNE l'image (« cette émote (visuel ci-dessus) »,
             * « ce sticker ») : sans elle, la question et ses choix n'ont plus
             * de référent. Aucun de ces visuels ne porte de texte alternatif
             * saisi sur Discord (`visual_alt` vide pour les 15). Faute d'une
             * description écrite par l'autrice, on donne au moins un nom
             * accessible qui rattache l'image à sa question — c'est neutre, et
             * c'est vrai.
             */
            alt={sondage.visuel.alt ?? `Visuel du sondage : ${resumeQuestion(sondage.question, 80)}`}
            width={sondage.visuel.width ?? 1200}
            height={sondage.visuel.height ?? 900}
            sizes="(max-width: 1024px) 100vw, 50vw"
            quality={75}
            className="h-auto w-full rounded-2xl border border-outline-variant/20 object-cover"
          />
          {/* Légende TOUJOURS rendue, comme sur la page de détail : sans elle,
					    une question qui renvoie au « visuel ci-dessus » n'avait, sur la
					    liste, aucune légende ni aucun texte alternatif. */}
          <figcaption className="mt-2 text-sm text-on-surface-variant">
            {sondage.visuel.alt ?? "Visuel publié dans le salon avec ce sondage."}
          </figcaption>
        </figure>
      )}

      <div className="flex-1 px-5 pb-4 sm:px-6">
        {/* Options CLASSÉES avant d'être tronquées, comme sur la page de détail.
				    Sans cela, `limite` coupait les cinq premiers choix DÉCLARÉS : sur 7
				    des 51 sondages, l'option gagnante est au-delà du 5ᵉ rang d'origine
				    et disparaissait de la carte — un visiteur lisait alors le deuxième
				    score comme le maximum du sondage. */}
        <ResultatsSondage
          contexte={contexte}
          limite={OPTIONS_VISIBLES}
          optionEnTete={enTete}
          options={ordonnees}
          sondage={sondage}
        />
      </div>

      <footer className="flex flex-col items-start gap-3 border-t border-outline-variant/20 px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-on-surface-variant">
          {participation && (
            <span className="inline-flex items-center gap-1.5">
              <Users className="size-4 shrink-0" aria-hidden />
              {participation}
            </span>
          )}
          <span>{libelleChoixAutorises(sondage)}</span>
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="size-4 shrink-0" aria-hidden />
            <time dateTime={sondage.created_at}>{format(publieLe, "d MMMM yyyy", { locale: fr })}</time>
          </span>
        </div>
        <Link
          href={`/sondages/${sondage.poll_id}`}
          aria-label={`Voir le détail du sondage : ${resume}`}
          className="inline-flex items-center gap-1.5 rounded-full text-fluid-body-md font-semibold text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden"
        >
          Voir le détail
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </footer>
    </Card>
  );
}
