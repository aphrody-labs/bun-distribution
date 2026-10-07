// SPDX-License-Identifier: Apache-2.0
import { run } from "./engine";

declare const self: Worker;

self.addEventListener(
  "message",
  (event: MessageEvent<string[]>) => {
    // This synchronous ABI call owns the server until it returns. Its arguments
    // and C string remain alive throughout the call; the qualified SDK pins the
    // library for every native runtime thread. Never capture a daemon's output.
    const code = run(event.data);
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    self.postMessage({ code });
  },
  { once: true },
);
