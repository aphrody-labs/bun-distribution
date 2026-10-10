// SPDX-License-Identifier: Apache-2.0
// Creator tools: the creator-kit commands (Challonge, wiki images, compression, Adobe and disk
// cleaning, video subtitles, update, crash report) as forms. The logic stays in
// packages/infra/product.
import { KitSurface } from "../kit/KitSurface";

export function CreatorRoute() {
  return (
    <KitSurface
      kit="creator"
      title="Créateur"
      intro="Tournois, images, nettoyage du PC et sous-titres : chaque outil s’exécute sur ce PC."
    />
  );
}
