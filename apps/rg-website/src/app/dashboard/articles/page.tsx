export const dynamic = "force-dynamic";

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@rosegriffon/ui";
import { Calendar, ChevronRight, Edit, Eye, FileText, PenSquare, Plus, Trash2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createPostgresClient } from "@rosegriffon/db/service";

import { getServerUser } from "@/lib/auth-helpers";

interface Article {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string;
  featured_image_url: string | null;
  category: string | null;
  status: string;
  published_at: string;
  view_count: number;
  author_id: string;
  created_at: string;
  updated_at: string;
}

export default async function ArticlesPage() {
  const supabase = createPostgresClient();

  const user = await getServerUser();
  if (!user) {
    redirect("/login");
  }

  // Récupérer les articles de l'utilisateur
  const { data: articlesData } = await supabase
    .from("articles")
    .select("*")
    .eq("author_id", user.id)
    .eq("app", "website")
    .order("updated_at", { ascending: false });

  const articles = (articlesData || []) as unknown as Article[];

  // Statistiques
  const stats = {
    drafts: articles.filter(a => a.status === "draft").length || 0,
    published: articles.filter(a => a.status === "published").length || 0,
    total: articles.length || 0,
    totalViews: articles.reduce((sum, a) => sum + (a.view_count || 0), 0) || 0,
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "published": {
        return <Badge className="bg-green-500">Publié</Badge>;
      }
      case "draft": {
        return <Badge variant="secondary">Brouillon</Badge>;
      }
      case "archived": {
        return <Badge variant="outline">Archivé</Badge>;
      }
      default: {
        return <Badge>{status}</Badge>;
      }
    }
  };

  return (
    <div className="min-h-screen bg-linear-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
            >
              <ChevronRight className="size-6 rotate-180" />
            </Link>
            <div>
              <div className="size-12 rounded-xl bg-linear-to-br from-indigo-500 to-indigo-600 flex items-center justify-center">
                <FileText className="size-6 text-white" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-3xl sm:text-4xl font-bold bg-clip-text text-transparent bg-linear-to-r from-indigo-500 to-indigo-600">
                  Mes Articles
                </h1>
              </div>
            </div>
          </div>

          <Button asChild>
            <Link href="/dashboard/articles/new">
              <Plus className="size-5 mr-2" />
              Nouvel Article
            </Link>
          </Button>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="border-l-4 border-l-indigo-500">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">Total</div>
                  <div className="text-2xl font-bold">{stats.total}</div>
                </div>
                <FileText className="size-8 text-indigo-500 opacity-50" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-green-500">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">Publiés</div>
                  <div className="text-2xl font-bold">{stats.published}</div>
                </div>
                <Eye className="size-8 text-green-500 opacity-50" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-yellow-500">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">Brouillons</div>
                  <div className="text-2xl font-bold">{stats.drafts}</div>
                </div>
                <Edit className="size-8 text-yellow-500 opacity-50" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-purple-500">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">Vues totales</div>
                  <div className="text-2xl font-bold">{stats.totalViews}</div>
                </div>
                <Eye className="size-8 text-purple-500 opacity-50" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Articles List */}
        {!articles || articles.length === 0 ? (
          <Card className="shadow-lg">
            <CardContent className="p-12">
              <div className="text-center">
                <PenSquare className="size-16 mx-auto text-gray-300 dark:text-gray-700 mb-4" />
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                  Aucune chronique pour le moment
                </h2>
                <p className="text-gray-600 dark:text-gray-400 mb-6">
                  Commencez à rédiger votre première chronique et informez la communauté des dernières actualités de
                  Rose Griffon
                </p>
                <Button asChild size="lg">
                  <Link href="/dashboard/articles/new">
                    <Plus className="size-5 mr-2" />
                    Créer ma première chronique
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {articles.map(article => (
              <Card key={article.id} className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        {getStatusBadge(article.status)}
                        {article.category && <Badge variant="outline">{article.category}</Badge>}
                      </div>
                      <CardTitle className="text-xl line-clamp-2">{article.title}</CardTitle>
                      <CardDescription className="line-clamp-2 mt-1">
                        {article.excerpt || "Pas d'extrait"}
                      </CardDescription>
                    </div>

                    {article.featured_image_url && (
                      <div className="hidden sm:block size-24 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 shrink-0 relative">
                        <Image src={article.featured_image_url} alt={article.title} fill className="object-cover" />
                      </div>
                    )}
                  </div>
                </CardHeader>

                <CardContent>
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
                      <div className="flex items-center gap-1">
                        <Eye className="size-4" />
                        {article.view_count || 0} vues
                      </div>
                      <div className="flex items-center gap-1">
                        <Calendar className="size-4" />
                        {new Date(article.updated_at).toLocaleDateString("fr-FR")}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      {article.status === "published" && (
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/news/${article.slug}`} target="_blank">
                            <Eye className="size-4" />
                          </Link>
                        </Button>
                      )}
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/dashboard/articles/${article.id}/edit`}>
                          <Edit className="size-4" />
                        </Link>
                      </Button>
                      <Button variant="outline" size="sm" className="text-red-500 hover:text-red-600">
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Info Card */}
        <Card className="mt-8 border-l-4 border-l-indigo-500">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PenSquare className="size-5 text-indigo-500" />
              Conseils de rédaction
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
              <li className="flex items-start gap-2">
                <span className="text-indigo-500 mt-1">•</span>
                <span>Utilisez des titres accrocheurs pour capter l'attention</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-indigo-500 mt-1">•</span>
                <span>Ajoutez toujours une image à la une pour illustrer votre propos</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-indigo-500 mt-1">•</span>
                <span>Rédigez d'abord en brouillon, relisez, puis publiez</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-indigo-500 mt-1">•</span>
                <span>Utilisez les catégories et tags pour organiser vos contenus</span>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
