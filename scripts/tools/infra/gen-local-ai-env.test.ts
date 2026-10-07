// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { examplePath, loadContract, render } from "./gen-local-ai-env.ts";

const contract = await loadContract();
const rendered = render(contract);

describe("local-ai env example", () => {
  test("the committed example matches tools/config/local-ai.json", async () => {
    const committed = (await Bun.file(examplePath).text()).replaceAll("\r\n", "\n");
    expect(committed).toBe(rendered);
  });

  test("every canonical name appears exactly once and without a value", () => {
    const canonical = [
      ...Object.values(contract.binaries ?? {}).flatMap((binary) => binary.env),
      ...Object.values(contract.gateways ?? {}).flatMap((gateway) => gateway.env ?? []),
      ...Object.values(contract.capabilities).flatMap((capability) => capability.env ?? []),
    ].map((env) => env.canonical);
    const assignments = rendered.split("\n").filter((line) => line !== "" && !line.startsWith("#"));
    expect(assignments).toEqual(canonical.map((name) => `${name}=`));
    expect(new Set(canonical).size).toBe(canonical.length);
  });

  test("the vps embed binding pins the Shenron index space", () => {
    const vpsTarget = contract.targets.vps;
    if (!vpsTarget) throw new Error("tools/config/local-ai.json declares no vps target");
    const vps = vpsTarget.bindings?.embed?.env ?? {};
    const index = contract.indexes?.["shenron-rag"];
    expect(vps.APHRODY_AI_EMBED_MODEL).toBe(index?.servedModel);
    expect(vps.APHRODY_AI_EMBED_DIMENSIONS).toBe(String(index?.dimensions));
    const block = rendered.slice(
      rendered.indexOf("# APHRODY_AI_EMBED_MODEL:"),
      rendered.indexOf("APHRODY_AI_EMBED_MODEL="),
    );
    expect(block).toContain("# vps: Xenova/multilingual-e5-small\n");
  });
});
