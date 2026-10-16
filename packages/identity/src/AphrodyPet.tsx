// SPDX-License-Identifier: Apache-2.0
// The animated Aphrody pet: one atlas, CSS background positions, a requestAnimationFrame clock.
// Honours `prefers-reduced-motion` (first frame only). The atlas URL is a prop so that a surface
// chooses how it ships the 1.5 MB sheet (`@aphrody/identity/atlas`, an asset URL, a CDN).
import { type CSSProperties, useEffect, useState } from "react";
import { frameAt, PET, type PetAnimation, type PetTrack, spriteStyle } from "./pet";

export interface AphrodyPetProps {
  /** Atlas image URL, e.g. `PET_ATLAS_URL` from `@aphrody/identity/atlas`. */
  atlasUrl: string;
  /** Track to play (default `idle`). Unknown names fall back to `idle`. */
  animation?: PetAnimation;
  /** Rendered height in CSS pixels (default: the 208 px cell). */
  height?: number;
  /** Loop the track (default true); a single pass holds its last frame. */
  loop?: boolean;
  label?: string;
  className?: string;
  style?: CSSProperties;
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function AphrodyPet({ animation = "idle", ...props }: AphrodyPetProps) {
  const name = PET.tracks[animation] ? animation : "idle";
  const track = PET.tracks[name];
  if (!track) throw new Error("bundled pet without an idle track");
  // Keyed by track name: a track change remounts the clock, so it restarts from 0 without a state reset in an effect.
  return <PetSprite key={name} track={track} {...props} />;
}

function PetSprite({
  atlasUrl,
  track,
  height,
  loop = true,
  label,
  className,
  style,
}: Omit<AphrodyPetProps, "animation"> & { track: PetTrack }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (track.kind === "still" || prefersReducedMotion()) return;
    const start = performance.now();
    let handle = requestAnimationFrame(function tick(now) {
      setElapsed(now - start);
      handle = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(handle);
  }, [track]);

  const frame = frameAt(track, elapsed, loop);
  const scale = (height ?? PET.atlas.cellHeight) / PET.atlas.cellHeight;
  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- sprite décoratif en background CSS : un <img> imposerait un src et un rendu différents
      role="img"
      aria-label={label ?? PET.displayName}
      className={className}
      style={{
        backgroundImage: `url("${atlasUrl}")`,
        backgroundRepeat: "no-repeat",
        ...spriteStyle(frame, scale),
        ...style,
      }}
    />
  );
}
