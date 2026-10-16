export const dynamic = "force-dynamic";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@rosegriffon/ui";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createPostgresClient } from "@rosegriffon/db/service";

import { ArticleEditor } from "@/components/articles/ArticleEditor";

import { getServerUser } from "@/lib/auth-helpers";
import { ArrowLeft, PenSquare } from "@/lib/icons-config";

export default async function NewArticlePage() {
	const user = await getServerUser();
	if (!user) {
		redirect("/login");
	}

	const supabase = createPostgresClient();

	// Récupérer les catégories
	const { data: categoriesData } = await supabase
		.from("article_categories")
		.select("*")
		.order("name");

	const categories = categoriesData || [];

	return (
		<div className="min-h-screen bg-linear-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
			<div className="container mx-auto p-4 sm:p-6 lg:p-8 max-w-5xl">
				{/* Header */}
				<div className="mb-8">
					<Link
						href="/dashboard/articles"
						className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-[#a14b3f] transition-colors mb-4"
					>
						<ArrowLeft className="size-4" />
						Retour aux Articles
					</Link>

					<div className="flex items-center gap-3">
						<div className="size-12 rounded-xl bg-linear-to-br from-indigo-500 to-indigo-600 flex items-center justify-center">
							<PenSquare className="size-6 text-white" />
						</div>
						<div>
							<h1 className="text-3xl sm:text-4xl font-bold bg-clip-text text-transparent bg-linear-to-r from-indigo-500 to-indigo-600">
								Nouvelle Chronique
							</h1>
							<p className="text-base text-gray-600 dark:text-gray-400 mt-1">
								Informez la communauté des dernières actualités
							</p>
						</div>
					</div>
				</div>

				{/* Editor Card */}
				<Card className="shadow-lg">
					<CardHeader>
						<CardTitle>Éditeur de chronique</CardTitle>
						<CardDescription>
							Rédigez une nouvelle entrée du journal de bord Rose Griffon
						</CardDescription>
					</CardHeader>
					<CardContent>
						<ArticleEditor categories={categories} userId={user.id} />
					</CardContent>
				</Card>

				{/* Tips */}
				<Card className="mt-6 border-l-4 border-l-blue-500">
					<CardContent className="p-6">
						<h3 className="font-semibold mb-3 flex items-center gap-2">
							<PenSquare className="size-5 text-blue-500" />
							Conseils rapides
						</h3>
						<ul className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
							<li className="flex items-start gap-2">
								<span className="text-blue-500 mt-1">•</span>
								<span>
									<strong>Titre :</strong> Clair et accrocheur (50-60 caractères idéal)
								</span>
							</li>
							<li className="flex items-start gap-2">
								<span className="text-blue-500 mt-1">•</span>
								<span>
									<strong>Extrait :</strong> Résumé en 1-2 phrases (150 caractères max)
								</span>
							</li>
							<li className="flex items-start gap-2">
								<span className="text-blue-500 mt-1">•</span>
								<span>
									<strong>Image :</strong> Format recommandé 1200x630px (ratio 16:9)
								</span>
							</li>
							<li className="flex items-start gap-2">
								<span className="text-blue-500 mt-1">•</span>
								<span>
									<strong>Contenu :</strong> Structurez avec des sous-titres (H2, H3)
								</span>
							</li>
						</ul>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
