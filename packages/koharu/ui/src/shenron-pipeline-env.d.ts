// SPDX-License-Identifier: Apache-2.0
// @shenron/pipeline/koharu references Bun.CryptoHasher in one branch that the
// webview never reaches (ShenronExportPanel hashes the cleanup layer itself).
// koharu-ui does not load bun types, so declare only what that module names.


declare global {
  var Bun: {
    [member: string]: any;
    CryptoHasher: new (algorithm: string) => {
      update(data: Uint8Array): { digest(encoding: "hex"): string };
    };
  };
}
