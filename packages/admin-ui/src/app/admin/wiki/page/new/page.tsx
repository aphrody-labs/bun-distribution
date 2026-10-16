import { WikiEditor } from "@/components/wiki/WikiEditor";
import { db } from "@/lib/db";
import Link from "next/link";
import { createPage } from "../../_actions";

export const dynamic = "force-dynamic";

export default async function NewWikiPagePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const params = await searchParams;
  const allCategories = await db.query.wikiCategories.findMany({
    orderBy: (c, { asc }) => asc(c.order),
  });

  return (
    <div className="w-full max-w-6xl mx-auto">
      <div className="flex items-center gap-4 mb-8">
        <Link
          href="/admin/wiki"
          className="font-saiyan text-dbz-blue-light hover:text-dbz-orange uppercase"
        >
          ← RETOUR
        </Link>
      </div>
      <h1 className="text-4xl font-saiyan text-dbz-orange mb-8">NOUVELLE PAGE WIKI</h1>

      <WikiEditor
        categories={allCategories.map((c) => ({ id: c.id, name: c.name }))}
        action={createPage}
        defaultCategoryId={params.category}
        submitLabel="CRÉER"
      />
    </div>
  );
}
