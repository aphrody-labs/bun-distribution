import type { ComponentType, SVGProps } from "react";

import { PfpIcon } from "@/components/icons/PfpIcon";

import type { EMOTES } from "@/lib/emotes";
import { Hash, Palette, Smile, Tv, Users } from "@/lib/icons-config";
import { absoluteUrl } from "@/lib/site-url";

/**
 * Source unique des projets Rose Griffon.
 *
 * La page `/projets` et la section « Nos projets » de l'accueil lisaient
 * auparavant deux tableaux recopiés (3 entrées d'un côté, 4 de l'autre, avec
 * des libellés et des visuels divergents). Elles consomment désormais cette
 * liste : l'accueil n'est plus qu'un extrait de la page (`PROJETS_ACCUEIL`).
 */

/** Nom d'une emote Rose Griffon (cf. `@/lib/emotes`). */
type NomEmote = keyof typeof EMOTES;

export interface Projet {
	/** Identifiant stable — sert de clé de rendu. */
	slug: string;
	titre: string;
	description: string;
	href: string;
	/** Libellé de la pastille affichée sur le visuel. */
	badge: string;
	/** Icône de repli quand le projet n'a pas encore de visuel. */
	icone: ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;
	/** Emote affichée en médaillon sur la carte. */
	emote: NomEmote;
	/** Visuel de couverture servi par `next/image` (optionnel). */
	image?: string;
	/** Mis en avant dans l'extrait de la page d'accueil. */
	surAccueil?: boolean;
}

export const PROJETS: Projet[] = [
	{
		// EN TÊTE tant que la campagne est ouverte : c'est le seul projet de cette
		// liste qui ait une date de fin, et un participant qui arrive après le
		// 22/08/2026 n'a plus rien à y faire. Les outils permanents, eux, seront
		// encore là le mois prochain.
		badge: "Campagne en cours",
		description:
			"Un mois de célébration pour les 18 ans d'Inazuma Eleven : postez votre OC avec #IERGDay et rejoignez la fresque collaborative de la communauté.",
		emote: "roy-coeur",
		href: "/iergday",
		icone: Hash,
		image: absoluteUrl("/storage/v1/object/public/assets/campagnes/iergday/affiche-v2.webp"),
		slug: "iergday",
		surAccueil: true,
		titre: "IERG Day",
	},
	{
		badge: "Nouveau",
		description:
			"Créez votre photo de profil aux couleurs de Rose Griffon. Ajoutez le cadre officiel à votre avatar en quelques clics.",
		emote: "gaelle-fiere",
		href: "/projets/outils/pfp",
		icone: PfpIcon,
		image: "/avatarRG/avatarRG.webp",
		slug: "avatar-rg",
		surAccueil: true,
		titre: "Avatar RG",
	},
	{
		badge: "Outil créatif",
		description:
			"Créez vos montages comparatifs 2011 vs Victory Road avec notre outil de collage avancé, puis partagez vos créations.",
		emote: "gaelle-coeur",
		href: "/projets/nostalgie",
		icone: Palette,
		image: "/roygaelle.webp",
		slug: "nostalgie",
		surAccueil: true,
		titre: "Nostalgie",
	},
	{
		badge: "Galerie",
		description:
			"Explorez les galeries collaboratives géantes rassemblant les créations et les histoires de la communauté.",
		emote: "rg-funny",
		href: "/projets/muraux",
		icone: Users,
		image: "/frsque.webp",
		slug: "muraux",
		surAccueil: true,
		titre: "Muraux communautaires",
	},
	{
		badge: "Ressources",
		description:
			"Découvrez la collection complète des emotes officielles Rose Griffon. Gaëlle, Roy et bien plus encore.",
		emote: "gaelle-surprise",
		href: "/projets/emotes",
		icone: Smile,
		slug: "emotes",
		titre: "Galerie d'emotes",
	},
	{
		badge: "WebTV & Replays",
		description:
			"La chaîne WebTV historique de Rose Griffon : sessions de jeu, tournois commentés et archives vidéo de la communauté.",
		emote: "roy-cool",
		href: "/rose-griffon-tv",
		icone: Tv,
		image: "/rgtv/affiche.webp",
		slug: "rgtv",
		surAccueil: false,
		titre: "RG TV",
	},
];

/** Extrait mis en avant sur la page d'accueil. */
export const PROJETS_ACCUEIL: Projet[] = PROJETS.filter((projet) => projet.surAccueil);
