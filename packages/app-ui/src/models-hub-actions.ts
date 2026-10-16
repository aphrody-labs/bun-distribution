// SPDX-License-Identifier: Apache-2.0
import type { CatalogEntry, InstalledModels } from "./tauri-bridge";

/** Keep the two inventories independent: a failed backend is never an empty store. */
export async function loadModelInventories(
  catalog: () => Promise<{ entries: CatalogEntry[] }>,
  installed: () => Promise<InstalledModels>,
) {
  const [entries, models] = await Promise.allSettled([catalog(), installed()]);
  const errors = [entries, models].flatMap((result, index) =>
    result.status === "rejected"
      ? [
          `${index === 0 ? "Catalogue" : "Stockage"} : ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
        ]
      : [],
  );
  return {
    catalog: entries.status === "fulfilled" ? entries.value.entries : undefined,
    installed: models.status === "fulfilled" ? models.value : undefined,
    error: errors.join(" · "),
  };
}

/** The transfer must acknowledge cancellation before the UI permits a resume. */
export async function stopModelDownload(
  id: string,
  cancel: (id: string) => Promise<boolean>,
) {
  if (!(await cancel(id)))
    throw new Error(
      "Aucun téléchargement actif à arrêter ; actualisez le stockage.",
    );
}

/** Only explicitly catalogued chat models can be selected as chat defaults. */
export function isChatModel(
  entry: Pick<CatalogEntry, "task"> | undefined,
): boolean {
  return entry?.task === "chat" || entry?.task === "text-generation";
}
