// SPDX-License-Identifier: Apache-2.0
// Desktop surfaces rendered in the extra Tauri windows (crates/ui/app/src/integration.rs):
//   ?view=splash  loading screen with the animated pet, closed once the main UI is ready
//   ?view=pet     desktop pet: wanders, looks at the pointer, click opens Aphrody, drag moves it
//   ?view=widget  desktop quick-actions/status card (always on bottom)
// All three reuse the single pet atlas from @aphrody/identity (no copied assets).
import { AphrodyPet, spriteStyle, type PetFrame, PET } from "@aphrody/identity";
import { PET_ATLAS_URL } from "@aphrody/identity/atlas";
import { Button, Icon } from "@aphrody/m3-primitives";
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import {
  GAZE_RADIUS,
  gazeToward,
  idleDelay,
  type PetMode,
  trackFor,
  WALK_PERIOD,
  WALK_STEP,
  walkDirection,
  walkDuration,
} from "./pet-behavior";
import { isTauri, tauriInvoke } from "./tauri-bridge";

/** Event carrying the pointer position relative to the pet window (integration.rs). */
const PET_CURSOR_EVENT = "aphrody://pet/cursor";

/** Transparent windows: drop the page background painted by app.css. */
function useTransparentPage() {
  useEffect(() => {
    for (const element of [document.documentElement, document.body]) {
      element.style.background = "transparent";
      element.style.overflow = "hidden";
    }
  }, []);
}

function listen<T>(name: string, handler: (payload: T) => void): () => void {
  let unlisten: (() => void) | undefined;
  let cancelled = false;
  const subscribe = async () => {
    const stop = await window.__TAURI__?.event?.listen(name, (event) =>
      handler(event.payload as T),
    );
    if (cancelled) stop?.();
    else unlisten = stop;
  };
  void subscribe();
  return () => {
    cancelled = true;
    unlisten?.();
  };
}

/** Loading screen: the pet waves while the main window boots. */
export function SplashScreen() {
  useTransparentPage();
  return (
    <main className="flex h-screen w-screen items-center justify-center">
      <div className="flex flex-col items-center gap-3 rounded-[28px] bg-surface-container-high/95 px-8 pb-6 pt-4 shadow-lg">
        <AphrodyPet
          atlasUrl={PET_ATLAS_URL}
          animation={PET.tracks.waving ? "waving" : "idle"}
          height={208}
          label="Aphrody is starting"
        />
        <span className="text-title-medium text-on-surface">Aphrody</span>
        <div
          className="h-1 w-40 overflow-hidden rounded-full bg-secondary-container"
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a native <progress> cannot host the animated child bar; the ARIA progressbar role is kept
          role="progressbar"
          aria-label="Loading"
        >
          <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
        </div>
      </div>
    </main>
  );
}

const PET_HEIGHT = 188;

