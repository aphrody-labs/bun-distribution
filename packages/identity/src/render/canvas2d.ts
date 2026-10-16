// SPDX-License-Identifier: Apache-2.0
// Canvas 2D drawer: the fallback when WebGPU is unavailable. The 3d mode is approximated by
// stacking offset copies of the sprite, back to front, so the depth cue survives without a GPU.
import {
  fitRect,
  sliceDepths,
  type DrawOptions,
  type PetDrawer,
  type PetPose,
} from "./frames";

export function createCanvas2dDrawer(
  ctx: CanvasRenderingContext2D,
  atlas: CanvasImageSource,
): PetDrawer {
  return {
    backend: "canvas2d",
    draw(pose: PetPose, options: DrawOptions) {
      const canvas = ctx.canvas;
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);
      const pad = Math.round(Math.min(width, height) * 0.04);
      const rect = fitRect(pose.frame, width, height, pad);
      const sx = pose.frame.x;
      const sy = pose.frame.y;
      const sw = pose.frame.w;
      const sh = pose.frame.h;
      if (options.mode === "2d") {
        ctx.drawImage(atlas, sx, sy, sw, sh, rect.x, rect.y, rect.w, rect.h);
        return;
      }
      const offsets = sliceDepths(options.slices, options.depth);
      const dx = Math.sin(options.yaw);
      const scaleX = Math.max(Math.abs(Math.cos(options.yaw)), 0.05);
      const drawW = rect.w * scaleX;
      ctx.save();
      offsets.forEach((z, i) => {
        const shade = 0.75 + (0.25 * i) / Math.max(offsets.length - 1, 1);
        ctx.globalAlpha = 1;
        ctx.filter = `brightness(${(shade * 100).toFixed(0)}%)`;
        ctx.drawImage(
          atlas,
          sx,
          sy,
          sw,
          sh,
          rect.x + (rect.w - drawW) / 2 + z * dx,
          rect.y,
          drawW,
          rect.h,
        );
      });
      ctx.restore();
    },
    dispose() {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    },
  };
}
