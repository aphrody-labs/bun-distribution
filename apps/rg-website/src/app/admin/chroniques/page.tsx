import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  DashboardStatsCard as StatsCard,
  AdminPageHeader,
  PaginationControls,
  StorageImage,
} from "@rosegriffon/ui";
import { BarChart3, Calendar, Eye, FileText, Filter, Plus, Search } from "lucide-react";
import Link from "next/link";

import { ChronicleActions } from "@/components/admin/chronicles/chronicle-actions";

import { getArticleStats, getArticles } from "@/lib/api/articles";

export default async function ChroniquesAdminPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    category?: string;
    page?: string;
  }>;
}) {
  const params = await searchParams;
  const query = params.q || "";
  const statusFilter = params.status || "all";
  const categoryFilter = params.category || "all";
  const page = Number(params.page) || 1;

  const [articlesRes, stats] = await Promise.all([
    getArticles({
      category: categoryFilter,
      limit: 20, // Reduced from 50 to 20 for better pagination UX
      page,
      query,
      status: statusFilter,
    }),
    getArticleStats(),
  ]);

  const filteredChronicles = articlesRes.data;
  const { totalPages } = articlesRes.meta;
  const { total: totalChronicles, published: publishedCount, draft: draftCount, categories } = stats;

  return (
    <div className="p-3 sm:p-4 md:p-6 lg:p-8 space-y-4 sm:space-y-6 md:space-y-8">
      <AdminPageHeader
        title="Chroniques du Bouquet"
        description="Gérez les articles et chroniques de Rose Griffon"
        actions={
          <Button
            asChild
            size="sm"
            className="bg-linear-to-r from-rg-rose to-rg-or hover:opacity-90 text-white w-full sm:w-auto"
          >
            <Link href="/admin/chroniques/new" className="flex items-center justify-center">
              <Plus className="size-4 sm:mr-2" />
              <span className="hidden sm:inline">Nouvelle Chronique</span>
              <span className="sm:hidden">Nouvelle</span>
            </Link>
          </Button>
        }
      />

      {/* Statistiques */}
      <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        <StatsCard
          title="Total Chroniques"
          value={totalChronicles}
          description="Articles et chroniques"
          icon={FileText}
          className="border-l-4 border-l-blue-500"
        />
        <StatsCard
          title="Publiés"
          value={publishedCount}
          description="Visibles publiquement"
          icon={Eye}
          className="border-l-4 border-l-green-500"
        />
        <StatsCard
          title="Brouillons"
          value={draftCount}
          description="En cours de rédaction"
          icon={BarChart3}
          className="border-l-4 border-l-amber-500 sm:col-span-2 lg:col-span-1"
        />
      </div>

      {/* Filtres */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Filter className="size-5" />
            Filtres et Recherche
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3 sm:gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input placeholder="Rechercher..." className="pl-8 text-sm" name="q" defaultValue={query} />
            </div>

            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
              <Select name="status" defaultValue={statusFilter}>
                <SelectTrigger className="w-full sm:flex-1">
                  <SelectValue placeholder="Statut" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les statuts</SelectItem>
                  <SelectItem value="published">Publiés</SelectItem>
                  <SelectItem value="draft">Brouillons</SelectItem>
                </SelectContent>
              </Select>

              <Select name="category" defaultValue={categoryFilter}>
                <SelectTrigger className="w-full sm:flex-1">
                  <SelectValue placeholder="Catégorie" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes catégories</SelectItem>
                  {categories.map(cat => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button type="submit" variant="outline" className="w-full sm:w-auto">
                Appliquer
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Grille de chroniques */}
      {filteredChronicles.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <FileText className="size-16 text-muted-foreground/30 mb-4" />
            <h3 className="text-xl font-semibold mb-2">Aucune chronique trouvée</h3>
            <p className="text-muted-foreground mb-6">
              {query ? "Aucun résultat pour votre recherche" : "Commencez par créer votre première chronique"}
            </p>
            {!query && (
              <Button asChild>
                <Link href="/admin/chroniques/new">
                  <Plus className="size-4 mr-2" />
                  Créer une chronique
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:gap-5 md:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {filteredChronicles.map(chronicle => {
            const isPublished = chronicle.status === "published";
            return (
              <Card
                key={chronicle.id}
                className="group overflow-hidden hover:shadow-lg transition-all duration-300 border-border/50 flex flex-col"
              >
                {/* Image à la une */}
                <div className="relative h-40 sm:h-48 w-full overflow-hidden bg-muted shrink-0">
                  {chronicle.featured_image_url ? (
                    <StorageImage
                      src={chronicle.featured_image_url}
                      alt={chronicle.title}
                      fill
                      className="object-cover group-hover:scale-105 transition-transform duration-500"
                      unoptimized
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      <FileText className="size-12 sm:w-16 sm:h-16 opacity-20" />
                    </div>
                  )}
                  <div className="absolute top-2 sm:top-3 right-2 sm:right-3">
                    <Badge
                      variant={isPublished ? "default" : "secondary"}
                      className={
                        isPublished
                          ? "bg-green-500 hover:bg-green-600 shadow-lg text-xs"
                          : "bg-amber-500 hover:bg-amber-600 shadow-lg text-xs"
                      }
                    >
                      {isPublished ? "Publié" : "Brouillon"}
                    </Badge>
                  </div>
                </div>

                {/* Contenu */}
                <CardHeader className="space-y-2 p-4 sm:p-6 flex-1">
                  <div className="flex items-center gap-1.5 sm:gap-2 text-xs text-muted-foreground">
                    <Calendar className="size-3 shrink-0" />
                    <span className="truncate">
                      {new Date(chronicle.created_at || "").toLocaleDateString("fr-FR", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                  </div>
                  <CardTitle className="line-clamp-2 text-base sm:text-lg group-hover:text-[#B03519] transition-colors">
                    {chronicle.title}
                  </CardTitle>
                  {chronicle.category && (
                    <Badge variant="outline" className="w-fit text-xs">
                      {chronicle.category}
                    </Badge>
                  )}
                </CardHeader>

                <CardContent className="space-y-3 sm:space-y-4 p-4 sm:p-6 pt-0 sm:pt-0">
                  <p className="text-xs sm:text-sm text-muted-foreground line-clamp-2 sm:line-clamp-3">
                    {chronicle.excerpt || "Pas de résumé"}
                  </p>

                  <div className="flex items-center justify-between pt-2 border-t gap-2">
                    <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">/{chronicle.slug}</span>
                    <ChronicleActions id={chronicle.id} published={isPublished} />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-8">
          <PaginationControls currentPage={page} totalPages={totalPages} baseUrl="/admin/chroniques" />
        </div>
      )}
    </div>
  );
}
