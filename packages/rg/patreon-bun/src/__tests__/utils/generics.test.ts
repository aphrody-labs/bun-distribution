import { describe, expectTypeOf, test } from "bun:test";

import { Add, If, Length, Subtract, Tuple } from "../../utils/generics";

describe("add type", () => {
	test("add zero", () => {
		expectTypeOf<Add<9>>().toEqualTypeOf<9>();
		expectTypeOf<Add<12>>().toEqualTypeOf<12>();
	});

	test("add", () => {
		expectTypeOf<Add<9, 3>>().toEqualTypeOf<12>();
		expectTypeOf<Add<12, 3>>().toEqualTypeOf<15>();
	});
});

describe("if type", () => {
	test("generic boolean", () => {
		expectTypeOf<If<boolean, true, false>>().toEqualTypeOf<boolean>();
		expectTypeOf<If<boolean, number, string>>().toEqualTypeOf<number | string>();
	});

	test("true boolean", () => {
		expectTypeOf<If<true, true, false>>().toEqualTypeOf<true>();
		expectTypeOf<If<true, string, number>>().toEqualTypeOf<string>();
	});

	test("false boolean", () => {
		expectTypeOf<If<false, true, false>>().toEqualTypeOf<false>();
		expectTypeOf<If<false, true>>().toEqualTypeOf<never>();
		expectTypeOf<If<false, string, number>>().toEqualTypeOf<number>();
	});
});

describe("length", () => {
	test("array", () => {
		expectTypeOf<Length<[0, 1, 2]>>().toEqualTypeOf<3>();
	});

	test("string", () => {
		expectTypeOf<Length<"test">>().toEqualTypeOf<4>();
	});
});

describe("subtract", () => {
	test("two numbers", () => {
		expectTypeOf<Subtract<9, 6>>().toEqualTypeOf<3>();
	});

	test("no changes", () => {
		expectTypeOf<Subtract<9, 0>>().toEqualTypeOf<9>();
		expectTypeOf<Subtract<1, 0>>().toEqualTypeOf<1>();
		expectTypeOf<Subtract<0, 0>>().toEqualTypeOf<0>();
	});
});

describe("tuple", () => {
	test("array", () => {
		expectTypeOf<Tuple<0, 2>>().toEqualTypeOf<[0, 0]>();
	});

	test("one length", () => {
		expectTypeOf<Tuple<"test", 1>>().toEqualTypeOf<["test"]>();
	});

	test("empty", () => {
		expectTypeOf<Tuple<"test", 0>>().toEqualTypeOf<[]>();
	});
});
