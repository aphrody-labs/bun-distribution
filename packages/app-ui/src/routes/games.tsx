// SPDX-License-Identifier: Apache-2.0
import { Button, Card, CircularProgress, Icon } from "@aphrody/m3-primitives";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

interface GamePackage {
  id: string;
  name: string;
  description: string;
  version: string;
  license: string;
}

function gamePackage(value: unknown): value is GamePackage {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return entry.category === "games" && typeof entry.id === "string" && /^game-[a-z0-9][a-z0-9-]*$/.test(entry.id)
    && [entry.name, entry.description, entry.version, entry.license].every(field => typeof field === "string");
}

/** The common M3 shell hosts the qualified product player, not a second emulator. */
export function GamesRoute() {
  const { core } = useParams<{ core?: string }>();
  const navigate = useNavigate();
  const [games, setGames] = useState<GamePackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const selected = games.find(game => game.id === core);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(new Error("The gaming registry did not respond in time.")), 15_000);
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const response = await fetch("/registry.json", { signal: controller.signal, cache: "no-cache" });
        if (!response.ok) throw new Error(`Gaming registry unavailable (${response.status}).`);
        const data: unknown = await response.json();
        if (!data || typeof data !== "object" || !Array.isArray((data as { packages?: unknown }).packages)) throw new Error("The gaming registry is invalid.");
        const packages = (data as { packages: unknown[] }).packages.filter(gamePackage);
        if (active && !controller.signal.aborted) setGames(packages);
      } catch (cause) {
        // An unmounted route must not update the shell or restart a game.
        if (active) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      } finally {
        clearTimeout(timeout);
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [revision]);

  useEffect(() => {
    const previous = document.title;
    document.title = `${selected?.name ?? "Games"} · Bun OS`;
    return () => { document.title = previous; };
  }, [selected?.name]);

  async function fullscreen() {
    try {
      if (!frame.current?.requestFullscreen) throw new Error("Fullscreen is unavailable in this browser.");
      await frame.current.requestFullscreen();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  return (
    <section className="flex h-full min-h-0 flex-col gap-6 overflow-auto p-4 medium:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-headline-medium text-on-surface">Games</h1>
          <p className="max-w-3xl text-body-large text-on-surface-variant">Play Bun Engine in your browser with bundled open-source test games, keyboard, touch and controller support.</p>
        </div>
        <Button variant="tonal" className="min-h-12" disabled={loading} onClick={() => setRevision(value => value + 1)}>
          <Icon name="refresh" size={20} /> Refresh games
        </Button>
      </header>
      {error && <Card variant="outlined" className="p-4"><p role="alert" className="text-body-large text-error">{error}</p></Card>}
      {loading && <div className="flex items-center gap-3" aria-busy="true"><span aria-hidden="true"><CircularProgress radius={12} progress={25} className="animate-spin motion-reduce:animate-none" /></span><p className="text-body-large">Loading games…</p></div>}
      {!loading && !error && games.length === 0 && <Card variant="outlined" className="p-6"><h2 className="text-title-large">No games published yet</h2><p className="mt-2 text-body-large text-on-surface-variant">Qualified emulator packages will appear here once they are published.</p></Card>}
      {!loading && core && !selected && !error && <p role="status" className="text-body-large">This emulator is not in the published gaming registry.</p>}
      {selected && (
        <Card variant="outlined" className="flex flex-col gap-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-title-large">{selected.name}</h2>
            <div className="flex flex-wrap gap-2">
              <Button variant="tonal" className="min-h-12" onClick={() => void fullscreen()}>Fullscreen</Button>
              <Button variant="outlined" className="min-h-12" onClick={() => navigate("/games")}>Stop and close</Button>
            </div>
          </div>
          <p className="text-body-large text-on-surface-variant">Choose a bundled test game in the player, or open a local ROM. Stop and close ends the browser session.</p>
          <iframe ref={frame} key={selected.id} src={`/apps/${selected.id}/index.html`} title={`${selected.name} game player`}
            className="min-h-[32rem] w-full rounded-medium border border-outline-variant bg-surface" style={{ height: "72vh" }}
            allow="autoplay; fullscreen; gamepad; cross-origin-isolated" allowFullScreen />
        </Card>
      )}
      {games.length > 0 && <div className="flex flex-col gap-4"><h2 className="text-title-large">Available emulators</h2>
        <ul role="list" className="grid grid-cols-1 gap-4 medium:grid-cols-2 expanded:grid-cols-3">
          {games.map(game => <li key={game.id}><Card variant={selected?.id === game.id ? "filled" : "outlined"} className="flex h-full flex-col gap-3 p-5">
            <h3 className="text-title-large">{game.name}</h3>
            <p className="flex-1 text-body-large text-on-surface-variant">{game.description}</p>
            <p className="text-body-medium text-on-surface-variant">Version {game.version} · {game.license}</p>
            <Button className="min-h-12 self-start" disabled={selected?.id === game.id} onClick={() => navigate(`/games/${game.id}`)}>{selected?.id === game.id ? "Player open" : `Play ${game.name}`}</Button>
          </Card></li>)}
        </ul>
      </div>}
    </section>
  );
}
