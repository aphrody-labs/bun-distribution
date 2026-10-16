import { Button } from "@rosegriffon/ui";
import Link from "next/link";

import { MediaManager } from "@/components/admin/media/media-manager";

import { ChevronLeft, ChevronRight } from "@/lib/icons-config";
import { createPostgresClient } from "@rosegriffon/db/service";

export const dynamic = "force-dynamic";

interface MediaPageProps {
	searchParams: Promise<{
		page?: string;
		query?: string;
	}>;
}

export default async function MediaPage({ searchParams }: MediaPageProps) {
	const params = await searchParams;
	const page = Number(params.page) || 1;
	const query = params.query || "";
	const limit = 24;
	const offset = (page - 1) * limit;

	const supabase = createPostgresClient();
	if (!supabase) {
		return (
			<div className="p-6">
				<h1 className="text-3xl font-bold">Médiathèque</h1>
				<p className="mt-2 text-muted-foreground">Service indisponible.</p>
			</div>
		);
	}

	const { data: files, error } = await supabase.storage.from("assets").list(undefined, {
		limit: limit + 1,
		offset: offset,
		search: query,
		sortBy: { column: "created_at", order: "desc" },
	});

	if (error) {
		console.error("Error fetching media:", error);
	}

	const hasNextPage = (files?.length || 0) > limit;
	const displayFiles = files?.slice(0, limit) || [];

	return (
		<div className="p-6 space-y-6">
			<h1 className="text-3xl font-bold">Médiathèque</h1>
			{error ? (
				<div className="p-4 border border-red-200 bg-red-50 text-red-700 rounded-md">
					Erreur lors du chargement des médias.
					<br />
					<span className="text-sm opacity-80">{error.message}</span>
				</div>
			) : (
				<>
					<MediaManager initialFiles={displayFiles} />

					<div className="flex items-center justify-between mt-6">
						<div className="text-sm text-muted-foreground">Page {page}</div>
						<div className="flex gap-2">
							<Button variant="outline" size="sm" disabled={page <= 1} asChild>
								<Link href={`/admin/media?page=${page - 1}${query ? `&query=${query}` : ""}`}>
									<ChevronLeft className="size-4 mr-2" />
									Précédent
								</Link>
							</Button>
							<Button variant="outline" size="sm" disabled={!hasNextPage} asChild>
								<Link href={`/admin/media?page=${page + 1}${query ? `&query=${query}` : ""}`}>
									Suivant
									<ChevronRight className="size-4 ml-2" />
								</Link>
							</Button>
						</div>
					</div>
				</>
			)}
		</div>
	);
}
