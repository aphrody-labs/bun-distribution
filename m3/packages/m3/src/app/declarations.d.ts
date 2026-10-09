// SPDX-License-Identifier: Apache-2.0
// Ambient declarations for react-server-dom-parcel and next/* compatibility aliases.

declare module "react-server-dom-parcel/client.browser" {
  export function createFromFetch<T>(promiseForResponse: Promise<Response>, options?: any): Promise<T>;
  export function createFromReadableStream<T>(stream: ReadableStream<Uint8Array>, options?: any): Promise<T>;
  export function encodeReply(value: any, options?: any): Promise<string | FormData>;
  export function createTemporaryReferenceSet(): any;
  export function setServerCallback(callback: (id: string, args: any[]) => Promise<any>): void;
}

declare module "react-server-dom-parcel/server.node" {
  export function renderToReadableStream(model: any, options?: any): ReadableStream<Uint8Array>;
  export function decodeReply<T>(body: string | FormData, options?: any): Promise<T>;
  export function decodeAction(body: FormData, options?: any): Promise<(() => Promise<any>) | null>;
  export function decodeFormState<T>(actionResult: any, body: FormData, options?: any): Promise<T>;
  export function registerServerActions(actions: Record<string, string[]>): void;
  export function loadServerAction(id: string): Promise<(...args: any[]) => any>;
  export function createTemporaryReferenceSet(): any;
}

declare module "react-server-dom-parcel/client.edge" {
  export function createFromReadableStream<T>(stream: ReadableStream<Uint8Array>, options?: any): Promise<T>;
}

declare module "next/navigation" {
  export function redirect(url: string, type?: "replace" | "push"): never;
  export function permanentRedirect(url: string, type?: "replace" | "push"): never;
  export function notFound(): never;
  export function useRouter(): any;
  export function usePathname(): string;
  export function useSearchParams(): URLSearchParams;
  export function useParams(): Record<string, string | string[]>;
}

declare module "next/headers" {
  export function headers(): Headers;
  export function cookies(): any;
}

declare module "next/link" {
  import type { ComponentType } from "react";
  const Link: ComponentType<any>;
  export default Link;
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
}
