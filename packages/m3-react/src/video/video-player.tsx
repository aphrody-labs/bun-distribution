// Material 3 video player built from the md-* wrappers of this package.
import * as React from "react";
import { MdIconButton } from "../wrappers/iconbutton.js";
import { MdMenu, MdMenuItem } from "../wrappers/menu.js";
import { MdSlider } from "../wrappers/slider.js";
import { MdCircularProgress } from "../wrappers/progress.js";
import { formatClock, PLAYBACK_RATES, useVideoPlayer, type VideoPlayerOptions } from "./use-video-player.js";

/** Material Symbols (24 dp, filled) paths: play_arrow, pause, volume_up, volume_off, closed_caption, fullscreen, replay and forward. */
const PATHS = {
  play: "M8 5v14l11-7z",
  pause: "M6 19h4V5H6v14zm8-14v14h4V5h-4z",
  volume: "M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02z",
  mute: "M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z",
  captions:
    "M19 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm-8 7H9.500v-.500h-2v3h2V13H11v1a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1zm7 0h-1.500v-.500h-2v3h2V13H18v1a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1z",
  fullscreen: "M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z",
} as const;

function Glyph({ name }: { name: keyof typeof PATHS }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}

export interface M3VideoPlayerProps extends VideoPlayerOptions {
  src: string;
  title: string;
  poster?: string;
  /** WebVTT track shown when captions are on. */
  captions?: { src: string; srcLang: string; label: string };
  className?: string;
  /** Rendered over the video once it has ended (for example an up-next card). */
  endScreen?: React.ReactNode;
}

/**
 * A keyboard-complete video player. Controls are `md-icon-button`, `md-slider` and `md-menu`; colors, shape and
 * state layers come from the M3 roles, so the player follows whatever theme the page sets.
 */
export function M3VideoPlayer({ src, title, poster, captions, className, endScreen, ...options }: M3VideoPlayerProps) {
  const video = React.useRef<HTMLVideoElement>(null);
  const shell = React.useRef<HTMLDivElement>(null);
  // The wrapper does not forward `id`, so the menu anchors on a plain element that carries one.
  const anchorId = `m3-video-rate-${React.useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [menu, setMenu] = React.useState(false);
  const player = useVideoPlayer(video, shell, options);
  const duration = player.duration || 0;
  const step = options.frameDuration ?? 1 / 30;
  return (
    <div
      ref={shell}
      className={["m3-video", className].filter(Boolean).join(" ")}
      role="group"
      aria-label={`Lecteur : ${title}`}
      tabIndex={0}
      onKeyDown={player.onKeyDown}
    >
      <video
        ref={video}
        src={src}
        poster={poster}
        playsInline
        preload="metadata"
        aria-label={title}
        onClick={player.toggle}
        {...player.videoProps}
      >
        {captions && (
          <track kind="captions" src={captions.src} srcLang={captions.srcLang} label={captions.label} default />
        )}
      </video>
      {player.message && (
        <p className="m3-video-toast" role="status">
          {player.message}
        </p>
      )}
      {!player.playing && !player.ended && (
        <MdIconButton className="m3-video-big" aria-label="Lire" onClick={player.toggle}>
          <Glyph name="play" />
        </MdIconButton>
      )}
      {player.ended && endScreen && <div className="m3-video-end">{endScreen}</div>}
      <div className="m3-video-controls">
        <MdSlider
          className="m3-video-seek"
          min={0}
          max={Math.max(step, duration)}
          step={step}
          value={Math.min(player.time, duration)}
          labeled={false}
          aria-label={`Position dans ${title}`}
          aria-valuetext={`${formatClock(player.time)} sur ${formatClock(duration)}`}
          onInput={(event: Event) => player.seek(Number((event.target as HTMLInputElement).value))}
        />
        <div className="m3-video-bar">
          <MdIconButton aria-label={player.playing ? "Pause (K)" : "Lire (K)"} onClick={player.toggle}>
            <Glyph name={player.playing ? "pause" : "play"} />
          </MdIconButton>
          <MdIconButton aria-label="Reculer de 10 secondes (J)" onClick={() => player.seekBy(-10)}>
            <span aria-hidden="true">−10</span>
          </MdIconButton>
          <MdIconButton aria-label="Avancer de 10 secondes (L)" onClick={() => player.seekBy(10)}>
            <span aria-hidden="true">+10</span>
          </MdIconButton>
          <MdIconButton
            aria-label={player.muted || player.volume === 0 ? "Activer le son (M)" : "Couper le son (M)"}
            toggle
            selected={player.muted || player.volume === 0}
            data-pressed={String(player.muted || player.volume === 0)}
            onClick={player.toggleMuted}
          >
            <Glyph name={player.muted || player.volume === 0 ? "mute" : "volume"} />
          </MdIconButton>
          <MdSlider
            className="m3-video-volume"
            min={0}
            max={1}
            step={0.05}
            value={player.muted ? 0 : player.volume}
            labeled={false}
            aria-label="Volume"
            onInput={(event: Event) => player.setVolume(Number((event.target as HTMLInputElement).value))}
          />
          <output className="m3-video-time">
            {formatClock(player.time)} / {formatClock(duration)}
          </output>
          <span className="m3-video-spacer" />
          <span className="m3-video-rate" id={anchorId}>
            <MdIconButton
              aria-label={`Vitesse de lecture : ${player.rate}×`}
              aria-haspopup="menu"
              aria-expanded={menu}
              onClick={() => setMenu(open => !open)}
            >
              <span aria-hidden="true">{player.rate}×</span>
            </MdIconButton>
            <MdMenu anchor={anchorId} open={menu} onClosed={() => setMenu(false)}>
              {PLAYBACK_RATES.map(rate => (
                <MdMenuItem
                  key={rate}
                  selected={rate === player.rate}
                  onClick={() => {
                    player.setRate(rate);
                    setMenu(false);
                  }}
                >
                  <div slot="headline">{rate}×</div>
                </MdMenuItem>
              ))}
            </MdMenu>
          </span>
          {captions && (
            <MdIconButton
              aria-label="Sous-titres (C)"
              toggle
              selected={player.captions}
              data-pressed={String(player.captions)}
              onClick={player.toggleCaptions}
            >
              <Glyph name="captions" />
            </MdIconButton>
          )}
          <MdIconButton
            aria-label={player.fullscreen ? "Quitter le plein écran (F)" : "Plein écran (F)"}
            toggle
            selected={player.fullscreen}
            data-pressed={String(player.fullscreen)}
            onClick={player.toggleFullscreen}
          >
            <Glyph name="fullscreen" />
          </MdIconButton>
        </div>
      </div>
      {duration === 0 && !player.message && (
        <span className="m3-video-loading">
          <MdCircularProgress indeterminate aria-label="Chargement" />
        </span>
      )}
    </div>
  );
}
