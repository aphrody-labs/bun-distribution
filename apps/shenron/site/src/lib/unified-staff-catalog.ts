

import { assetUrl } from "@/lib/assets";
import type {
	StaffEra,
	StaffStudio,
	StaffTier,
	UnifiedStaffMember,
} from "@/components/wiki/UnifiedStaffExplorer";

const ANECDOTES_MAP: Record<string, string> = {
	"kazuhiko-torishima":
		"A rejeté plus de 500 pages de Toriyama avant Dr. Slump. Il a poussé l'auteur vers les arts martiaux et a inspiré directement les visages du Dr. Mashirito et du Roi Démon Piccolo.",
	"yu-kondo":
		"Éditeur de l'apogée Namek. Jugeant le design originel de Freezer trop banal, il a exigé des métamorphoses successives qui ont donné naissance aux 4 formes mythiques du tyran.",
	"fuyuto-takeda":
		"A accompagné Toriyama jusqu'au 519e chapitre. Connu pour sa complicité totale avec l'auteur, lui laissant carte blanche pour l'humour et les fusions délirantes de l'arc Buu.",
	"akio-iyoku":
		"Ancien rédacteur en chef du V-Jump, créateur de la Dragon Ball Room chez Shueisha en 2016, puis fondateur de Capsule Corporation Tokyo pour pérenniser l'héritage de Toriyama.",
	"daisuke-nishio":
		"Réalisateur légendaire des 199 premiers épisodes de DBZ. Il chronométrait lui-même chaque échange de coups sur ses storyboards pour garantir un rythme d'impact inégalé.",
	"shigeyasu-yamauchi":
		"Réalisateur visionnaire des films Broly (1993) et Janemba (1995). Toriyama a personnellement salué son sens tragique et ses cadrages cinématographiques d'une noirceur sublime.",
	"minoru-maeda":
		"Superviseur général de l'animation de 1986 à 1993. Ses fiches de settei restent la référence graphique absolue pour le trait tout en rondeur et en puissance de Toriyama.",
	"masaki-sato":
		"Animateur vedette de la Toei. Il a animé de ses mains les plans cultes de Goku vs Vegeta (Kaioken x3) et l'exécution chirurgicale de Mecha Freezer par Trunks.",
	"tadayoshi-yamamuro":
		"A défini pendant plus de 25 ans l'identité visuelle de DBZ avec ses traits d'ombres acérés et sa musculature ultra-découpée, avant de réaliser Battle of Gods et Fukkatsu no F.",
	"naohiro-shintani":
		"Sélectionné personnellement par Akira Toriyama sur concours pour Dragon Ball Super: Broly grâce à son trait épuré, souple et fidèle aux illustrations vintage de l'auteur.",
	"takao-koyama":
		"Scénariste principal de DBZ (épisodes 1 à 291) et des 13 premiers films. C'est à sa plume que l'on doit les créations mythiques de Broly, Cooler, Bojack et Janemba.",
	"shunsuke-kikuchi":
		"A composé plus de 400 morceaux symphoniques pour Dragon Ball et DBZ, tous enregistrés en prises directes avec un grand orchestre de cuivres et de cordes.",
	"hironobu-kageyama":
		"Surnommé « M. Dragon Ball ». Il a chanté Cha-La Head-Cha-La et We Gotta Power des milliers de fois en concert à travers le monde devant des foules immenses.",
	"norihito-sumitomo":
		"Architecte du renouveau sonore de Dragon Ball au 21e siècle, compositeur de Battle of Gods et du mythique « Ultimate Battle » (Ka Ka Kachi Daze) du Tournoi du Pouvoir.",
	"masako-nozawa":
		"Akira Toriyama l'a choisie en 1986 après seulement quelques répliques : « Dès que j'ai entendu sa voix, j'ai su que Son Goku existait réellement ». Deux records du monde Guinness.",
	"patrick-borg":
		"Voix française historique de Goku adulte depuis 1990. Réputé pour ses hurlements de rage héroïque poussés sans trucage sonore lors des transformations en Super Saiyan.",
	"brigitte-lecordier":
		"A immortalisé l'enfance de Goku, Gohan et Goten en VF. Sa spontanéité et son rire malicieux ont marqué l'âge d'or du Club Dorothée.",
	"eric-legrand":
		"A enrichi le caractère princier de Vegeta en VF avec des tirades théâtrales cinglantes (« Maraud ! Insolent ! Faquin ! ») devenues légendaires chez les francophones.",
	"philippe-ariotti":
		"Prodige du doublage capable d'incarner simultanément la sagesse solennelle de Piccolo, la froideur aristocratique de Freezer et la couardise comique d'Oolong.",
	"sean-schemmel":
		"Voix américaine culte chez Funimation. S'est littéralement évanoui en cabine de doublage en poussant à l'extrême son souffle sur le cri du Super Saiyan 4.",
	"christopher-sabat":
		"Pilier du doublage américain, il a dirigé le casting anglais de Dragon Ball pendant 20 ans tout en assurant avec brio les voix de Vegeta, Piccolo, Yamcha et Shenron.",
	"mario-castaneda":
		"Légende vivante du doublage au Mexique et en Amérique latine. Son interprétation du Kaméhaméha est reprise en chœur par des dizaines de milliers de fans en convention.",
	"rene-garcia":
		"Voix officielle de Vegeta en Amérique latine. Son juron méprisant « ¡Insecto! » est devenu un mème absolu et un repère culturel majeur dans tout le monde hispanique.",
	"jose-antonio-gavira":
		"Voix historique de Son Goku adulte en Espagne (Castillan) lors de l'explosion du phénomène Dragon Ball Z à la télévision ibérique.",
	"paolo-torrisi":
		"Comédien et directeur de doublage italien historique. Voix inoubliable de Goku adulte sur Italia 1 de 1999 jusqu'à sa tragique disparition en 2005.",
};