/** Native desktop pet. The window is click-through outside the sprite rectangle reported here. */
export function DesktopPet() {
  useTransparentPage();
  const sprite = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<PetMode>("idle");
  const [hovering, setHovering] = useState(false);
  const [gaze, setGaze] = useState<PetFrame | null>(null);
  const press = useRef<{ x: number; y: number; dragging: boolean } | null>(null);

  // Report the sprite rectangle so the native poller makes everything else click-through.
  useEffect(() => {
    const report = () => {
      const rect = sprite.current?.getBoundingClientRect();
      if (rect)
        void tauriInvoke("aphrody_pet", {
          action: {
            action: "hit_rect",
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
        });
    };
    report();
    window.addEventListener("resize", report);
    return () => window.removeEventListener("resize", report);
  }, []);

  // Wander: idle for a while, then stroll along the bottom of the screen.
  useEffect(() => {
    if (mode === "idle") {
      const timer = setTimeout(() => setMode(walkDirection()), idleDelay());
      return () => clearTimeout(timer);
    }
    const dx = mode === "walk-left" ? -WALK_STEP : WALK_STEP;
    const step = setInterval(async () => {
      if (press.current) return;
      const result = await tauriInvoke<{ blocked: boolean }>("aphrody_pet", {
        action: { action: "step", dx },
      });
      if (result?.blocked) setMode(mode === "walk-left" ? "walk-right" : "walk-left");
    }, WALK_PERIOD);
    const stop = setTimeout(() => setMode("idle"), walkDuration());
    return () => {
      clearInterval(step);
      clearTimeout(stop);
    };
  }, [mode]);

  // Follow the pointer with the eyes while idle.
  useEffect(
    () =>
      listen<{ x: number; y: number }>(PET_CURSOR_EVENT, (cursor) => {
        const rect = sprite.current?.getBoundingClientRect();
        if (!rect) return;
        const eyes = { x: rect.x + rect.width / 2, y: rect.y + rect.height * 0.36 };
        const inside =
          cursor.x >= rect.left &&
          cursor.x < rect.right &&
          cursor.y >= rect.top &&
          cursor.y < rect.bottom;
        setHovering(inside);
        setGaze(inside ? null : gazeToward(cursor, eyes, GAZE_RADIUS));
      }),
    [],
  );

  const onPointerDown = (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    press.current = { x: event.screenX, y: event.screenY, dragging: false };
  };
  const onPointerMove = (event: ReactPointerEvent) => {
    const current = press.current;
    if (!current || current.dragging || (event.buttons & 1) === 0) return;
    if (Math.hypot(event.screenX - current.x, event.screenY - current.y) > 4) {
      current.dragging = true;
      void tauriInvoke("aphrody_pet", { action: { action: "start_dragging" } }).finally(() => {
        press.current = null;
      });
    }
  };
  const onPointerUp = () => {
    const current = press.current;
    press.current = null;
    if (current && !current.dragging)
      void tauriInvoke("aphrody_pet", { action: { action: "open_main" } });
  };

  const scale = PET_HEIGHT / PET.atlas.cellHeight;
  const still = mode === "idle" && !hovering ? gaze : null;
  return (
    <main className="flex h-screen w-screen items-end justify-center select-none">
      <div
        ref={sprite}
        title="Aphrody: click to open, drag to move, right-click to hide"
        className="cursor-pointer"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onContextMenu={(event) => {
          event.preventDefault();
          void tauriInvoke("aphrody_pet", { action: { action: "hide" } });
        }}
      >
        {still ? (
          <div
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- the still pet is a CSS sprite (background-image offsets); an img element cannot render the atlas frame
            role="img"
            aria-label={PET.displayName}
            style={{
              backgroundImage: `url("${PET_ATLAS_URL}")`,
              backgroundRepeat: "no-repeat",
              ...spriteStyle(still, scale),
            }}
          />
        ) : (
          <AphrodyPet
            atlasUrl={PET_ATLAS_URL}
            animation={trackFor(mode, hovering)}
            height={PET_HEIGHT}
          />
        )}
      </div>
    </main>
  );
}

interface IntegrationState {
  pet: boolean;
  widget: boolean;
  autostart: boolean;
}

function widgetAction(action: string) {
  return tauriInvoke<IntegrationState>("aphrody_widget", { action: { action } });
}

/** Desktop widget: clock, host and quick actions. */
export function DesktopWidget() {
  useTransparentPage();
  const [now, setNow] = useState(() => new Date());
  const [host, setHost] = useState("");
  const [state, setState] = useState<IntegrationState | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    if (isTauri())
      void tauriInvoke<string>("plugin:os|hostname").then((name) => setHost(name ?? ""));
    return () => clearInterval(timer);
  }, []);

  const run = (action: string) => {
    const apply = async () => {
      const next = await widgetAction(action);
      if (next) setState(next);
    };
    void apply();
  };

  return (
    <main className="h-screen w-screen p-2">
      <section className="flex h-full flex-col gap-2 rounded-[24px] bg-surface-container/90 p-3 text-on-surface shadow-md backdrop-blur">
        <header
          className="flex cursor-grab items-center gap-2"
          onPointerDown={(event) => {
            if (event.button === 0 && (event.target as HTMLElement).closest("button") === null)
              run("start_dragging");
          }}
        >
          <div
            aria-hidden
            style={{
              backgroundImage: `url("${PET_ATLAS_URL}")`,
              backgroundRepeat: "no-repeat",
              ...spriteStyle(
                PET.tracks.idle?.frames[0] ?? PET.directions[0]!,
                36 / PET.atlas.cellHeight,
              ),
            }}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-title-large leading-none tabular-nums">
              {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
            <span className="truncate text-label-small text-on-surface-variant">
              {now.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
              {host ? ` · ${host}` : ""}
            </span>
          </div>
          <button
            type="button"
            aria-label="Hide widget"
            className="rounded-full p-1 text-on-surface-variant hover:bg-on-surface/10"
            onClick={() => run("hide")}
          >
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="mt-auto grid grid-cols-3 gap-2">
          <Button variant="filled" size="sm" onClick={() => run("open_main")}>
            <Icon name="open_in_new" size={18} />
            <span>Open</span>
          </Button>
          <Button variant="tonal" size="sm" onClick={() => run("quick_ask")}>
            <Icon name="bolt" size={18} />
            <span>Ask</span>
          </Button>
          <Button
            variant={state?.pet ? "tonal" : "outlined"}
            size="sm"
            onClick={() => run("toggle_pet")}
          >
            <Icon name="pets" size={18} />
            <span>Pet</span>
          </Button>
        </div>
      </section>
    </main>
  );
}
