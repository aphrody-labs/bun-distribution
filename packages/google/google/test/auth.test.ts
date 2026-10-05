import { expect, test } from "bun:test";
import { googleModels, resolveGoogleBinary } from "../src/auth.ts";

test("Google facade reports a native binary when one is configured or installed", () => {
	const previous = Bun.env.APHRODY_GOOGLE_BIN;
	try {
		Bun.env.APHRODY_GOOGLE_BIN = "C:/native/aphrody-google.exe";
		expect(resolveGoogleBinary()).toBe("C:/native/aphrody-google.exe");
	} finally {
		if (previous === undefined) delete Bun.env.APHRODY_GOOGLE_BIN;
		else Bun.env.APHRODY_GOOGLE_BIN = previous;
	}
});
