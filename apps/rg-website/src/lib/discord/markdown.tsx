// Moteur de rendu du markdown Discord — arbre typé → éléments React.
//
// Aucune chaîne n'est injectée en HTML : `dangerouslySetInnerHTML` n'apparaît
// nulle part et ne doit jamais apparaître ici. L'analyse (et la validation des
// URL) est faite par `markdown-ast.ts` ; ce module ne fait que peindre.

import { format, formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import Image from "next/image";

import {
  type Bloc,
  CONTEXTE_MENTIONS_VIDE,
  type ContexteMentions,
  type NoeudInline,
  type StyleHorodatage,
  parseDiscordMarkdown,
} from "./markdown-ast";

const CLASSE_MENTION =
  "rounded-sm bg-primary/12 px-1 py-px font-medium text-primary transition-colors hover:bg-primary/20";

/** Met en forme un horodatage dynamique `<t:…>` selon le style demandé. */
function formaterHorodatage(horodatage: number, style: StyleHorodatage): string {
  const date = new Date(horodatage * 1000);
  if (Number.isNaN(date.getTime())) return "date inconnue";
  switch (style) {
    case "t": {
      return format(date, "HH:mm", { locale: fr });
    }
    case "T": {
      return format(date, "HH:mm:ss", { locale: fr });
    }
    case "d": {
      return format(date, "dd/MM/yyyy", { locale: fr });
    }
    case "D": {
      return format(date, "d MMMM yyyy", { locale: fr });
    }
    case "F": {
      return format(date, "EEEE d MMMM yyyy 'à' HH:mm", { locale: fr });
    }
    case "R": {
      return formatDistanceToNow(date, { addSuffix: true, locale: fr });
    }
    default: {
      return format(date, "d MMMM yyyy 'à' HH:mm", { locale: fr });
    }
  }
}

function rendreNoeud(noeud: NoeudInline, cle: string): React.ReactNode {
  switch (noeud.type) {
    case "texte": {
      return <span key={cle}>{noeud.valeur}</span>;
    }
    case "saut": {
      return <br key={cle} />;
    }
    case "gras": {
      return (
        <strong key={cle} className="font-bold text-on-surface">
          {rendreNoeuds(noeud.enfants, cle)}
        </strong>
      );
    }
    case "italique": {
      return <em key={cle}>{rendreNoeuds(noeud.enfants, cle)}</em>;
    }
    case "souligne": {
      return <u key={cle}>{rendreNoeuds(noeud.enfants, cle)}</u>;
    }
    case "barre": {
      return (
        <s key={cle} className="opacity-70">
          {rendreNoeuds(noeud.enfants, cle)}
        </s>
      );
    }
    case "spoiler": {
      return (
        <span
          key={cle}
          title="Contenu masqué — survolez pour révéler"
          className="rounded-sm bg-on-surface/90 px-1 text-transparent transition-colors hover:bg-on-surface/10 hover:text-on-surface focus-visible:bg-on-surface/10 focus-visible:text-on-surface"
          tabIndex={0}
        >
          {rendreNoeuds(noeud.enfants, cle)}
        </span>
      );
    }
    case "code": {
      return (
        <code
          key={cle}
          className="rounded-sm border border-outline-variant/40 bg-surface-container-highest px-1.5 py-0.5 font-mono text-[0.875em] text-on-surface"
        >
          {noeud.valeur}
        </code>
      );
    }
    case "lien": {
      return (
        <a
          key={cle}
          href={noeud.url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-primary underline decoration-primary/40 underline-offset-2 transition-colors hover:decoration-primary"
        >
          {rendreNoeuds(noeud.enfants, cle)}
        </a>
      );
    }
    case "mention-utilisateur": {
      return (
        <span key={cle} className={CLASSE_MENTION}>
          @{noeud.nom}
        </span>
      );
    }
    case "mention-role": {
      /*
       * AUCUNE COULEUR EN LIGNE. La couleur d'un rôle Discord est un entier
       * arbitraire, choisi sans la moindre garantie de contraste avec nos
       * surfaces : sur les 93 rôles du serveur, `Joueur Débutant` (#fff498),
       * `RGK` (#fff400) et `Gagnants Tournois` (#fff300) tombent à 1,13:1 sur
       * fond clair — c'est-à-dire illisible. Rien ne bornait cette valeur, ni
       * `couleurDiscord()` (qui accepte tout de 1 à 0xFFFFFF), ni le rendu.
       * `CLASSE_MENTION` distingue déjà une mention du texte courant, avec des
       * jetons du design system qui suivent les quatre thèmes. `noeud.couleur`
       * reste renseigné pour le diagnostic ; ne pas le recâbler sur `style`.
       */
      return (
        <span key={cle} className={CLASSE_MENTION}>
          @{noeud.nom}
        </span>
      );
    }
    case "mention-salon": {
      return (
        <span key={cle} className={CLASSE_MENTION}>
          #{noeud.nom}
        </span>
      );
    }
    case "mention-globale": {
      return (
        <span key={cle} className="rounded-sm bg-tertiary/20 px-1 py-px font-semibold text-on-tertiary-container">
          @{noeud.valeur}
        </span>
      );
    }
    case "emoji": {
      return (
        <Image
          key={cle}
          src={noeud.url}
          alt={`:${noeud.nom}:`}
          title={`:${noeud.nom}:`}
          width={24}
          height={24}
          unoptimized
          className="inline-block size-[1.375em] align-[-0.3em]"
        />
      );
    }
    case "horodatage": {
      return (
        <span key={cle} className="rounded-sm bg-surface-container-highest px-1 py-px text-on-surface-variant">
          {formaterHorodatage(noeud.horodatage, noeud.style)}
        </span>
      );
    }
    default: {
      return null;
    }
  }
}

function rendreNoeuds(noeuds: NoeudInline[], prefixe: string): React.ReactNode[] {
  return noeuds.map((noeud, index) => rendreNoeud(noeud, `${prefixe}-${index}`));
}

function rendreBloc(bloc: Bloc, cle: string): React.ReactNode {
  switch (bloc.type) {
    case "paragraphe": {
      return (
        <p key={cle} className="break-words whitespace-pre-wrap">
          {rendreNoeuds(bloc.enfants, cle)}
        </p>
      );
    }
    case "titre": {
      // Les titres du message restent sous le titre de la carte : h3 → h5.
      const classes = {
        1: "text-fluid-headline-md",
        2: "text-fluid-body-lg",
        3: "text-fluid-body-md",
      } as const;
      const Balise = bloc.niveau === 1 ? "h3" : bloc.niveau === 2 ? "h4" : "h5";
      return (
        <Balise key={cle} className={`${classes[bloc.niveau]} font-bold break-words text-on-surface`}>
          {rendreNoeuds(bloc.enfants, cle)}
        </Balise>
      );
    }
    case "sous-texte": {
      return (
        <p key={cle} className="text-xs break-words text-on-surface-variant/80">
          {rendreNoeuds(bloc.enfants, cle)}
        </p>
      );
    }
    case "citation": {
      return (
        <blockquote key={cle} className="border-l-4 border-primary/50 py-0.5 pl-3 break-words text-on-surface-variant">
          {rendreNoeuds(bloc.enfants, cle)}
        </blockquote>
      );
    }
    case "liste": {
      const Balise = bloc.ordonnee ? "ol" : "ul";
      return (
        <Balise
          key={cle}
          className={`ml-5 space-y-1 ${bloc.ordonnee ? "list-decimal" : "list-disc"} marker:text-on-surface-variant/60`}
        >
          {bloc.elements.map((element, index) => (
            <li key={`${cle}-li-${index}`} className="break-words">
              {rendreNoeuds(element, `${cle}-li-${index}`)}
            </li>
          ))}
        </Balise>
      );
    }
    case "bloc-code": {
      return (
        <pre
          key={cle}
          className="overflow-x-auto rounded-xl border border-outline-variant/40 bg-surface-container-highest p-3"
        >
          <code className="font-mono text-xs text-on-surface">{bloc.code}</code>
        </pre>
      );
    }
    default: {
      return null;
    }
  }
}

export interface ContenuDiscordProps {
  contenu: string;
  contexte?: ContexteMentions;
  className?: string;
}

/**
 * Rend le contenu markdown d'un message Discord.
 * Renvoie `null` si le message n'a pas de texte (encart ou pièce jointe seuls).
 */
export function ContenuDiscord({ contenu, contexte = CONTEXTE_MENTIONS_VIDE, className }: ContenuDiscordProps) {
  const blocs = parseDiscordMarkdown(contenu, contexte);
  if (blocs.length === 0) return null;

  return (
    <div className={`space-y-2 text-fluid-body-md leading-relaxed text-on-surface ${className ?? ""}`}>
      {blocs.map((bloc, index) => rendreBloc(bloc, `b-${index}`))}
    </div>
  );
}

/** Rendu inline d'une chaîne courte (titre d'encart, nom de champ…). */
export function TexteDiscordInline({
  contenu,
  contexte = CONTEXTE_MENTIONS_VIDE,
}: {
  contenu: string;
  contexte?: ContexteMentions;
}) {
  const blocs = parseDiscordMarkdown(contenu, contexte);
  if (blocs.length === 0) return null;
  return (
    <>
      {blocs.map((bloc, index) =>
        bloc.type === "bloc-code" ? (
          <code key={`i-${index}`} className="font-mono text-[0.875em]">
            {bloc.code}
          </code>
        ) : bloc.type === "liste" ? (
          rendreBloc(bloc, `i-${index}`)
        ) : (
          <span key={`i-${index}`}>{rendreNoeuds(bloc.enfants, `i-${index}`)}</span>
        ),
      )}
    </>
  );
}
