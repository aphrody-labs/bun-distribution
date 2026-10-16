import { Badge, Button, Card, CardContent, CardHeader } from "@rosegriffon/ui";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import Image from "next/image";
import Link from "next/link";

import { ArrowRight, Calendar, Eye, Newspaper } from "@/lib/icons-config";
import { getPgPool } from "@/lib/db/pg";
import type { Article } from "@/lib/api/articles";

export async function LatestChroniqueSection() {
	// Récupérer la dernière chronique publiée — lecture Postgres DIRECTE
	// (bypass le Data API PostgREST de Supabase, cf. lib/db/pg.ts).
	const pool = getPgPool();

	let latestChronique: Article | null;
	try {
		const { rows } = await pool.query<Article>(
			`SELECT * FROM articles WHERE status = $1 AND app = $2 ORDER BY created_at DESC LIMIT 1`,
			["published", "website"]
		);
		latestChronique = rows[0] ?? null;
	} catch (error) {
		console.error("Error fetching latest chronique:", error);
		latestChronique = null;
	}

	if (!latestChronique) {
		return null;
	}

	const article = latestChronique;

	return (
		<section
			className="mx-auto w-full max-w-7xl animate-in fade-in slide-in-from-bottom-4 duration-500 px-4 md:px-6 lg:px-8"
			style={{ animationDelay: "140ms" }}
			aria-labelledby="chronique-heading"
		>
			<Card className="relative overflow-hidden border-2 border-transparent hover:border-transparent transition-all duration-300 shadow-xl hover:shadow-2xl group">
				{/* Background gradient */}
				<div className="absolute inset-0 bg-linear-to-br from-rg-brique/5 via-transparent to-rg-brique/10 -z-10" />

				<CardHeader>
					<div className="flex items-center gap-3 mb-3">
						<div className="size-12 rounded-xl bg-linear-to-br from-rg-brique to-rg-brique-clair flex items-center justify-center shadow-lg">
							<Newspaper className="size-6 text-rg-sur-marine" />
						</div>
						<div>
							<h2
								id="chronique-heading"
								className="text-2xl sm:text-3xl font-bold bg-clip-text text-transparent bg-linear-to-r from-rg-brique to-rg-brique-clair"
							>
								Chroniques du Bouquet
							</h2>
							<p className="text-sm text-muted-foreground">
								Dernière actualité Rose Griffon
							</p>
						</div>
					</div>
				</CardHeader>

				<CardContent>
					<Link href={`/chroniques/${article.slug}`} className="block group">
						<div className="flex flex-col md:flex-row gap-3 md:gap-6">
							{/* Image */}
							<div className="w-full md:w-1/3 shrink-0">
								<div className="relative aspect-video md:aspect-auto md:h-full min-h-[200px] rounded-xl overflow-hidden shadow-lg">
									<Image
										src={article.featured_image_url || "/images/placeholder-chronicle.svg"}
										alt={article.title}
										fill
										sizes="(max-width: 768px) 100vw, 33vw"
										className="object-cover group-hover:scale-105 transition-transform duration-300"
									/>
									<div className="absolute inset-0 bg-linear-to-t from-rg-marine/60 to-transparent" />
								</div>
							</div>

							{/* Contenu */}
							<div className="flex-1 space-y-4">
								{/* Catégorie */}
								{article.category && (
									<Badge variant="outline" className="border-rg-brique text-rg-brique">
										{article.category}
									</Badge>
								)}

								{/* Titre */}
								<h3 className="text-2xl sm:text-3xl font-bold text-foreground group-hover:text-rg-brique dark:group-hover:text-rg-brique-clair transition-colors line-clamp-2">
									{article.title}
								</h3>

								{/* Extrait */}
								{article.excerpt && (
									<p className="text-base text-muted-foreground line-clamp-3">
										{article.excerpt}
									</p>
								)}

								{/* Meta */}
								<div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
									<div className="flex items-center gap-2">
										<Calendar className="size-4" />
										<time dateTime={article.published_at || article.created_at || ""}>
											{format(
												new Date(article.published_at || article.created_at || ""),
												"d MMMM yyyy",
												{ locale: fr }
											)}
										</time>
									</div>
									<div className="flex items-center gap-2">
										<Eye className="size-4" />
										<span>{article.view_count || 0} vues</span>
									</div>
								</div>

								{/* Bouton */}
								<Button
									variant="outline"
									className="group/btn border-rg-brique text-rg-brique hover:bg-rg-brique hover:text-rg-sur-marine transition-all"
								>
									Lire la chronique
									<ArrowRight className="size-4 ml-2 group-hover/btn:translate-x-1 transition-transform" />
								</Button>
							</div>
						</div>
					</Link>

					{/* Lien vers toutes les chroniques */}
					<div className="mt-6 pt-6 border-t border-border">
						<Link
							href="/news?format=chronique"
							className="inline-flex items-center gap-2 text-sm font-medium text-rg-brique hover:opacity-80 transition-colors group"
						>
							Voir toutes les chroniques
							<ArrowRight className="size-4 group-hover:translate-x-1 transition-transform" />
						</Link>
					</div>
				</CardContent>
			</Card>
		</section>
	);
}
