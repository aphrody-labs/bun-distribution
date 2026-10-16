import "@testing-library/jest-dom";

import { vi } from "vitest";

// Mock Next.js router
vi.mock("next/navigation", () => ({
	useRouter: () => ({
		prefetch: vi.fn(),
		push: vi.fn(),
		replace: vi.fn(),
	}),
	useSearchParams: () => ({
		get: vi.fn(),
	}),
}));
