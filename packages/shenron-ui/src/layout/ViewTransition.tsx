// Wrapper isomorphe autour de `<ViewTransition>` de React (activé via
// `experimental.viewTransition: true` dans next.config — Next alias `react` vers
// react-experimental au build, qui expose `ViewTransition`).
//
// Pourquoi un wrapper :
//  1. Typer proprement les props qu'on utilise (`name`, `share`, `enter`,
//     `exit`, `default`) sans dépendre des types instables.
//  2. Dégrader en simple `<>{children}</>` si l'export n'existe pas (build sans
//     le flag, ou navigateur sans View Transitions API → React ne fait rien de
//     toute façon, mais on garde le composant safe).
//
// `ViewTransition` fonctionne en RSC ET en client. Ce module n'a pas de
// directive — il est neutre et peut être importé des deux côtés.
import { Fragment } from "react";
import * as React from "react";

type VTAnim = string | Record<string, string>;

export interface ViewTransitionProps {
	children: React.ReactNode;
	/** Identité partagée entre deux routes → morph automatique de l'élément. */
	name?: string;
	/** "morph" | "auto" | "none" — assigne une classe ciblable en CSS. */
	share?: VTAnim;
	enter?: VTAnim;
	exit?: VTAnim;
	/** Animation par défaut (souvent "none" pour ne pas animer hors contexte). */
	default?: VTAnim;
}

// `ViewTransition` n'est présent que sur le build react-experimental injecté par
// Next quand le flag est actif. On le récupère dynamiquement pour éviter une
// erreur de type/résolution si absent.
const ReactAny = React as unknown as {
	ViewTransition?: React.ComponentType<ViewTransitionProps>;
	unstable_ViewTransition?: React.ComponentType<ViewTransitionProps>;
};
const RVT = ReactAny.ViewTransition ?? ReactAny.unstable_ViewTransition;

export function ViewTransition(props: ViewTransitionProps) {
	if (!RVT) return <Fragment>{props.children}</Fragment>;
	return <RVT {...props} />;
}
