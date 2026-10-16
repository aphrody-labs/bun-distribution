"use client";

import { Button } from "@rosegriffon/ui";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";

import TextPressure from "@/components/blocks/TextAnimations/TextPressure/TextPressure";
import RgEmote from "@/components/shared/emotes/RgEmote";

import { ArrowLeft, Home } from "@/lib/icons-config";

export default function NotFound() {
	const router = useRouter();

	return (
		<div className="flex min-h-screen flex-col items-center justify-center bg-background p-4 text-center">
			<div className="relative mb-8">
				{/* Effet de lueur derrière l'image */}
				<div className="absolute -inset-4 rounded-full bg-[#a14b3f]/20 blur-3xl" />
				<Image
					src="/gaelle_lagoatte_pfp.webp"
					alt="Gaelle Lagoatte Rose Griffon"
					width={200}
					height={200}
					className="relative rounded-full border-4 border-background shadow-xl transition-transform hover:scale-105"
					priority
				/>
			</div>

			<div className="mb-6 w-full max-w-5xl">
				<TextPressure
					text="404_-_HORS_JEU_!"
					fontFamily="Compressa VF"
					fontUrl="https://res.cloudinary.com/dr6lvwubh/raw/upload/v1529908256/CompressaPRO-GX.woff2"
					flex
					weight
					italic
					scale={false}
					textColor="#a14b3f"
					strokeWidth={0}
					className="h-[200px] w-full"
					minFontSize={80}
				/>
			</div>

			<div className="mb-8 flex max-w-lg flex-col items-center justify-center gap-2 text-xl text-muted-foreground sm:flex-row">
				<span>La page que vous cherchez n&apos;existe pas.</span>
				<span className="flex items-center gap-2">
					Peut-être une mauvaise passe ? <RgEmote name="gaelle-perplexe" size={32} animated />
				</span>
			</div>

			<div className="flex flex-col gap-4 sm:flex-row">
				<Button
					variant="outline"
					onClick={() => router.back()}
					className="gap-2 border-input hover:bg-accent hover:text-accent-foreground"
				>
					<ArrowLeft className="size-4" />
					Page précédente
				</Button>

				<Link href="/">
					<Button className="gap-2 bg-[#a14b3f] text-white hover:bg-[#8a3e34]">
						<Home className="size-4" />
						Retour au vestiaire
						<RgEmote name="gaelle-salut" size={20} />
					</Button>
				</Link>
			</div>
		</div>
	);
}
