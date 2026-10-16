import Image from "next/image";

interface ChroniclePreviewProps {
	title: string;
	excerpt: string;
	category: string;
	featuredImage: string;
	content: string;
}

export function ChroniclePreview({
	title,
	excerpt,
	category,
	featuredImage,
	content,
}: ChroniclePreviewProps) {
	return (
		<div className="space-y-6 bg-white p-8 rounded-lg border">
			<div>
				{featuredImage && (
					<div className="relative w-full h-64 mb-6">
						<Image
							src={featuredImage}
							alt={title}
							fill
							sizes="(max-width: 768px) 100vw, 768px"
							className="object-cover rounded-lg"
						/>
					</div>
				)}
				<span className="inline-block px-3 py-1 bg-rg-rose/10 text-rg-rose text-sm rounded-full mb-4">
					{category}
				</span>
				<h1 className="text-4xl font-bold text-rg-rose mb-4">{title || "Sans titre"}</h1>
				<p className="text-lg text-muted-foreground mb-8">{excerpt || "Pas de résumé"}</p>
			</div>

			<div className="h-px bg-muted" />

			<div
				className="prose prose-lg max-w-none"
				dangerouslySetInnerHTML={{
					__html: content || "<p>Pas de contenu</p>",
				}}
			/>
		</div>
	);
}
