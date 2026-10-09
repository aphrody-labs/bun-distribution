// SPDX-License-Identifier: Apache-2.0
// Ambient module types for applications built with @aphrody/m3. Reference them once:
//   /// <reference types="@aphrody/m3/client" />
// or add "@aphrody/m3/client" to `compilerOptions.types`.

/** Sheets and fonts served by the m3 plugin (`m3:theme.css`, `m3:symbols.css`, `m3:fonts.css`, ...). */
declare module "m3:*" {}

/** `?url` imports: the URL of an emitted `.svg` asset, or any other asset inlined as a `data:` URL. */
declare module "*?url" {
  const url: string;
  export default url;
}

/** Side-effect and scoped CSS imports. */
declare module "*.css" {}

/** Next.js App Router compatibility module types for @aphrody/m3/app */
declare module "next/link" {
  import type { ComponentType, AnchorHTMLAttributes, ReactNode, Ref } from "react";
  export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
    href: string | { pathname?: string; query?: Record<string, any>; hash?: string };
    replace?: boolean;
    scroll?: boolean;
    prefetch?: boolean | null;
    ref?: Ref<HTMLAnchorElement>;
    children?: ReactNode;
  }
  const Link: ComponentType<LinkProps>;
  export default Link;
}

declare module "next/navigation" {
  export function redirect(url: string, type?: "replace" | "push"): never;
  export function permanentRedirect(url: string, type?: "replace" | "push"): never;
  export function notFound(): never;
  export function useRouter(): {
    push(href: string): void;
    replace(href: string): void;
    refresh(): void;
    back(): void;
    forward(): void;
    prefetch(href: string): void;
  };
  export function usePathname(): string;
  export function useSearchParams(): URLSearchParams;
  export function useParams(): Record<string, string | string[]>;
}

declare module "next/headers" {
  export function headers(): Headers;
  export function cookies(): {
    get(name: string): { name: string; value: string } | undefined;
    getAll(): { name: string; value: string }[];
    has(name: string): boolean;
    set(name: string, value: string, options?: any): void;
    delete(name: string): void;
  };
}

declare module "next/server" {
  export class NextRequest extends Request {
    readonly nextUrl: URL;
    readonly cookies: any;
    readonly ip?: string;
    readonly geo?: any;
  }
  export class NextResponse extends Response {
    static next(init?: ResponseInit): NextResponse;
    static redirect(url: string | URL, status?: number): NextResponse;
    static rewrite(url: string | URL, init?: ResponseInit): NextResponse;
    static json(data: unknown, init?: ResponseInit): NextResponse;
  }
  export function connection(): Promise<void>;
  export function after(task: Promise<unknown> | (() => unknown)): void;
}

declare module "next/cache" {
  export function revalidatePath(path: string, type?: "page" | "layout"): void;
  export function revalidateTag(tag: string): void;
  export function unstable_cache<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    keyParts?: string[],
    options?: { revalidate?: number | false; tags?: string[] },
  ): T;
}

declare module "next/image" {
  import type { ComponentType, ImgHTMLAttributes } from "react";
  export interface ImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
    src: string | { src: string; width?: number; height?: number };
    width?: number;
    height?: number;
    alt: string;
    priority?: boolean;
  }
  const Image: ComponentType<ImageProps>;
  export default Image;
}
