// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import {
  sourceConsumerCommand,
  consumeSourcePublication,
  validateSourceConsumer,
  type SourceConsumerConfiguration,
  type SourceConsumerRequest,
} from "./shenron-source-cdn-consumer";
test("transport hands off only a bounded JSON request to the exact pinned DBFR capability", () => {
  const transport = {
    host: "dbfr" as const,
    consumerModulePath: "/etc/owner/consumer.mjs",
    consumerModuleSha256: "a".repeat(64),
    configurationPath: "/etc/owner/config.json",
    configurationSha256: "b".repeat(64),
  };
  const call = sourceConsumerCommand(transport, request);
  expect(JSON.parse(call.input)).toEqual(request);
  expect(call.command).toContain("sudo -n timeout 900");
  expect(call.command).toContain("--stdin");
  expect(call.timeoutMs).toBe(930000);
  expect(() =>
    sourceConsumerCommand({ ...transport, consumerModulePath: "/etc/owner/x;touch" }, request),
  ).toThrow("Safe");
  expect(() => sourceConsumerCommand({ ...transport, host: "foreign" } as never, request)).toThrow(
    "DBFR",
  );
});
const sha = "a".repeat(64);
const config: SourceConsumerConfiguration = {
  productModulePath: "/owner/product.mjs",
  productModuleSha256: sha,
  publisherModulePath: "/etc/owner/cloudflare/cli/publish-catalog.ts",
  configurationPath: "/owner/config.json",
  configurationSha256: sha,
  inventoryRoot: "/private",
};
const request: SourceConsumerRequest = {
  publicRoot: "/private/snapshot/public",
  target: "https://dragonballfr.com/publications/notice",
  job: "/private/source-cdn-consumer-jobs/job1",
  indexSha256: sha,
  apply: true,
};
test("qualified actual loader no-change result is retained without pretending a publisher write", async () => {
  const calls: string[] = [];
  const proof = await consumeSourcePublication(config, request, {
    async qualify() {
      calls.push("qualify");
    },
    async execute() {
      calls.push("actual-loader");
      return { complete: true, indexSha256: sha, inventorySha256: sha, noChange: true, writes: 0 };
    },
    async receipt() {
      calls.push("receipt");
    },
  });
  expect(calls).toEqual(["qualify", "actual-loader", "receipt"]);
  expect(proof.publisherWrites).toBe(0);
  expect(proof.noChange).toBe(true);
});
test("changed pins, protected scope escapes and foreign targets cannot invoke a product loader", async () => {
  expect(() => validateSourceConsumer({ ...config, productModuleSha256: "bad" }, request)).toThrow(
    "SHA256",
  );
  expect(() =>
    validateSourceConsumer(config, { ...request, publicRoot: "/protected/provider" }),
  ).toThrow("scopes");
  expect(() =>
    validateSourceConsumer(config, { ...request, job: "/private/cdn-publication-state" }),
  ).toThrow("scopes");
  expect(() =>
    validateSourceConsumer(config, {
      ...request,
      target: "https://foreign.example/publications/notice",
    }),
  ).toThrow("target");
});
test("unqualified product publication never yields a consumer receipt", async () => {
  let receipt = false;
  await expect(
    consumeSourcePublication(config, request, {
      async qualify() {},
      async execute() {
        return { complete: true, indexSha256: "b".repeat(64), inventorySha256: sha };
      },
      async receipt() {
        receipt = true;
      },
    }),
  ).rejects.toThrow("differs");
  expect(receipt).toBe(false);
});
test("readonly plan stays explicitly unapplied and does not manufacture a publication proof", async () => {
  const proof = await consumeSourcePublication(
    config,
    { ...request, apply: false },
    {
      async qualify() {},
      async execute() {
        return { planSha256: sha };
      },
      async receipt() {},
    },
  );
  expect(proof.applied).toBe(false);
  expect(proof.publisherWrites).toBeNull();
  expect(proof.noChange).toBe(false);
});
