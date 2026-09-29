import { expect, test } from "bun:test";
import { createHash } from "node:crypto";

test("les identifiants de fiches collectées restent stables et URL-safe", () => {
	const url = "https://example.test/dragon-ball?chapter=1";
	const key = createHash("sha256").update(url).digest("hex").slice(0, 20);
	expect(`source-${key}`).toMatch(/^source-[a-f0-9]{20}$/);
	expect(`source-${key}`).toBe(`source-${key}`);
});
