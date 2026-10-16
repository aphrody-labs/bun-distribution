import { describe, expect, it, beforeAll, beforeEach, mock } from "bun:test";
import type { Mock } from "bun:test";

// --- Mocks des services (top-level, AVANT tout import du SUT) ---
// On garde des références aux mocks pour pouvoir les réinitialiser dans beforeEach
// (bun:test n'a pas d'équivalent fiable à vi.clearAllMocks()).

// Mock next/headers (store cookie synchrone — le SUT fait `await cookies()`,
// await sur une valeur non-promesse renvoie la valeur telle quelle).
const cookieStore = {
	delete: mock(),
	get: mock(),
	set: mock(),
};
const cookies = mock(() => cookieStore);
mock.module("next/headers", () => ({ cookies }));

// Mock next/cache
const revalidatePath = mock();
mock.module("next/cache", () => ({ revalidatePath }));

// Mock @rosegriffon/db/redis
const redisCache = {
	del: mock(),
	get: mock(),
	set: mock(),
};
mock.module("@rosegriffon/db/redis", () => ({ cache: redisCache }));

// Mock @/lib/auth-helpers (le module réel charge @/lib/auth → betterAuth/Pool ;
// on le mocke entièrement pour ne jamais évaluer ces effets de bord).
const getServerUser = mock();
mock.module("@/lib/auth-helpers", () => ({ getServerUser }));

// --- Import dynamique du SUT, APRÈS les mock.module ci-dessus ---
type CartModule = typeof import("./cart");
let getCart: CartModule["getCart"];
let addToCart: CartModule["addToCart"];
let updateQty: CartModule["updateQty"];
let removeFromCart: CartModule["removeFromCart"];
let clearCart: CartModule["clearCart"];

beforeAll(async () => {
	const mod = await import("./cart");
	getCart = mod.getCart;
	addToCart = mod.addToCart;
	updateQty = mod.updateQty;
	removeFromCart = mod.removeFromCart;
	clearCart = mod.clearCart;
});

