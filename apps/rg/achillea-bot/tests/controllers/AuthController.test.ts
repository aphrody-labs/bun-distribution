import { describe, expect, mock, test } from "bun:test";
import type { Request, Response } from "express";
import { relayRealtimeToken, sendLogout } from "../../src/api/controllers/auth-handlers";

describe("AuthController handlers", () => {
	test("logout clears the session cookie and disables caching", () => {
		const res = {
			clearCookie: mock(() => res),
			setHeader: mock(() => res),
			json: mock(() => res),
		} as unknown as Response;
		sendLogout(res, true);
		expect(res.clearCookie).toHaveBeenCalledTimes(1);
		expect((res.clearCookie as ReturnType<typeof mock>).mock.calls[0]?.[0]).toBe("token");
		expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
		expect(res.json).toHaveBeenCalledWith({ ok: true });
	});

	test("realtime token forwards only the session headers and upstream status", async () => {
		const res = {
			status: mock(() => res),
			setHeader: mock(() => res),
			type: mock(() => res),
			send: mock(() => res),
		} as unknown as Response;
		const fetcher = mock(async () => Response.json({ token: "test-token" }, { status: 200 }));
		await relayRealtimeToken(
			{ headers: { cookie: "token=test", authorization: "Bearer test" } } as Request,
			res,
			"https://api.example.test/",
			fetcher as typeof fetch
		);
		expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.example.test/v1/auth/realtime-token");
		expect(fetcher.mock.calls[0]?.[1]).toEqual({
			headers: { accept: "application/json", cookie: "token=test", authorization: "Bearer test" },
		});
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
		expect(res.send).toHaveBeenCalledWith('{"token":"test-token"}');
	});
});
