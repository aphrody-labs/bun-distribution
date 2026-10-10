// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
  clientReferenceModule,
  exportNames,
  moduleDirective,
  moduleId,
  serverRegistration,
  serverStubModule,
} from "../../src/app/plugin.ts";

describe("moduleDirective", () => {
  test.each([
    [`"use client";\nexport const a = 1;`, "client"],
    [`'use server'\nexport async function f() {}`, "server"],
    [`// license\n/* block */\n"use client";`, "client"],
    [`"use strict";\n"use client";`, "client"],
    [`import x from "y";\n"use client";`, undefined],
    [`export const a = "use client";`, undefined],
  ] as const)("%j", (source, expected) => {
    expect(moduleDirective(source)).toBe(expected);
  });
});

describe("reference modules", () => {
  test("exportNames lists named and default exports", () => {
    const names = exportNames(`export function A() {}\nexport const b = 1;\nexport default function C() {}`, "x.tsx");
    expect(names.toSorted()).toEqual(["A", "b", "default"]);
  });

  test("moduleId is a posix path relative to the root", () => {
    expect(moduleId("/p", "/p/app/x.tsx")).toBe("app/x.tsx");
  });

  test("a client reference exports one reference per name with the module bundles", () => {
    const code = clientReferenceModule("app/counter.tsx", ["Counter", "default", "not-an-ident"]);
    expect(code).toContain("createClientReference");
    expect(code).toContain(`__m3_client_bundles?.("app/counter.tsx")`);
    expect(code).toContain(`export const Counter = __ref("app/counter.tsx", "Counter", __bundles);`);
    expect(code).toContain(`export default __ref("app/counter.tsx", "default", __bundles);`);
    expect(code).not.toContain("not-an-ident =");
  });

  test("server stubs call the server by module id and export name", () => {
    const browser = serverStubModule("app/actions.ts", ["greet"], "client");
    expect(browser).toContain("client.browser");
    expect(browser).toContain(`export const greet = __ref("app/actions.ts", "greet");`);
    expect(serverStubModule("app/actions.ts", ["greet"], "ssr")).toContain("client.edge");
  });

  test("the rsc layer registers every function export of an action module", () => {
    const code = serverRegistration("app/actions.ts", "/p/app/actions.ts", ["greet", "add"]);
    expect(code).toContain("registerServerReference");
    expect(code).toContain(`import * as __m3_self from "./actions.ts";`);
    expect(code).toContain(`["greet","add"]`);
  });
});
