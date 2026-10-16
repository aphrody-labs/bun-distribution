import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import type React from "react";

// --- Mocks de module (top-level, AVANT tout import du SUT) ---------------
// @/lib/auth-client CRASHE a l'import (createAuthClient au top-level).
// On override les deux modules ici pour que leur code original ne soit
// jamais evalue : le SUT (useSidebarAuth) est importe dynamiquement plus bas.

const mockGetCurrentProfile = mock();
const mockUseSession = mock();

mock.module("@/app/settings/actions", () => ({
	getCurrentPublicProfile: mockGetCurrentProfile,
}));

mock.module("@/lib/auth-client", () => ({
	authClient: {
		useSession: () => mockUseSession(),
	},
}));

mock.module("@/contexts/auth-context", () => ({
	useAuth: () => {
		const session = mockUseSession() as
			| { data?: { user?: unknown }; isPending?: boolean; error?: unknown }
			| undefined;
		return {
			user: (session?.data?.user as never) ?? null,
			isLoading: session?.isPending ?? false,
			error: session?.error ? String(session.error) : null,
			logout: mock(),
		};
	},
}));

// useSidebarAuth appelle useRouter() de next/navigation : sans AppRouterContext
// monte, le vrai hook throw « invariant expected app router to be mounted ».
// Le router n'est pas utilise par le hook, on fournit un stub neutre.
mock.module("next/navigation", () => ({
	useRouter: () => ({
		back: mock(),
		forward: mock(),
		prefetch: mock(),
		push: mock(),
		refresh: mock(),
		replace: mock(),
	}),
}));

describe("useSidebarAuth", () => {
	let queryClient: QueryClient;
	let useSidebarAuth: typeof import("../useSidebarAuth").useSidebarAuth;

	const wrapper = ({ children }: { children: React.ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);

	beforeEach(async () => {
		// Pas de vi.clearAllMocks() en bun:test : on reset chaque mock a la main
		// pour eviter toute fuite entre tests.
		mockGetCurrentProfile.mockClear();
		mockUseSession.mockClear();

		// Import dynamique du SUT APRES les mock.module ci-dessus.
		({ useSidebarAuth } = await import("../useSidebarAuth"));

		queryClient = new QueryClient({
			defaultOptions: {
				queries: {
					gcTime: 0,
					retry: false,
					staleTime: 0,
				},
			},
		});

		mockGetCurrentProfile.mockResolvedValue(null);
	});

	it("should return initial loading state", () => {
		mockUseSession.mockReturnValue({ data: null, isPending: true });
		const { result } = renderHook(() => useSidebarAuth(), { wrapper });
		expect(result.current.loading).toBe(true);
	});

	it("should handle unauthenticated user", async () => {
		mockUseSession.mockReturnValue({ data: null, isPending: false });

		const { result } = renderHook(() => useSidebarAuth(), { wrapper });

		await waitFor(
			() => {
				expect(result.current.loading).toBe(false);
			},
			{ timeout: 2000 }
		);

		expect(result.current.user).toBeNull();
		expect(result.current.profile).toBeNull();
		expect(result.current.error).toBeNull();
	});

	it("should handle authenticated user with profile", async () => {
		// Fixtures partielles : seuls les champs lus par le hook sont fournis.
		// On caste a `never` au moment de l'assertion (cf. toEqual ci-dessous)
		// pour ne pas dupliquer les types complets User/Profile dans le test.
		const mockUser = { email: "test@example.com", id: "user-123" };
		const mockProfile = { id: "user-123", username: "testuser" };

		mockUseSession.mockReturnValue({ data: { user: mockUser }, isPending: false });

		mockGetCurrentProfile.mockResolvedValue(mockProfile);

		const { result } = renderHook(() => useSidebarAuth(), { wrapper });

		await waitFor(
			() => {
				expect(result.current.user).toEqual(mockUser as never);
			},
			{ timeout: 2000 }
		);

		await waitFor(
			() => {
				expect(result.current.profile).toEqual(mockProfile as never);
			},
			{ timeout: 2000 }
		);

		expect(result.current.loading).toBe(false);
		expect(result.current.error).toBeNull();
	});

	it("should handle error fetching user", async () => {
		const mockUser = { email: "test@example.com", id: "user-123" };
		mockUseSession.mockReturnValue({ data: { user: mockUser }, isPending: false });

		mockGetCurrentProfile.mockRejectedValue(new Error("Network error"));

		const { result } = renderHook(() => useSidebarAuth(), { wrapper });

		await waitFor(
			() => {
				expect(result.current.loading).toBe(false);
			},
			{ timeout: 2000 }
		);

		expect(result.current.error).toBe("Network error");
	});
});
