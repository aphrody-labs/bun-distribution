// `bun-engine frontend` (the single entry point: server plus an app window) and
// `bun-engine library` (the same library, routing and checks from a terminal).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { usrRoot } from "../usr";
import { createWorkspaceServer } from "../workspace";
import { biosOverview } from "./api";
import { launchGame, routesFor } from "./launch";
import {
  addFolder,
  findGame,
  type Game,
  gamesFor,
  listSources,
  removeSource,
  scanLibrary,
  setDefaultRoute,
  systemCounts,
} from "./library";
import { loadSystems } from "./systems";

function print(value: unknown): number {
  console.log(JSON.stringify(value, null, 2));
  return 0;
}

function option(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

/** A Chromium-family browser for the app window: the Bun Chromium build, Edge, then Chrome. */
function appBrowser(): string | undefined {
  const local = Bun.env.LOCALAPPDATA ?? "";
  const programs = [
    Bun.env.ProgramFiles,
    Bun.env["ProgramFiles(x86)"],
    local,
  ].filter(Boolean) as string[];
  const candidates = [
    Bun.env.BUN_CHROME_PATH,
    ...programs.flatMap((base) => [
      join(base, "BunChromium", "Application", "chrome.exe"),
      join(base, "Microsoft", "Edge", "Application", "msedge.exe"),
      join(base, "Google", "Chrome", "Application", "chrome.exe"),
      join(base, "Chromium", "Application", "chrome.exe"),
    ]),
    ...[
      "msedge",
      "microsoft-edge",
      "chromium",
      "chromium-browser",
      "google-chrome",
      "chrome",
    ].map((name) => Bun.which(name) ?? undefined),
  ];
  return candidates.find((path) => path && existsSync(path));
}

/**
 * Serves the frontend and opens it as an app window; the server stops when the window closes.
 * `--screenshot <png>` renders it headless through Bun.WebView instead (qualification).
 */
export async function runFrontend(args: string[]): Promise<number> {
  const port = Number(
    option(args, "--port") ?? Bun.env.BUN_ENGINE_WEB_PORT ?? 50080,
  );
  const server = createWorkspaceServer({ port });
  const url = new URL(option(args, "--path") ?? "/", server.url).href;
  console.log(`bun-engine frontend: ${url}`);
  const screenshot = option(args, "--screenshot");
  if (screenshot) {
    await using view = new Bun.WebView({ width: 1600, height: 900 });
    await view.navigate(url);
    await view.evaluate(
      "new Promise(resolve => { const t = setInterval(() => { if (document.querySelector('[data-ready]')) { clearInterval(t); resolve(true); } }, 100); })",
    );
    for (const key of (option(args, "--keys") ?? "")
      .split(",")
      .filter(Boolean)) {
      await view.press(key as never);
      await Bun.sleep(250);
    }
    await Bun.sleep(500);
    await Bun.write(screenshot, await view.screenshot());
    console.log(screenshot);
    server.stop(true);
    return 0;
  }
  const browser = args.includes("--no-window") ? undefined : appBrowser();
  if (!browser) {
    if (!args.includes("--no-window"))
      console.log("no Chromium-family browser found; open the URL above");
    await new Promise(() => {});
  }
  const profile = join(usrRoot(), "var", "lib", "bep", "frontend-profile");
  const window = Bun.spawn(
    [
      browser!,
      `--app=${url}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1600,900",
    ],
    { stdout: "ignore", stderr: "ignore" },
  );
  const code = await window.exited;
  server.stop(true);
  return code;
}

const usage = `usage: bun-engine library scan | systems | games [system] | routes <system> | sources
  | add <dir> [system] | remove-source <id> | default <system> <route|-> | bios
  | launch <id|file> [--system s] [--route r] [--check] [--frames N]
  | check [system...] [--frames N]   (one bounded run per available route)`;

function placeholder(system: string): Game {
  return {
    id: 0,
    system,
    path: "",
    file: "",
    name: "(probe)",
    source: "probe",
    size: 0,
    mtime: 0,
    crc: null,
    md5: null,
    title: null,
    description: null,
    developer: null,
    year: null,
    region: null,
    serial: null,
    dat: null,
    route: null,
    favorite: 0,
    playCount: 0,
    lastPlayed: null,
  };
}

export async function runLibrary(args: string[]): Promise<number> {
  const [command, ...rest] = args;
  switch (command) {
    case "scan":
      return print(await scanLibrary());
    case "systems": {
      const counts = systemCounts();
      const rows = [];
      for (const system of (await loadSystems()).systems) {
        const routes = await routesFor(system.id);
        rows.push({
          system: system.id,
          games: counts[system.id] ?? 0,
          routes: routes
            .map((route) => `${route.available ? "+" : "-"}${route.id}`)
            .join(" "),
        });
      }
      console.table(rows);
      return 0;
    }
    case "games":
      return print(
        gamesFor(rest[0]).map((game) => ({
          id: game.id,
          system: game.system,
          name: game.title ?? game.name,
          crc: game.crc,
          dat: game.dat,
          file: game.file,
        })),
      );
    case "routes":
      if (!rest[0]) break;
      return print(await routesFor(rest[0]));
    case "sources":
      return print(listSources());
    case "add":
      if (!rest[0]) break;
      return print(await addFolder(rest[0], rest[1]));
    case "remove-source":
      removeSource(Number(rest[0]));
      return print(listSources());
    case "default":
      if (!rest[0] || !rest[1]) break;
      setDefaultRoute(rest[0], rest[1] === "-" ? null : rest[1]);
      return print(await routesFor(rest[0]));
    case "bios":
      return print(await biosOverview());
    case "launch": {
      if (!rest[0]) break;
      const game = await findGame(rest[0], option(rest, "--system"));
      const result = await launchGame(game, {
        route: option(rest, "--route"),
        check: rest.includes("--check"),
        frames: Number(option(rest, "--frames") ?? 120),
      });
      print(result);
      return result.ok ? 0 : 1;
    }
    case "check": {
      const frames = Number(option(rest, "--frames") ?? 120);
      const wanted = rest.filter(
        (arg, i) => !arg.startsWith("--") && rest[i - 1] !== "--frames",
      );
      const rows = [];
      for (const system of (await loadSystems()).systems) {
        if (wanted.length && !wanted.includes(system.id)) continue;
        const games = gamesFor(system.id);
        for (const route of await routesFor(system.id)) {
          if (!route.available) continue;
          const found = games.find(
            (item) =>
              !route.extensions ||
              route.extensions.includes(
                item.path.split(".").pop()!.toLowerCase(),
              ),
          );
          // Release emulators are probed with help/version arguments, so they need no game.
          const game =
            found ??
            (route.kind === "bin" ? placeholder(system.id) : undefined);
          if (!game) continue;
          const result = await launchGame(game, {
            route: route.id,
            check: true,
            frames,
          });
          rows.push({
            system: system.id,
            route: route.id,
            game: game.title ?? game.name,
            ok: result.ok,
            exit: result.alive
              ? "alive (stopped)"
              : (result.exitCode ?? result.error),
            ms: result.ms,
            output: (result.output ?? result.error ?? "")
              .split("\n")
              .slice(-2)
              .join(" | ")
              .slice(0, 160),
          });
          console.error(
            `${result.ok ? "ok  " : "FAIL"} ${system.id} ${route.id} ${game.title ?? game.name} (${result.ms} ms)`,
          );
        }
      }
      print(rows);
      return rows.every((row) => row.ok) ? 0 : 1;
    }
  }
  console.error(usage);
  return 2;
}
