#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
import { resolve } from "node:path";
import { assetClient, publishContentObject } from "@aphrody/bun-workspace/assets";
import { loadConfig } from "@aphrody/bun-workspace";
import { authorizedGame, verifyAuthorizedInputs } from "./authorized-publication";

export async function publishAuthorizedContent(privateReport: string) {
  if (process.platform !== "linux") throw new Error("Authorized content publication runs on the VPS only.");
  const root = resolve(import.meta.dir, "../../..");
  // Perform all qualification gates before constructing a credentialed client.
  const verified = await verifyAuthorizedInputs(root, privateReport);
  const config = await loadConfig(root);
  if (!config.deployment) throw new Error("Root deployment settings are missing.");
  const assetConfig = { ...config, deployment: { ...config.deployment, assets: { bucket: "aphrody-assets", url: "https://assets.aphrody.app" } } };
  const reference = await publishContentObject(assetClient(assetConfig), { bucket: "aphrody-assets", origin: "https://assets.aphrody.app", prefix: "objects/sha256/" }, verified.paths.artifact, authorizedGame.member!);
  // Revalidate source and report after upload, before permitting product staging.
  const current = await verifyAuthorizedInputs(root, privateReport);
  if (["preparationSHA256", "qualificationSHA256", "privateReportSHA256"].some(key => current[key as keyof typeof current] !== verified[key as keyof typeof verified])) throw new Error("Qualification inputs changed during publication.");
  const receipt = { schemaVersion: 1, kind: "bun-engine-authorized-content-publication", id: authorizedGame.id, publishedAt: new Date().toISOString(), bucket: "aphrody-assets", reference, preparationSHA256: verified.preparationSHA256, qualificationSHA256: verified.qualificationSHA256, privateReport: verified.reportRelative, privateReportSHA256: verified.privateReportSHA256 };
  await Bun.write(verified.paths.publication, JSON.stringify(receipt, null, 2) + "\n");
  return { receipt: verified.paths.publication, reference };
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  if (args.length !== 1 || !args[0]!.startsWith("--private-report=") || !args[0]!.slice(17)) throw new Error("Usage: publish-authorized-content.ts --private-report=build/web-emulation/private/<run>/smoke.json");
  console.log(JSON.stringify(await publishAuthorizedContent(args[0]!.slice(17)), null, 2));
}
