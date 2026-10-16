/**
 * @file shop-config.ts
 * @description Parser for shop_config files
 *
 * Parses shop_config_*.cfg.bin.json to extract shop inventories.
 *
 * Structure:
 * SHOP_INFO_x
 *   [0] = Shop ID
 *   [1] = Shop Name Hash -> links to shop_text
 *   Children: SHOP_INFO_ITEM_LIST_BEG_x
 *     Children: SHOP_INFO_ITEM_y
 *       [0] = Item ID Hash
 */

import type { ConfigNode } from "../core/config-parser.js";
import { findConfigFile, loadConfig } from "../core/data-loader.js";

export interface ShopItem {
  itemId: number; // Unsigned Int
}

export interface ShopInfo {
  shopId: number;
  nameHash: number;
  items: Set<number>; // Set of Item IDs
}

/**
 * Load and parse shop config
 */
export function loadShopConfig(_dataPath: string): ShopInfo[] {
  const filename = findConfigFile("shop", "shop_config_");
  if (!filename) {
    console.warn("[shop-config] No SQL/SQLite shop_config projection found.");
    return [];
  }
  const entries = loadConfig("shop", filename).children as ConfigNode[];
  const shops: ShopInfo[] = [];

  function parseShopNode(node: ConfigNode): ShopInfo | null {
    const vars = node.variables;
    if (vars.length < 2) return null;

    // [0] = Shop ID
    const shopIdVar = vars[0];
    if (shopIdVar.type !== "Int") return null;
    const shopId = Number.parseInt(shopIdVar.value, 10) >>> 0;

    // [1] = Name Hash
    const nameVar = vars[1];
    if (!nameVar || nameVar.type !== "Int") return null;
    const nameHash = Number.parseInt(nameVar.value, 10) >>> 0;

    const items = new Set<number>();

    // Parse children (Items)
    if (node.children) {
      for (const listChild of node.children) {
        if (listChild.name.startsWith("SHOP_INFO_ITEM_LIST_BEG_")) {
          if (listChild.children) {
            for (const itemNode of listChild.children) {
              if (itemNode.name.startsWith("SHOP_INFO_ITEM_")) {
                const itemVars = itemNode.variables;
                // Item ID is at index 2
                if (itemVars.length > 2 && itemVars[2].type === "Int") {
                  const itemId = Number.parseInt(itemVars[2].value, 10) >>> 0;
                  items.add(itemId);
                }
              }
            }
          }
        }
      }
    }

    return {
      shopId,
      nameHash,
      items,
    };
  }

  function traverse(node: ConfigNode) {
    if (node.name.startsWith("SHOP_INFO_LIST_BEG_")) {
      if (node.children) {
        for (const child of node.children) {
          if (child.name.startsWith("SHOP_INFO_")) {
            const shop = parseShopNode(child);
            if (shop) {
              shops.push(shop);
            }
          }
        }
      }
    } else if (node.children) {
      for (const child of node.children) {
        traverse(child);
      }
    }
  }

  for (const entry of entries) {
    traverse(entry);
  }

  return shops;
}