describe("Cart persistence & merging", () => {
	const mockCookies = cookieStore;

	beforeEach(() => {
		// Réinitialise l'historique d'appels de tous les mocks (remplace vi.clearAllMocks()).
		for (const m of [
			cookies,
			cookieStore.get,
			cookieStore.set,
			cookieStore.delete,
			revalidatePath,
			redisCache.get,
			redisCache.set,
			redisCache.del,
			getServerUser,
		] as Mock<(...args: never[]) => unknown>[]) {
			m.mockClear();
		}

		mockCookies.get.mockReturnValue(undefined);
		mockCookies.set.mockReturnValue(undefined);
		mockCookies.delete.mockReturnValue(undefined);
		redisCache.get.mockResolvedValue(null);
		redisCache.set.mockResolvedValue(true);
		redisCache.del.mockResolvedValue(true);
		getServerUser.mockResolvedValue(null);
	});

	describe("Anonymous user (Cookie-based cart)", () => {
		it("should return empty cart snapshot when no cookie is present", async () => {
			const cart = await getCart();
			expect(cart.items).toEqual([]);
			expect(cart.itemCount).toBe(0);
			expect(cart.subtotalCents).toBe(0);
		});

		it("should retrieve items from cookie when cookie is present", async () => {
			const initialItems = [
				{ id: "print-a5-roy-fonteneau::default", qty: 2, slug: "print-a5-roy-fonteneau" },
			];
			mockCookies.get.mockReturnValue({ value: encodeURIComponent(JSON.stringify(initialItems)) });

			const cart = await getCart();
			expect(cart.items.length).toBe(1);
			const firstItem = cart.items[0]!;
			expect(firstItem.slug).toBe("print-a5-roy-fonteneau");
			expect(firstItem.qty).toBe(2);
			expect(cart.itemCount).toBe(2);
		});

		it("should add a product to cookie cart", async () => {
			await addToCart("print-a5-roy-fonteneau", undefined, 1);
			expect(mockCookies.set).toHaveBeenCalled();
			const [, value] = mockCookies.set.mock.calls[0] as [string, string];
			const saved = JSON.parse(decodeURIComponent(value));
			expect(saved[0].slug).toBe("print-a5-roy-fonteneau");
			expect(saved[0].qty).toBe(1);
		});

		it("should update product quantity in cookie cart", async () => {
			const initialItems = [
				{ id: "print-a5-roy-fonteneau::default", qty: 2, slug: "print-a5-roy-fonteneau" },
			];
			mockCookies.get.mockReturnValue({ value: encodeURIComponent(JSON.stringify(initialItems)) });

			await updateQty("print-a5-roy-fonteneau::default", 5);
			expect(mockCookies.set).toHaveBeenCalled();
			const [, value] = mockCookies.set.mock.calls[0] as [string, string];
			const saved = JSON.parse(decodeURIComponent(value));
			expect(saved[0].qty).toBe(5);
		});

		it("should remove product from cookie cart", async () => {
			const initialItems = [
				{ id: "print-a5-roy-fonteneau::default", qty: 2, slug: "print-a5-roy-fonteneau" },
			];
			mockCookies.get.mockReturnValue({ value: encodeURIComponent(JSON.stringify(initialItems)) });

			await removeFromCart("print-a5-roy-fonteneau::default");
			expect(mockCookies.delete).toHaveBeenCalledWith("rg_cart");
		});

		it("should clear cookie cart", async () => {
			await clearCart();
			expect(mockCookies.delete).toHaveBeenCalled();
		});
	});

	describe("Authenticated user (Redis-based cart & merging)", () => {
		const mockUser = { id: "user_123", email: "test@rosegriffon.fr" } as {
			id: string;
			email: string;
		};

		beforeEach(() => {
			getServerUser.mockResolvedValue(mockUser);
		});

		it("should return empty cart when Redis cache is empty", async () => {
			const cart = await getCart();
			expect(cart.items).toEqual([]);
			expect(redisCache.get).toHaveBeenCalledWith("cart:user_123");
		});

		it("should retrieve items from Redis cache when authenticated", async () => {
			const redisItems = [
				{ id: "print-a5-roy-fonteneau::default", qty: 3, slug: "print-a5-roy-fonteneau" },
			];
			redisCache.get.mockResolvedValue(redisItems);

			const cart = await getCart();
			expect(cart.items.length).toBe(1);
			expect(cart.items[0]!.qty).toBe(3);
		});

		it("should merge cookie cart items into Redis cart when logging in", async () => {
			// Simule des items existants dans le cache Redis
			const redisItems = [
				{ id: "print-a5-roy-fonteneau::default", qty: 1, slug: "print-a5-roy-fonteneau" },
			];
			redisCache.get.mockResolvedValue(redisItems);

			// Simule des items dans le cookie (avant authentification complète)
			const cookieItems = [
				{ id: "print-a5-roy-fonteneau::default", qty: 2, slug: "print-a5-roy-fonteneau" },
				{
					id: "pack-personnage-destin-billows::solstice",
					qty: 1,
					slug: "pack-personnage-destin-billows",
					variantId: "solstice",
				},
			];
			mockCookies.get.mockReturnValue({ value: encodeURIComponent(JSON.stringify(cookieItems)) });

			// Appeler getCart() devrait déclencher la fusion
			const cart = await getCart();

			// Vérifie que les paniers ont été fusionnés
			// 1 print (Redis) + 2 prints (Cookie) = 3 prints
			const print = cart.items.find((i) => i.slug === "print-a5-roy-fonteneau");
			expect(print?.qty).toBe(3);

			// Le pack personnage a également été ajouté
			const pack = cart.items.find((i) => i.slug === "pack-personnage-destin-billows");
			expect(pack?.qty).toBe(1);

			// Le cache Redis doit être mis à jour avec le panier fusionné
			expect(redisCache.set).toHaveBeenCalled();

			// Le cookie doit être nettoyé
			expect(mockCookies.delete).toHaveBeenCalled();
		});

		it("should add a product directly to Redis when authenticated", async () => {
			await addToCart("print-a5-roy-fonteneau", undefined, 2);
			expect(redisCache.set).toHaveBeenCalled();
			const calls = redisCache.set.mock.calls;
			expect(calls.length).toBeGreaterThan(0);
			const call = calls[0]!;
			const key = call[0];
			const savedItems = call[1];
			expect(key).toBe("cart:user_123");
			expect((savedItems as { slug: string; qty: number }[])[0]!.slug).toBe(
				"print-a5-roy-fonteneau"
			);
			expect((savedItems as { slug: string; qty: number }[])[0]!.qty).toBe(2);
		});

		it("should clear Redis cart on clearCart", async () => {
			await clearCart();
			expect(redisCache.del).toHaveBeenCalledWith("cart:user_123");
		});
	});
});
