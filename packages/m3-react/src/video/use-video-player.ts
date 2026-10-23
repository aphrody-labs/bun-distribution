// Video playback state for React: one hook owns the <video> element's state and the keyboard contract.
// Import: `import { useVideoPlayer } from "@aphrody/m3-react/video"`.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export interface VideoPlayerOptions {
  /** Seconds per frame, used by frame stepping and the seek step. Default 1/30. */
  frameDuration?: number;
  /** Called with the playback position whenever it changes (about 4 times a second). */
  onTime?: (seconds: number) => void;
  onEnded?: () => void;
  /** Called when the user asks for theater mode (key `t`). */
  onTheater?: () => void;
  /** Start playing as soon as metadata is available. Default false. */
  autoPlay?: boolean;
  /** Initial muted state. Default false. */
  muted?: boolean;
}

export interface VideoPlayerState {
  time: number;
  duration: number;
  playing: boolean;
  ended: boolean;
  rate: number;
  muted: boolean;
  volume: number;
  captions: boolean;
  fullscreen: boolean;
  /** A short message to announce (autoplay refused, speed change, load failure); empty when none. */
  message: string;
}

export interface VideoPlayerApi extends VideoPlayerState {
  toggle(): void;
  seek(seconds: number): void;
  seekBy(delta: number): void;
  setRate(rate: number): void;
  setVolume(volume: number): void;
  toggleMuted(): void;
  toggleCaptions(): void;
  toggleFullscreen(): void;
  /** Spread on the <video> element. */
  videoProps: {
    onPlay(): void;
    onPause(): void;
    onEnded(): void;
    onLoadedMetadata(): void;
    onTimeUpdate(): void;
    onError(): void;
  };
  /** Spread on the focusable container: Space/K, J/L, arrows, M, C, F, T, `<` `>`, `,` `.` and 0-9. */
  onKeyDown(event: KeyboardEvent<HTMLElement>): void;
}

/**
 * Owns playback state for a `<video>` and its container.
 * Keys: Space/K play, J/L ±10 s, ←/→ ±5 s, ↑/↓ volume, M mute, C captions, F fullscreen, T theater,
 * `<`/`>` speed, `,`/`.` frame step while paused, 0-9 jump to 0-90 %.
 */
