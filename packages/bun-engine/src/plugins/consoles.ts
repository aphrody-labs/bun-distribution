import type { BunPlugin } from "bun";

export const consoleIds = [
  "nintendo-switch",
  "nintendo-wii-gamecube",
  "nintendo-ds",
  "nintendo-ds-dsi",
  "nintendo-3ds-gba",
  "nintendo-3ds",
  "nintendo-nes",
  "nintendo-game-boy",
  "nintendo-game-boy-advance",
  "nintendo-64",
  "sony-playstation",
  "multi-system",
] as const;

export type ConsoleId = (typeof consoleIds)[number];

function consolePlugin(console: ConsoleId): BunPlugin {
  const namespace = `bun-engine-console-${console}`;
  return {
    name: `bun-engine:console:${console}`,
    setup(build) {
      build.onResolve({ filter: new RegExp(`^bun-engine:${console}$`) }, () => ({
        path: console,
        namespace,
      }));
      build.onLoad({ filter: /.*/, namespace }, () => ({
        exports: { console, integrated: true },
        loader: "object",
      }));
    },
  };
}

export const consolePlugins = consoleIds.map(consolePlugin);
