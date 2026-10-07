// SPDX-License-Identifier: Apache-2.0
// Administration: the omar-kit console (install, private tunnel, MCP, checks, training over SSH,
// « Mon PC ») as panels. The logic stays in packages/infra/product.
import { KitSurface } from "../kit/KitSurface";

export function AdminRoute() {
  return (
    <KitSurface
      kit="omar"
      title="Administration"
      intro="Installer et réparer les outils, se connecter aux serveurs de l’équipe, tout vérifier en un clic, entraîner un modèle et surveiller ce PC."
    />
  );
}
