// SPDX-License-Identifier: Apache-2.0
// Ambient declarations for react-server-dom-parcel (no published types). The next/* aliases are typed in client.d.ts.

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
