import { expect, test } from "bun:test";

// These requests stop at authentication and never open a database connection.
process.env.DATABASE_URL ??= "postgres://localhost/rg_route_test";
const { app } = await import("../src/api/server");

test("unified staff notes route is registered and requires a session", async () => {
	const response = await app.handle(new Request("http://localhost/v1/achillea/player-notes?pageSize=1"));
	expect(response.status).toBe(401);
});

test("unified sanctions write routes require a session", async () => {
	for (const action of ["revoke", "appeal"]) {
		const response = await app.handle(new Request(`http://localhost/v1/achillea/sanctions/1/${action}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: action === "revoke" ? "{}" : '{"message":"Appeal reason"}',
		}));
		expect(response.status).toBe(401);
	}
});
