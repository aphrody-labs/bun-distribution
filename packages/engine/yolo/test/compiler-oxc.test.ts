// SPDX-License-Identifier: MIT
import { expect, test } from "bun:test";
import type { ESTreeProgram } from "../../core/src/compiler/oxc.ts";
import { NativeTooling } from "@aphrody/runtime-sdk/tooling";

// These acceptance tests require the real Rust provider, never a transport fixture.
const nativePath = process.env.YOLO_TOOLING_LIB;
const nativeTest = test.skipIf(!nativePath);

nativeTest("native TSX parsing retains typed AST and UTF-16 source spans", () => {
  using tooling = new NativeTooling({ path: nativePath! });
  const source = `// 🐈 actual comment
export interface Greeting { text: string }
export const greeting: Greeting = { text: "🐈" };
export const view = <div>{greeting.text}</div>;
`;
  const analysis = tooling.analyzeModule(source, "fixture.tsx");
  expect(analysis.exports).toEqual(["Greeting", "greeting", "view"]);
  expect(analysis.spanEncoding).toBe("utf16");
  const entry = analysis.exportEntries[0]!;
  expect(source.slice(entry.start, entry.end)).toBe("Greeting");
  const program = tooling.parseProgram<ESTreeProgram>(source, "fixture.tsx");
  expect(program.type).toBe("Program");
  expect(program.body.map((node) => node.type)).toEqual([
    "ExportNamedDeclaration",
    "ExportNamedDeclaration",
    "ExportNamedDeclaration",
  ]);
  const statement = program.body[0];
  expect(statement?.type).toBe("ExportNamedDeclaration");
  if (statement?.type !== "ExportNamedDeclaration") throw new Error("Expected typed export");
  expect(statement.declaration?.type).toBe("TSInterfaceDeclaration");
  expect(source.slice(statement.start, statement.end)).toBe(
    "export interface Greeting { text: string }",
  );
});

nativeTest("native module records retain physical requests and exclude decoys", () => {
  using tooling = new NativeTooling({ path: nativePath! });
  const source = `// import phantom from "./comment.js"; export const fake = 0;
const decoy = 'import imaginary from "./string.js";';
import "./side.js";
import value, { type Shape, other as renamed } from "./dep.ts";
export { renamed as publicName };
export * from "./reexport.js";
import "./side.js";
const later = import("./dynamic.js");
`;
  const result = tooling.analyzeModule(source, "fixture.ts");
  expect(result.imports).toEqual(["./side.js", "./dep.ts", "./reexport.js", "./side.js"]);
  expect(result.exports).toEqual(["publicName", "*"]);
  expect(result.requests.map((request) => source.slice(request.start, request.end))).toEqual([
    '"./side.js"',
    '"./dep.ts"',
    '"./reexport.js"',
    '"./side.js"',
  ]);
  expect(result.requests.map((request) => request.isImport)).toEqual([true, true, false, true]);
});

nativeTest("native syntax and semantic errors are explicit without source execution", () => {
  using tooling = new NativeTooling({ path: nativePath! });
  expect(() => tooling.analyzeModule("export const = ;", "fixture.ts")).toThrow(SyntaxError);
  expect(() => tooling.parseProgram("let duplicate; let duplicate;", "fixture.ts")).toThrow(
    SyntaxError,
  );
  const source = `globalThis.__yoloOxcMustNotExecute = true; export const answer: number = 42;`;
  expect(tooling.analyzeModule(source, "fixture.ts").exports).toEqual(["answer"]);
  expect(Object.hasOwn(globalThis, "__yoloOxcMustNotExecute")).toBe(false);
});

nativeTest("one provider owns parser, formatter, minifier and linter", () => {
  using tooling = new NativeTooling({ path: nativePath! });
  expect(tooling.probe().abi).toEqual({ tooling: 1, n2b: 2, oxc: 1 });
  expect(tooling.formatSource("const x=1", "fixture.js")).toBe("const x = 1;\n");
  expect(tooling.minifySource("const x = 1; console.log(x)", "fixture.js")).toContain(
    "console.log",
  );
  expect(Array.isArray(tooling.lintSource("const x=1", "fixture.js"))).toBe(true);
});

nativeTest("official ESTree JSON retains BigInt and RegExp metadata without runtime values", () => {
  using tooling = new NativeTooling({ path: nativePath! });
  const program = tooling.parseProgram<ESTreeProgram>("123n; /hello/gi;", "fixture.js");
  const first = program.body[0];
  const second = program.body[1];
  if (first?.type !== "ExpressionStatement" || first.expression.type !== "Literal")
    throw new Error("Expected BigInt literal");
  if (second?.type !== "ExpressionStatement" || second.expression.type !== "Literal")
    throw new Error("Expected RegExp literal");
  expect(first.expression.value).toBeNull();
  expect(second.expression.value).toBeNull();
  expect(first.expression).toMatchObject({ bigint: "123" });
  expect(second.expression).toMatchObject({ regex: { pattern: "hello", flags: "gi" } });
});

test("ordinary TypeScript and JSX transformation remains owned by Bun.Transpiler", () => {
  const source = `export const value: number = 42; export const view = <div>{value}</div>;`;
  const output = new Bun.Transpiler({ loader: "tsx", target: "bun" }).transformSync(source);
  expect(output).not.toContain(": number");
  expect(output).not.toContain("<div>");
  expect(new Bun.Transpiler({ loader: "js" }).scan(output).exports).toEqual(["value", "view"]);
});
