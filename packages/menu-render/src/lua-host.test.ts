import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import {
  LuaScreenHost,
  menuStateToOverrides,
  runMenuScreen,
  runMenuScreenState,
  type LuaGameHost,
  type LuaRuntimeAdapter,
} from "./lua-host";

test("missing runtime fails explicitly and include fallback preserves owner behavior", () => {
  expect(() => runMenuScreen("return 42")).toThrow("caller-supplied Lua runtime");
  const owner: LuaGameHost = {
    state: { calls: [], layers: [] },
    include: (name) => `owner:${name}`,
  };
  const screen = new LuaScreenHost(owner).registerInclude("known", "return 7");
  expect(screen.host).toBe(owner);
  expect(owner.include("known")).toBe("return 7");
  expect(owner.include("other")).toBe("owner:other");
});

test("caller adapter executes real Lua and propagates interpreter errors", () => {
  const { lua, lauxlib, lualib, to_luastring, to_jsstring } = createRequire(import.meta.url)(
    "fengari",
  );
  const adapter: LuaRuntimeAdapter = {
    createHost: () => ({
      state: { calls: [], layers: [] },
      include: (name) => {
        throw new Error(`Missing include ${name}`);
      },
    }),
    createGameHost: () => ({
      state: { calls: [], layers: [] },
      menuState: { layers: new Map() },
      include: () => "",
    }),
    runLuaSource: (source, host) => {
      const machine = lauxlib.luaL_newstate();
      try {
        lualib.luaL_openlibs(machine);
        if (lauxlib.luaL_dostring(machine, to_luastring(source)) !== lua.LUA_OK)
          throw new Error(to_jsstring(lua.lua_tostring(machine, -1)));
        host.state.calls.push({ fn: "fixture-result", args: [lua.lua_tonumber(machine, -1)] });
        return host.state;
      } finally {
        lua.lua_close(machine);
      }
    },
  };
  expect(runMenuScreen("return 6 * 7", { runtime: adapter }).calls[0]?.args).toEqual([42]);
  expect(() => runMenuScreen("error('actual Lua error')", { runtime: adapter })).toThrow(
    "actual Lua error",
  );
  expect(() => runMenuScreen("return 1", { runtime: adapter, hashEntries: {} })).toThrow(
    "does not support hash dictionaries",
  );
  expect(() => runMenuScreenState("return 1", { runtime: adapter, funcluaJson: {} })).toThrow(
    "does not support menu command-name loading",
  );
  expect(runMenuScreenState("return 9", { runtime: adapter }).layerState.calls[0]?.args).toEqual([
    9,
  ]);
});

test("menu overrides retain visibility, text and numeric state supplied by the game owner", () => {
  expect(
    menuStateToOverrides({
      layers: new Map([
        [
          1,
          {
            visible: false,
            objects: new Map([
              [1, { name: "score", visible: true, text: "fixture", number: 42 }],
              [2, { name: null, visible: true }],
            ]),
          },
        ],
      ]),
    }),
  ).toEqual({ score: { visible: false, text: "fixture", number: 42 } });
});
