// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from "react";
import { kitCatalog, type KitName } from "../../kit-bridge";
import { isTauri } from "../../tauri-bridge";

/** Whether a kit surface belongs in the navigation: the kit answers (and, for admin, its access pack is imported). */
export function kitVisible(
  catalog: { admin?: boolean } | null,
  requireAdmin: boolean,
): boolean {
  return catalog !== null && (!requireAdmin || catalog.admin === true);
}

export function useKitVisible(kit: KitName, requireAdmin = false): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    kitCatalog(kit)
      .then((catalog) => {
        if (active) setVisible(kitVisible(catalog, requireAdmin));
        return undefined;
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [kit, requireAdmin]);
  return visible;
}
