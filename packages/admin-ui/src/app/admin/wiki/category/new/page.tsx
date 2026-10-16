import { db } from "@/lib/db";
import Link from "next/link";
import { createCategory } from "../../_actions";

export const dynamic = "force-dynamic";

export default async function NewCategoryPage() {
  const allCategories = await db.query.wikiCategories.findMany({
    orderBy: (c, { asc }) => asc(c.order),
  });

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="flex items-center gap-4 mb-8">
        <Link
          href="/admin/wiki"
          className="font-saiyan text-dbz-blue-light hover:text-dbz-orange uppercase"
        >
          ← RETOUR
        </Link>
      </div>
      <h1 className="text-4xl font-saiyan text-dbz-orange mb-8">
        NOUVELLE CATÉGORIE
      </h1>

      <form action={createCategory} className="dbz-panel p-6 space-y-4">
        <div>
          <label
            htmlFor="cat-nom"
            className="block text-xs uppercase tracking-widest text-dbz-blue-light mb-2"
          >
            Nom
          </label>
          <input
            id="cat-nom"
            name="name"
            required
            className="w-full p-3 bg-dbz-bg border-2 border-dbz-border focus:border-dbz-orange outline-none font-bold text-white"
            placeholder="Ex: Personnages"
          />
        </div>
        <div>
          <label
            htmlFor="cat-parent"
            className="block text-xs uppercase tracking-widest text-dbz-blue-light mb-2"
          >
            Catégorie parente (optionnel)
          </label>
          <select
            id="cat-parent"
            name="parentId"
            className="w-full p-3 bg-dbz-bg border-2 border-dbz-border focus:border-dbz-orange outline-none text-white"
          >
            <option value="">— Aucune (racine) —</option>
            {allCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor="cat-ordre"
            className="block text-xs uppercase tracking-widest text-dbz-blue-light mb-2"
          >
            Ordre
          </label>
          <input
            id="cat-ordre"
            type="number"
            name="order"
            defaultValue={0}
            className="w-full p-3 bg-dbz-bg border-2 border-dbz-border focus:border-dbz-orange outline-none text-white"
          />
        </div>
        <button type="submit" className="dbz-button w-full !text-lg mt-6">
          CRÉER
        </button>
      </form>
    </div>
  );
}
