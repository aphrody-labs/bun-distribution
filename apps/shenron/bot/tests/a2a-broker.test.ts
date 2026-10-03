import { describe, expect, test } from "bun:test";
import { brokerArgs } from "../scripts/a2a-broker";

// Le comportement du broker (socket 0666, coord files, SSE, JSON-RPC) est
// testé côté Rust : crates/os/a2a-coord/src/legacy_broker.rs.
describe("a2a-broker launcher", () => {
	test("délègue à aphrody a2a serve en socket Unix seul", () => {
		expect(brokerArgs("/tmp/x.sock", "/repo/.coord")).toEqual([
			"a2a",
			"serve",
			"--unix",
			"/tmp/x.sock",
			"--coord-dir",
			"/repo/.coord",
			"--no-tcp",
		]);
	});
});
