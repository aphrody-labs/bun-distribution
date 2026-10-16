import { WikiEditor } from "@/components/wiki/WikiEditor";
import { db } from "@/lib/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deletePage, updatePage } from "../../_actions";

export const dynamic = "force-dynamic";

export default async function EditWikiPagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const page = await db.query.wikiPages.findFirst({
    where: (p, { eq }) => eq(p.id, id),
  });
  if (!page) notFound();

  const allCategories = await db.query.wikiCategories.findMany({
    orderBy: (c, { asc }) => asc(c.order),
  });

  const update = updatePage.bind(null, page.id);
  const remove = deletePage.bind(null, page.id);

  return (
    <div className="w-full max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-4 mb-8">
        <Link
          href="/admin/wiki"
          className="font-saiyan text-dbz-blue-light hover:text-dbz-orange uppercase"
        >
          ← RETOUR
        </Link>
        <form action={remove}>
          <button
            type="submit"
            className="font-saiyan text-sm text-red-400 hover:text-red-300 uppercase tracking-wider"
          >
            SUPPRIMER
          </button>
        </form>
      </div>
      <h1 className="text-4xl font-saiyan text-dbz-orange mb-8">
        ÉDITER : {page.title}
      </h1>

      <WikiEditor
        categories={allCategories.map((c) => ({ id: c.id, name: c.name }))}
        action={update}
        initial={{
          title: page.title,
          categoryId: page.categoryId,
          body: page.body,
          order: page.order,
        }}
        submitLabel="ENREGISTRER"
      />
    </div>
  );
}
