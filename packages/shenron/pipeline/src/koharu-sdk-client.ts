// SPDX-License-Identifier: Apache-2.0
/** Compatibility surface over the canonical Koharu native SDK transport. */
import {
  startNativeClient,
  type NativeClient,
  type NativeMethod,
  type NativeParams,
} from "@aphrody/koharu-sdk/native";
export { formatSdkError } from "@aphrody/koharu-sdk/native";

export class KoharuSdkClient {
  private readonly client: NativeClient;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(projectRoot: string, binary = "koharu-sdk") {
    this.client = startNativeClient({ root: projectRoot, binary });
  }

  /** Keep Shenron's ordered script calls while sharing the SDK's framing and lifecycle. */
  call(method: string, params: unknown = {}): Promise<unknown> {
    const next = this.pending.then(() =>
      this.client.call(method as NativeMethod, params as NativeParams<NativeMethod>),
    );
    this.pending = next.catch(() => undefined);
    return next.catch((error: unknown) => {
      throw new Error(
        "Koharu SDK " + method + ": " + (error instanceof Error ? error.message : String(error)),
      );
    });
  }

  async close(): Promise<number> {
    await this.pending;
    await this.client.close();
    return this.client.exited;
  }
}
