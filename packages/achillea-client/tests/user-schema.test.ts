import { expect, test } from "bun:test";

import { userDtoSchema } from "../src/v1/common";

test("accepte clanId null pour un joueur sans clan", () => {
	const parsed = userDtoSchema.safeParse({
		clanId: null,
		id: "player-1",
		username: "SansClan",
	});

	expect(parsed.success).toBe(true);
});
