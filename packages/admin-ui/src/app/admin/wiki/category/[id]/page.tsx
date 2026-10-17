import { db } from "@/lib/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteCategory, updateCategory } from "../../_actions";

export const dynamic = "force-dynamic";

export default async function EditCategoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const category = await db.query.wikiCategories.findFirst({
    where: (c, { eq }) => eq(c.id, id),
  });
  if (!category) notFound();

  // Catégories sélectionnables comme parent : toutes sauf elle-même.
  const allCategories = await db.query.wikiCategories.findMany({
    orderBy: (c, { asc }) => asc(c.order),
  });
  const parents = allCategories.filter(c => c.id !== category.id);

  const update = updateCategory.bind(null, category.id);
  const remove = deleteCategory.bind(null, category.id);

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="flex items-center justify-between gap-4 mb-8">
        <Link href="/admin/wiki" className="font-saiyan text-dbz-blue-light hover:text-dbz-orange uppercase">
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
      <h1 className="text-4xl font-saiyan text-dbz-orange mb-8">ÉDITER : {category.name}</h1>

      <form action={update} className="dbz-panel p-6 space-y-4">
        <div>
          <label htmlFor="cat-nom" className="block text-xs uppercase tracking-widest text-dbz-blue-light mb-2">
            Nom
          </label>
          <input
            id="cat-nom"
            name="name"
            required
            defaultValue={category.name}
            className="w-full p-3 bg-dbz-bg border-2 border-dbz-border focus:border-dbz-orange outline-none font-bold text-white"
            placeholder="Ex: Personnages"
          />
        </div>
        <div>
          <label htmlFor="cat-parent" className="block text-xs uppercase tracking-widest text-dbz-blue-light mb-2">
            Catégorie parente (optionnel)
          </label>
          <select
            id="cat-parent"
            name="parentId"
            defaultValue={category.parentId ?? ""}
            className="w-full p-3 bg-dbz-bg border-2 border-dbz-border focus:border-dbz-orange outline-none text-white"
          >
            <option value="">— Aucune (racine) —</option>
            {parents.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="cat-ordre" className="block text-xs uppercase tracking-widest text-dbz-blue-light mb-2">
            Ordre
          </label>
          <input
            id="cat-ordre"
            type="number"
            name="order"
            defaultValue={category.order}
            className="w-full p-3 bg-dbz-bg border-2 border-dbz-border focus:border-dbz-orange outline-none text-white"
          />
        </div>
        <button type="submit" className="dbz-button w-full !text-lg mt-6">
          ENREGISTRER
        </button>
      </form>
    </div>
  );
}
