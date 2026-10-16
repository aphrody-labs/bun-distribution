/**
 * Panier server-side — stocké dans un cookie HttpOnly chiffré côté JSON simple.
 * Volontairement minimaliste : un cookie suffit pour un panier e-commerce d'asso,
 * pas besoin d'une table Supabase éphémère. La source de vérité passe à Stripe
 * dès le checkout (session_id + metadata).
 *
 * API exposée :
 *   - `getCart()` (server component)
 *   - `addToCart(slug, variantId?, qty?)` (server action)
 *   - `updateQty(itemId, qty)` (server action)
 *   - `removeFromCart(itemId)` (server action)
 *   - `clearCart()` (server action)
 */
"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getProduct, getVariantPrice } from "./products";
import type { Product } from "./products";
import { getServerUser } from "@/lib/auth-helpers";
import { cache as redisCache } from "@rosegriffon/db/redis";

const COOKIE_NAME = "rg_cart";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 jours

export interface CartItem {
  id: string; // {slug}::{variantId|"default"}
  slug: string;
  variantId?: string;
  qty: number;
}

export interface CartItemResolved extends CartItem {
  product: Product;
  variantLabel?: string;
  unitPriceCents: number;
  lineTotalCents: number;
}

export interface CartSnapshot {
  items: CartItemResolved[];
  itemCount: number;
  subtotalCents: number;
}

function makeId(slug: string, variantId?: string): string {
  return `${slug}::${variantId ?? "default"}`;
}

async function readCookieCart(): Promise<CartItem[]> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(decodeURIComponent(raw));
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (i): i is CartItem =>
        typeof i === "object" && i !== null && typeof i.slug === "string" && typeof i.qty === "number" && i.qty > 0,
    );
  } catch {
    return [];
  }
}

async function writeCookieCart(items: CartItem[]): Promise<void> {
  const store = await cookies();
  if (items.length === 0) {
    store.delete(COOKIE_NAME);
    return;
  }
  store.set(COOKIE_NAME, encodeURIComponent(JSON.stringify(items)), {
    httpOnly: true,
    maxAge: COOKIE_MAX_AGE,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

async function readRedisCart(userId: string): Promise<CartItem[]> {
  const key = `cart:${userId}`;
  const items = await redisCache.get<CartItem[]>(key);
  return items ?? [];
}

async function writeRedisCart(userId: string, items: CartItem[]): Promise<void> {
  const key = `cart:${userId}`;
  if (items.length === 0) {
    await redisCache.del(key);
  } else {
    await redisCache.set(key, items, COOKIE_MAX_AGE);
  }
}

async function readCart(): Promise<CartItem[]> {
  const user = await getServerUser();
  const cookieItems = await readCookieCart();

  if (user) {
    const redisItems = await readRedisCart(user.id);
    if (cookieItems.length > 0) {
      const merged = [...redisItems];
      for (const cookieItem of cookieItems) {
        const existing = merged.find(i => i.id === cookieItem.id);
        if (existing) {
          existing.qty = Math.min(existing.qty + cookieItem.qty, 10);
        } else {
          merged.push(cookieItem);
        }
      }
      await writeRedisCart(user.id, merged);
      await writeCookieCart([]);
      return merged;
    }
    return redisItems;
  }

  return cookieItems;
}

async function writeCart(items: CartItem[]): Promise<void> {
  const user = await getServerUser();
  if (user) {
    await writeRedisCart(user.id, items);
  } else {
    await writeCookieCart(items);
  }
}

function resolveCart(items: CartItem[]): CartSnapshot {
  const resolved: CartItemResolved[] = [];
  for (const item of items) {
    const product = getProduct(item.slug);
    if (!product) {
      continue;
    }
    const unit = getVariantPrice(product, item.variantId);
    const variantLabel = item.variantId ? product.variants?.find(v => v.id === item.variantId)?.label : undefined;
    resolved.push({
      ...item,
      lineTotalCents: unit * item.qty,
      product,
      unitPriceCents: unit,
      variantLabel,
    });
  }
  return {
    itemCount: resolved.reduce((acc, i) => acc + i.qty, 0),
    items: resolved,
    subtotalCents: resolved.reduce((acc, i) => acc + i.lineTotalCents, 0),
  };
}

export async function getCart(): Promise<CartSnapshot> {
  const items = await readCart();
  return resolveCart(items);
}

export async function addToCart(slug: string, variantId?: string, qty = 1): Promise<CartSnapshot> {
  const product = getProduct(slug);
  if (!product) {
    throw new Error(`[cart] unknown product: ${slug}`);
  }
  if (product.variants && !variantId) {
    throw new Error(`[cart] ${slug} requires a variant`);
  }
  const items = await readCart();
  const id = makeId(slug, variantId);
  const existing = items.find(i => i.id === id);
  if (existing) {
    existing.qty = Math.min(existing.qty + qty, 10);
  } else {
    items.push({ id, qty: Math.min(qty, 10), slug, variantId });
  }
  await writeCart(items);
  revalidatePath("/shop");
  return resolveCart(items);
}

export async function updateQty(itemId: string, qty: number): Promise<CartSnapshot> {
  const items = await readCart();
  const next = items
    .map(i => (i.id === itemId ? { ...i, qty: Math.max(0, Math.min(qty, 10)) } : i))
    .filter(i => i.qty > 0);
  await writeCart(next);
  revalidatePath("/shop");
  return resolveCart(next);
}

export async function removeFromCart(itemId: string): Promise<CartSnapshot> {
  const items = (await readCart()).filter(i => i.id !== itemId);
  await writeCart(items);
  revalidatePath("/shop");
  return resolveCart(items);
}

export async function clearCart(): Promise<void> {
  await writeCart([]);
  revalidatePath("/shop");
}
