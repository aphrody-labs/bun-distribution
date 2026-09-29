"use client";

/**
 * Formulaire de page wiki (création et édition).
 *
 * Le corps de la page passe désormais par le module d'édition unique
 * (`components/editor`) : édition riche, vue source markdown/HTML, aperçu avec
 * le **vrai** rendu public, upload d'images par glisser-déposer, menu « / » et
 * barre d'outils mobile collée au clavier. Le formulaire, lui, ne connaît que le
 * markdown : c'est ce que la table stocke, ce que lit le RAG et ce que rendent
 * les commandes Discord.
 */
import { useId, useState } from "react";

import { ShenronEditor } from "@/components/editor";
import { WikiMarkdown } from "@/components/wiki/WikiMarkdown";

type Category = { id: string; name: string };

export function WikiEditor({
	categories,
	action,
	initial,
	submitLabel,
	defaultCategoryId,
}: {
	categories: Category[];
	action: (formData: FormData) => void | Promise<void>;
	initial?: {
		title?: string;
		categoryId?: string;
		body?: string;
		order?: number;
	};
	submitLabel: string;
	defaultCategoryId?: string;
}) {
	const idTitre = useId();
	const idCategorie = useId();
	const idOrdre = useId();
	const [body, setBody] = useState(initial?.body ?? "");

	return (
		<form action={action} className="space-y-4">
			<div className="dbz-panel space-y-4 p-6">
				<div>
					<label
						htmlFor={idTitre}
						className="mb-2 block text-xs uppercase tracking-widest text-dbz-blue-light"
					>
						Titre
					</label>
					<input
						id={idTitre}
						name="title"
						required
						defaultValue={initial?.title}
						className="w-full border-2 border-dbz-border bg-dbz-bg p-3 font-bold text-white outline-none focus:border-dbz-orange"
						placeholder="Ex: Goku Saiyan"
					/>
				</div>
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
					<div className="sm:col-span-2">
						<label
							htmlFor={idCategorie}
							className="mb-2 block text-xs uppercase tracking-widest text-dbz-blue-light"
						>
							Catégorie
						</label>
						<select
							id={idCategorie}
							name="categoryId"
							required
							defaultValue={initial?.categoryId ?? defaultCategoryId ?? ""}
							className="w-full border-2 border-dbz-border bg-dbz-bg p-3 text-white outline-none focus:border-dbz-orange"
						>
							<option value="">— Sélectionner —</option>
							{categories.map((c) => (
								<option key={c.id} value={c.id}>
									{c.name}
								</option>
							))}
						</select>
					</div>
					<div>
						<label
							htmlFor={idOrdre}
							className="mb-2 block text-xs uppercase tracking-widest text-dbz-blue-light"
						>
							Ordre
						</label>
						<input
							id={idOrdre}
							type="number"
							name="order"
							defaultValue={initial?.order ?? 0}
							className="w-full border-2 border-dbz-border bg-dbz-bg p-3 text-white outline-none focus:border-dbz-orange"
						/>
					</div>
				</div>
			</div>

			{/* Le module d'édition ne produit pas de champ de formulaire : un champ
			    caché alimente le FormData de la Server Action. */}
			<input type="hidden" name="body" value={body} />

			<ShenronEditor
				format="markdown"
				preset="wiki"
				value={initial?.body ?? ""}
				onChangeMarkdown={setBody}
				uploadSubdir="pages"
				autosaveKey={`wiki-page:${initial?.title ? initial.title : "nouvelle"}`}
				autosaveLabel={initial?.title}
				placeholder="Racontez la page… tapez « / » pour insérer un bloc."
				minHeight="28rem"
				maxHeight="70vh"
				ariaLabel="Contenu de la page wiki"
				renderPreview={(source) =>
					source.trim() ? (
						<WikiMarkdown body={source} />
					) : (
						<p className="italic text-gray-600">L&apos;aperçu s&apos;affiche ici…</p>
					)
				}
			/>

			<button type="submit" className="dbz-button mt-2 w-full !text-lg">
				{submitLabel}
			</button>
		</form>
	);
}
