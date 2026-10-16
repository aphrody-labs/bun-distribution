"use client";

import { Card, AdminPageHeader } from "@rosegriffon/ui";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { ChronicleEditor } from "@/components/admin/ChronicleEditor";

import { createChronicle } from "../actions";

export default function NewChroniclePage() {
	const router = useRouter();

	const handleSave = async (data: {
		title: string;
		slug: string;
		excerpt: string;
		content: string;
		category: string;
		featured_image: string;
		published: boolean;
	}) => {
		try {
			const result = await createChronicle({
				category: data.category,
				content: data.content,
				excerpt: data.excerpt,
				featured_image_url: data.featured_image,
				slug: data.slug,
				status: data.published ? "published" : "draft",
				title: data.title,
			});

			if (!result.success) {
				toast.error(result.error || "Une erreur est survenue");
				return;
			}

			toast.success(
				data.published ? "Chronique publiée avec succès !" : "Brouillon enregistré avec succès !"
			);

			router.push("/admin/chroniques");
			router.refresh();
		} catch (error) {
			console.error("Erreur lors de la création:", error);
			toast.error("Erreur inattendue");
		}
	};

	const handleCancel = () => {
		router.push("/admin/chroniques");
	};

	return (
		<div className="container max-w-6xl px-3 sm:px-4 md:px-6 py-4 sm:py-6 md:py-8 space-y-4 sm:space-y-6 md:space-y-8 animate-in fade-in duration-500">
			{/* En-tête avec décoration Roy & Gaëlle */}
			<div className="relative pl-4 sm:pl-6">
				<div className="absolute left-0 top-1 bottom-1 w-1 sm:w-1.5 rounded-full bg-linear-to-b from-[#344E8C] via-[#FFC46E] to-[#B03519]" />
				<AdminPageHeader
					title="Nouvelle Chronique du Bouquet"
					description="Rédigez une nouvelle histoire pour la communauté Rose Griffon. Utilisez l'éditeur ci-dessous pour créer du contenu riche."
				/>
			</div>

			{/* Zone d'édition avec style premium */}
			<div className="grid gap-4 sm:gap-6">
				<Card className="border-t-4 border-t-[#344E8C] shadow-lg overflow-hidden bg-muted/400 backdrop-blur-sm">
					<div className="p-0.5 sm:p-1 bg-linear-to-r from-[#344E8C]/10 via-transparent to-[#B03519]/10">
						<div className="bg-white/80 p-3 sm:p-4 md:p-6 rounded-sm">
							<ChronicleEditor onSave={handleSave} onCancel={handleCancel} />
						</div>
					</div>
				</Card>
			</div>
		</div>
	);
}
