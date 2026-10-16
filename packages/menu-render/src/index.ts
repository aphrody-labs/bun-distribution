export { GameMenu } from "./game-menu";
export type { GameMenuProps, MenuObjectOverride } from "./game-menu";
export type {
  MenuLayout,
  MenuObject,
  MenuTransform,
  MenuSprite,
  MenuText,
  MenuAnim,
  MenuPrimitive,
  MenuCanvas,
} from "./types";

// Lua APIs require a caller-provided runtime adapter; import the explicit
// ./lua-host or ./use-lua-screen subpath when supplying the owning game host.
