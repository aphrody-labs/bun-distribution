import { describe, expect, test } from "bun:test";

import { canTransferObject } from "./permissions";

function access(readable: string[], writable: string[]) {
	return {
		canRead: async (bucket: string) => readable.includes(bucket),
		canWrite: async (bucket: string, name: string) => writable.includes(`${bucket}/${name}`),
	};
}

describe("storage object transfer permissions", () => {
	test("cannot copy a private source into a writable public destination", async () => {
		const allowed = await canTransferObject(
			"copy",
			"private",
			"secret.txt",
			"avatars",
			"user-1/exposed.txt",
			access([], ["avatars/user-1/exposed.txt"])
		);
		expect(allowed).toBe(false);
	});

	test("cannot move a readable source without permission to delete it", async () => {
		const allowed = await canTransferObject(
			"move",
			"public",
			"other-user/image.png",
			"avatars",
			"user-1/image.png",
			access(["public"], ["avatars/user-1/image.png"])
		);
		expect(allowed).toBe(false);
	});

	test("allows an authorized copy and move", async () => {
		const permissions = access(
			["avatars"],
			["avatars/user-1/image.png", "avatars/user-1/copy.png"]
		);
		expect(await canTransferObject("copy", "avatars", "user-1/image.png", "avatars", "user-1/copy.png", permissions)).toBe(true);
		expect(await canTransferObject("move", "avatars", "user-1/image.png", "avatars", "user-1/copy.png", permissions)).toBe(true);
	});
});
