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

/**
 * `next/*` specifiers of App Router code: the m3 plugin aliases them to `@aphrody/m3/app/*`, so their types are
 * the types of those modules.
 */
declare module "next/link" {
  export { default } from "@aphrody/m3/app/link";
  export * from "@aphrody/m3/app/link";
}
declare module "next/navigation" {
  export * from "@aphrody/m3/app/navigation";
}
declare module "next/headers" {
  export * from "@aphrody/m3/app/headers";
}
declare module "next/server" {
  export * from "@aphrody/m3/app/server";
}
declare module "next/cache" {
  export * from "@aphrody/m3/app/cache";
}
declare module "next/image" {
  export { default } from "@aphrody/m3/app/image";
  export * from "@aphrody/m3/app/image";
}

/**
 * react-server-dom-parcel publishes no types. The App Router runtime (`@aphrody/m3/app`) is type-checked from its
 * sources inside the application's program, so these declarations ship with the application types.
 */
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
