import { Button, Card, CardContent, CardHeader, CardTitle, AdminPageHeader, PaginationControls } from "@rosegriffon/ui";
import { Calendar, Plus } from "lucide-react";
import Link from "next/link";

import { SyncEventsButton } from "@/components/admin/events/sync-button";

import { createPostgresClient } from "@rosegriffon/db/service";
import type { Tables } from "@rosegriffon/db";

export const dynamic = "force-dynamic";

interface EventsPageProps {
  searchParams: Promise<{
    page?: string;
  }>;
}

export default async function EventsPage({ searchParams }: EventsPageProps) {
  const params = await searchParams;
  const page = Number(params.page) || 1;
  const limit = 12;
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const { data: events, count } = await createPostgresClient()
    .from("events")
    .select("*", { count: "exact" })
    .order("start_time", { ascending: true }) // Sort by start_time usually makes more sense for a calendar list
    .range(from, to);

  const totalPages = count ? Math.ceil(count / limit) : 1;

  return (
    <div className="p-6 space-y-6">
      <AdminPageHeader
        title="Événements"
        description="Gérez les événements à venir et passés."
        actions={
          <div className="flex gap-2">
            <SyncEventsButton />
            <Button asChild>
              <Link href="/admin/events/new">
                <Plus className="size-4 mr-2" />
                Nouvel Événement
              </Link>
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {events?.map((event: Tables<"events">) => (
          <Card key={event.id}>
            <CardHeader>
              <CardTitle className="line-clamp-1">{event.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center text-sm text-muted-foreground mb-4">
                <Calendar className="size-4 mr-2" />
                {event.start_time ? new Date(event.start_time).toLocaleDateString("fr-FR") : "Date inconnue"}
              </div>
              <p className="text-sm line-clamp-3 mb-4 min-h-[60px]">{event.description || "Pas de description"}</p>
              <Button variant="outline" className="w-full" asChild>
                <Link href={`/admin/events/${event.id}/edit`}>Modifier</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
        {(!events || events.length === 0) && (
          <div className="col-span-full text-center py-12 text-muted-foreground bg-muted/30 rounded-lg border-2 border-dashed">
            <Calendar className="size-12 mx-auto mb-4 text-muted-foreground/50" />
            <p>Aucun événement trouvé.</p>
            <p className="text-sm">Synchronisez avec Google Calendar ou créez-en un manuellement.</p>
          </div>
        )}
      </div>

      <PaginationControls currentPage={page} totalPages={totalPages} baseUrl="/admin/events" />
    </div>
  );
}