export function buildUnifiedStaffCatalog(
	contributors: any[],
	voiceActors: any[]
): UnifiedStaffMember[] {
	const results: UnifiedStaffMember[] = [];
	const seenSlugs = new Set<string>();

	// 1. Contributors (Editorial & Production)
	for (const c of contributors) {
		if (c.slug === "akira-toriyama") continue; // Shown in Hero Spotlight
		seenSlugs.add(c.slug);

		let tier: StaffTier = "production";
		let tierLabel = "Animation & Direction";
		let studio: StaffStudio = "toei";
		let studioLabel = "Toei Animation";
		let eras: StaffEra[] = ["dbz"];

		if (c.category === "editorial_staff" || c.category === "author" || c.category === "publisher") {
			tier = "editorial";
			tierLabel = "Éditorial & Droits";
			studio = c.slug === "akio-iyoku" ? "cct" : "shueisha";
			studioLabel =
				c.slug === "akio-iyoku" ? "Capsule Corp Tokyo / Shueisha" : "Weekly Shōnen Jump";
			eras = ["db", "dbz"];
		} else if (c.category === "scenario") {
			tier = "production";
			tierLabel = "Scénario & Écriture";
			studio = "toei";
			studioLabel = "Toei Animation";
			eras = ["dbz"];
		} else if (c.category === "music") {
			tier = "production";
			tierLabel = "Musique & OST";
			studio = "toei";
			studioLabel = "Production Musicale";
			eras = c.slug.includes("sumitomo") ? ["dbs"] : ["db", "dbz"];
		} else if (c.category === "voice") {
			// Handled by voice actors list
			continue;
		}

		if (c.slug === "daisuke-nishio") eras = ["db", "dbz"];
		if (c.slug === "naohiro-shintani") eras = ["dbs"];
		if (c.slug === "akio-iyoku") eras = ["dbs", "daima"];

		results.push({
			id: c.slug,
			slug: c.slug,
			nameFr: c.name,
			nameJa: c.name_ja || undefined,
			nameRomaji: c.name_romaji || undefined,
			tier,
			tierLabel,
			subRole: c.biography_fr ? c.biography_fr.slice(0, 65) + "..." : "Membre de l'équipe",
			period: c.birth_date
				? `${c.birth_date.slice(0, 4)} — ${c.death_date ? c.death_date.slice(0, 4) : "Présent"}`
				: "Ère Dragon Ball",
			eras,
			studio,
			studioLabel,
			keyWorks: [c.name],
			bioSummary: c.biography_fr || "",
			anecdote: ANECDOTES_MAP[c.slug],
			wikiLink: `/wiki/contributeurs/${c.slug}`,
		});
	}

	// 2. Voice Actors (Tiers 3, 4, 5, 6)
	for (const va of voiceActors) {
		let tier: StaffTier = "voice_intl";
		let tierLabel = "Doublage International";
		let studioLabel = "Plateau de Doublage";

		if (va.nationality === "ja") {
			tier = "voice_ja";
			tierLabel = "Seiyū (VO Japon)";
			studioLabel = "Studio Audio Japon (Aoni, etc.)";
		} else if (va.nationality === "fr") {
			tier = "voice_fr";
			tierLabel = "Doublage Français (VF)";
			studioLabel = "Doublage Français (AB Productions, etc.)";
		} else if (va.nationality === "en") {
			tier = "voice_en";
			tierLabel = "Doublage Anglais (VA)";
			studioLabel = "Funimation / Crunchyroll (USA)";
		} else if (va.nationality === "latam") {
			tier = "voice_intl";
			tierLabel = "Doublage Latino (LatAm)";
			studioLabel = "Doublage Mexicain & Sud-Américain";
		} else if (va.nationality === "es") {
			tier = "voice_intl";
			tierLabel = "Doublage Espagne (Castillan)";
			studioLabel = "Doublage Espagnol";
		} else if (va.nationality === "it") {
			tier = "voice_intl";
			tierLabel = "Doublage Italien (Italie)";
			studioLabel = "Mediaset / Merak Film (Milan)";
		}

		let parsedRoles: any[] = [];
		try {
			parsedRoles = typeof va.roles === "string" ? JSON.parse(va.roles) : va.roles || [];
		} catch {
			parsedRoles = [];
		}

		const keyWorks = parsedRoles.map((r: any) => r.characterName);
		const eras: StaffEra[] = ["dbz"];
		const rolesText = JSON.stringify(parsedRoles).toLowerCase();
		if (rolesText.includes("daima")) eras.push("daima");
		if (rolesText.includes("dbs") || rolesText.includes("super")) eras.push("dbs");
		if (rolesText.includes("gt")) eras.push("gt");
		if (rolesText.includes("db,") || rolesText.includes("dragon ball,")) eras.push("db");

		results.push({
			id: va.slug,
			slug: va.slug,
			nameFr: va.name,
			nameJa: va.name_ja || undefined,
			tier,
			tierLabel,
			subRole:
				parsedRoles.length > 0 ? `Voix de ${parsedRoles[0].characterName}` : "Comédien de doublage",
			period: va.birth_date ? `${va.birth_date.slice(0, 4)} — Présent` : "Ère Dragon Ball",
			eras,
			studio: "audio_dub",
			studioLabel,
			keyWorks,
			bioSummary: va.biography || "",
			anecdote: ANECDOTES_MAP[va.slug],
			// `bot.db_voice_actors.image` peut être un chemin d'asset brut (portrait
			// téléversé à l'admin) : rendu tel quel, il se résolvait contre le site.
			image: va.image ? assetUrl(va.image) : null,
			// Le casting est consulté dans ce hub ; l'ancienne fiche autonome a été
			// retirée de la navigation et redirige ici.
			wikiLink: `/wiki/staff#${va.slug}`,
			roles: parsedRoles,
		});
	}

	return results;
}
