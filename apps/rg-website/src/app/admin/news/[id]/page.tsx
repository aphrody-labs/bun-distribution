import { notFound } from "next/navigation";
import { createPostgresClient } from "@rosegriffon/db/service";
import { NewsEditorLoader } from "../NewsEditorLoader";

interface EditNewsPageProps {
	params: Promise<{ id: string }>;
}

export default async function EditNewsPage({ params }: EditNewsPageProps) {
	const { id } = await params;
	const { data: news, error } = await createPostgresClient()
		.from("articles")
		.select("*")
		.eq("id", id)
		.eq("app", "azalee")
		.maybeSingle();

	if (error || !news) {
		notFound();
	}

	return <NewsEditorLoader initialData={news} />;
}
