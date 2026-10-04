// Type declarations for @aphrody/assets (web bundlers resolve assets to URLs).

declare module "@aphrody/assets/icons/*.png" {
  const value: string;
  export default value;
}

declare module "@aphrody/assets/icons/*.jpg" {
  const value: string;
  export default value;
}

declare module "@aphrody/assets/images/*.png" {
  const value: string;
  export default value;
}

declare module "@aphrody/assets/images/*.jpg" {
  const value: string;
  export default value;
}

declare module "@aphrody/assets/svgs/*.svg" {
  import type { FC } from "react";
  const content: FC<Record<string, unknown>>;
  export default content;
}

declare module "*.svg" {
  const src: string;
  export default src;
  export const ReactComponent: React.FC<React.SVGProps<SVGSVGElement>>;
}

declare module "@aphrody/assets/videos/*.mp4" {
  const value: string;
  export default value;
}

declare module "@aphrody/assets/sounds/*.mp3" {
  const value: string;
  export default value;
}

declare module "@aphrody/assets/lottie/*.json" {
  const value: object;
  export default value;
}

// Relative imports inside this package (icons/index.ts, images/index.ts, sounds/index.ts): a URL
// on the web (Bun, Vite).
declare module "*.png" {
  const value: string;
  export default value;
}

declare module "*.jpg" {
  const value: string;
  export default value;
}

declare module "*.mp3" {
  const value: string;
  export default value;
}

declare module "*.mp4" {
  const value: string;
  export default value;
}

declare module "*.ogg" {
  const value: string;
  export default value;
}
