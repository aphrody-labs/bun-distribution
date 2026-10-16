export const dynamic = "force-dynamic";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@rosegriffon/ui";
import { ArrowLeft, PenSquare } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ArticleEditor } from "@/components/articles/ArticleEditor";
import { createPostgresClient } from "@rosegriffon/db/service";

import { getServerUser } from "@/lib/auth-helpers";

export default async function EditArticlePage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const user = await getServerUser();
	if (!user) {
		redirect("/login");
	}

	const supabase = createPostgresClient();

	// Récupérer l'article
	const { data: article } = await supabase
		.from("articles")
		.select("*")
		.eq("id", id)
		.eq("app", "website")
		.single();

	if (!article) {
		redirect("/dashboard/articles");
	}

	// Vérifier que l'utilisateur est l'auteur ou admin
	const { data: profile } = await supabase
		.from("profiles")
		.select("role")
		.eq("id", user.id)
		.single();

	const isAuthor = article.author_id === user.id;
	const isAdmin = profile?.role === "admin";

	if (!isAuthor && !isAdmin) {
		redirect("/dashboard/articles");
	}

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
						Retour aux Chroniques
					</Link>

					<div className="flex items-center gap-3">
						<div className="size-12 rounded-xl bg-linear-to-br from-indigo-500 to-indigo-600 flex items-center justify-center">
							<PenSquare className="size-6 text-white" />
						</div>
						<div>
							<h1 className="text-3xl sm:text-4xl font-bold bg-clip-text text-transparent bg-linear-to-r from-indigo-500 to-indigo-600">
								Éditer la Chronique
							</h1>
							<p className="text-base text-gray-600 dark:text-gray-400 mt-1">{article.title}</p>
						</div>
					</div>
				</div>

				{/* Editor Card */}
				<Card className="shadow-lg">
					<CardHeader>
						<CardTitle>Modifier votre chronique</CardTitle>
						<CardDescription>Apportez les modifications nécessaires à votre entrée</CardDescription>
					</CardHeader>
					<CardContent>
						<ArticleEditor categories={categories} userId={user.id} initialData={article} />
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
