import { Button, Card, CardContent, CardHeader, CardTitle } from "@rosegriffon/ui";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { PageContainer, PageHero, SectionCard } from "@/components/shared/PageShell";
import { BreadcrumbSchema } from "@/components/shared/StructuredData";
import { Mail, MessageCircle, Scale, Shield, Users } from "@/lib/icons-config";
import { absoluteUrl } from "@/lib/site-url";

export const metadata: Metadata = {
	title: "Cellule de médiation · Rose Griffon",
	description:
		"Un espace neutre, confidentiel et indépendant du staff dirigeant : missions de la cellule de médiation Rose Griffon et comment la contacter.",
	alternates: {
		canonical: absoluteUrl("/cellule-de-mediation"),
	},
	openGraph: {
		title: "Cellule de médiation · Rose Griffon",
		description:
			"Un espace neutre, confidentiel et indépendant pour le bien-être de tous les membres de Rose Griffon.",
		url: absoluteUrl("/cellule-de-mediation"),
		type: "website",
	},
};

const ADRESSE_MEDIATION = "contact@rosegriffon.fr";

/** Les trois missions de la cellule. */
const MISSIONS = [
	{
		id: "contact",
		titre: "Contact direct & confidentiel",
		texte:
			"Les membres peuvent contacter la cellule via une adresse mail dédiée pour tout sujet : conflits internes, harcèlement, ou problèmes affectant la vie associative.",
	},
	{
		id: "ecoute",
		titre: "Écoute & dialogue",
		texte:
			"La cellule agit comme tiers de confiance pour organiser un dialogue neutre et respectueux, cherchant une solution amiable pour préserver l'ambiance générale.",
	},
	{
		id: "autonomie",
		titre: "Autonomie décisionnelle",
		texte:
			"Elle gère ses équipes de façon autonome. Si nécessaire et avec l'accord de la victime, elle peut remonter les informations aux instances compétentes pour décision officielle.",
	},
];

export default function CelluleDeMediationPage() {
	return (
		<PageContainer>
			<BreadcrumbSchema
				items={[
					{ item: "/", name: "Accueil" },
					{ item: "/cellule-de-mediation", name: "Cellule de médiation" },
				]}
			/>

			<PageHero
				icon={<Shield className="size-7 shrink-0 text-rg-or md:size-8" aria-hidden />}
				eyebrow="Indépendante du staff dirigeant"
				title="Cellule de médiation"
				description="Un espace neutre, confidentiel et indépendant pour le bien-être de tous les membres."
			/>

			{/* Introduction */}
			<SectionCard>
				<h2 className="mb-4 flex items-center gap-3 text-fluid-headline-lg font-bold text-foreground">
					<span className="rounded-lg bg-primary p-2 text-primary-foreground shadow-lg shadow-primary/20">
						<Scale className="size-6" aria-hidden />
					</span>
					Qu&apos;est-ce que la cellule de médiation RG ?
				</h2>
				<p className="text-fluid-body-lg leading-relaxed text-muted-foreground">
					La cellule de médiation RG est une structure interne à l&apos;association Rose Griffon,
					fonctionnant de manière{" "}
					<strong className="font-semibold text-foreground">totalement indépendante</strong> du staff
					dirigeant. Elle a été créée pour garantir un espace neutre et impartial, une écoute
					confidentielle hors de la chaîne de commandement habituelle, et une gestion autonome des
					conflits.
				</p>
			</SectionCard>

			<div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
				{/* Missions */}
				<Card className="flex flex-col border-t-4 border-t-primary shadow-lg transition-shadow duration-300 hover:shadow-xl">
					<CardHeader>
						<CardTitle className="flex items-center gap-3 text-fluid-headline-md font-bold">
							<Users className="size-7 shrink-0 text-primary" aria-hidden />
							Ses missions principales
						</CardTitle>
					</CardHeader>

					<CardContent className="flex grow flex-col gap-4">
						{MISSIONS.map((mission, index) => (
							<div
								key={mission.id}
								className="flex items-start gap-4 rounded-lg border border-border bg-muted p-4"
							>
								<span
									className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary font-bold text-primary-foreground"
									aria-hidden
								>
									{index + 1}
								</span>
								<p className="text-fluid-body-md text-muted-foreground">
									<strong className="mb-1 block font-semibold text-foreground">
										{mission.titre}
									</strong>
									{mission.texte}
								</p>
							</div>
						))}
					</CardContent>
				</Card>

				{/* Contact */}
				<Card className="flex flex-col border-t-4 border-t-secondary shadow-lg transition-shadow duration-300 hover:shadow-xl">
					<CardHeader>
						<CardTitle className="flex items-center gap-3 text-fluid-headline-md font-bold">
							<MessageCircle className="size-7 shrink-0 text-secondary" aria-hidden />
							Besoin d&apos;en parler ?
						</CardTitle>
					</CardHeader>
					<CardContent className="flex grow flex-col items-center justify-center gap-6 text-center">
						<p className="max-w-md text-fluid-body-md text-muted-foreground">
							L&apos;équipe de médiation est là pour vous écouter en toute bienveillance et
							confidentialité. N&apos;hésitez pas à nous contacter.
						</p>

						<div className="relative aspect-square w-full max-w-56">
							<Image
								src="/emote.webp"
								alt=""
								fill
								sizes="(max-width: 640px) 60vw, 224px"
								className="object-contain drop-shadow-xl"
							/>
						</div>

						<Button
							asChild
							size="lg"
							className="h-auto min-h-14 w-full max-w-sm py-3 text-base whitespace-normal"
						>
							<a href={`mailto:${ADRESSE_MEDIATION}`}>
								<Mail className="size-5" aria-hidden />
								Écrire à la cellule
							</a>
						</Button>
						<p className="text-sm text-muted-foreground">
							<span className="block break-all font-medium text-foreground">
								{ADRESSE_MEDIATION}
							</span>
							Réponse sous 48 h ouvrées.
						</p>
						<p className="text-sm text-muted-foreground">
							Votre demande ne relève pas de la médiation ?{" "}
							<Link href="/a-propos/contact" className="font-medium text-primary underline">
								Utilisez le formulaire de contact
							</Link>
							.
						</p>
					</CardContent>
				</Card>
			</div>
		</PageContainer>
	);
}