export function useVideoPlayer(
  video: RefObject<HTMLVideoElement | null>,
  container: RefObject<HTMLElement | null>,
  options: VideoPlayerOptions = {},
): VideoPlayerApi {
  const frame = options.frameDuration ?? 1 / 30;
  const [state, setState] = useState<VideoPlayerState>({
    time: 0,
    duration: 0,
    playing: false,
    ended: false,
    rate: 1,
    muted: options.muted ?? false,
    volume: 1,
    captions: true,
    fullscreen: false,
    message: "",
  });
  const patch = useCallback((next: Partial<VideoPlayerState>) => setState(previous => ({ ...previous, ...next })), []);
  const callbacks = useRef(options);
  callbacks.current = options;
  const messageTimer = useRef<number>(0);

  const announce = useCallback(
    (message: string, ms = 1400) => {
      window.clearTimeout(messageTimer.current);
      patch({ message });
      if (ms > 0) messageTimer.current = window.setTimeout(() => patch({ message: "" }), ms);
    },
    [patch],
  );
  useEffect(() => () => window.clearTimeout(messageTimer.current), []);

  // Mirror controlled state onto the element.
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.playbackRate = state.rate;
    element.muted = state.muted;
    element.volume = state.volume;
    for (const track of Array.from(element.textTracks)) track.mode = state.captions ? "showing" : "hidden";
  }, [video, state.rate, state.muted, state.volume, state.captions]);

  useEffect(() => {
    const update = () => patch({ fullscreen: !!container.current && document.fullscreenElement === container.current });
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, [container, patch]);

  const seek = useCallback(
    (seconds: number) => {
      const element = video.current;
      if (!element) return;
      const limit = Number.isFinite(element.duration) ? element.duration : seconds;
      element.currentTime = Math.max(0, Math.min(limit, seconds));
      patch({ ended: false });
    },
    [video, patch],
  );
  const seekBy = useCallback((delta: number) => seek((video.current?.currentTime ?? 0) + delta), [video, seek]);

  const toggle = useCallback(() => {
    const element = video.current;
    if (!element) return;
    if (element.paused || element.ended) {
      if (element.ended) element.currentTime = 0;
      void element.play().catch(() => announce("Appuyez sur Lire pour démarrer la vidéo.", 0));
    } else element.pause();
  }, [video, announce]);

  const setRate = useCallback((rate: number) => patch({ rate }), [patch]);
  const setVolume = useCallback(
    (volume: number) => patch({ volume: Math.max(0, Math.min(1, volume)), muted: volume === 0 }),
    [patch],
  );
  const toggleMuted = useCallback(() => setState(previous => ({ ...previous, muted: !previous.muted })), []);
  const toggleCaptions = useCallback(() => setState(previous => ({ ...previous, captions: !previous.captions })), []);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void container.current?.requestFullscreen();
  }, [container]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("input, select, textarea, md-slider, md-outlined-select, md-filled-select")) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const element = video.current;
    if (!element) return;
    const key = event.key.toLowerCase();
    const run = (action: () => void) => {
      event.preventDefault();
      action();
    };
    if (
      key === "k" ||
      (key === " " &&
        !target.closest("button, a, summary, md-icon-button, md-text-button, md-filled-button, md-filled-tonal-button"))
    )
      run(toggle);
    else if (key === "j") run(() => seekBy(-10));
    else if (key === "l") run(() => seekBy(10));
    else if (key === "arrowleft") run(() => seekBy(-5));
    else if (key === "arrowright") run(() => seekBy(5));
    else if (key === "arrowup") run(() => setVolume(state.volume + 0.1));
    else if (key === "arrowdown") run(() => setVolume(state.volume - 0.1));
    else if (key === "m") run(toggleMuted);
    else if (key === "c") run(toggleCaptions);
    else if (key === "f") run(toggleFullscreen);
    else if (key === "t" && callbacks.current.onTheater) run(callbacks.current.onTheater);
    else if (key === ">" || key === "<")
      run(() => {
        const index = PLAYBACK_RATES.indexOf(state.rate as (typeof PLAYBACK_RATES)[number]);
        const next =
          PLAYBACK_RATES[
            Math.max(0, Math.min(PLAYBACK_RATES.length - 1, (index < 0 ? 2 : index) + (key === ">" ? 1 : -1)))
          ]!;
        setRate(next);
        announce(`Vitesse ${next}×`);
      });
    else if ((key === "," || key === ".") && element.paused) run(() => seekBy(key === "." ? frame : -frame));
    else if (/^[0-9]$/.test(key))
      run(() => seek((Number(key) / 10) * (Number.isFinite(element.duration) ? element.duration : 0)));
  };

  const videoProps: VideoPlayerApi["videoProps"] = {
    onPlay: () => patch({ playing: true, ended: false, message: "" }),
    onPause: () => patch({ playing: false }),
    onEnded: () => {
      patch({ playing: false, ended: true });
      callbacks.current.onEnded?.();
    },
    onLoadedMetadata: () => {
      const element = video.current;
      if (!element) return;
      patch({ duration: Number.isFinite(element.duration) ? element.duration : 0 });
      if (callbacks.current.autoPlay)
        void element.play().catch(() => announce("Appuyez sur Lire pour démarrer la vidéo.", 0));
    },
    onTimeUpdate: () => {
      const now = video.current?.currentTime ?? 0;
      patch({ time: now });
      callbacks.current.onTime?.(now);
    },
    onError: () => announce("Cette vidéo n’a pas pu être chargée.", 0),
  };

  return {
    ...state,
    toggle,
    seek,
    seekBy,
    setRate,
    setVolume,
    toggleMuted,
    toggleCaptions,
    toggleFullscreen,
    videoProps,
    onKeyDown,
  };
}

/** `m:ss` or `h:mm:ss`. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}
