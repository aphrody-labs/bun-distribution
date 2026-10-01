// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aphrodyWebMirror } from "../../src/aphrody/mirror";

const directory = mkdtempSync(join(tmpdir(), "aphrody-mirror-consumer-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

function fixture(name: string, source: string) {
  const bin = join(directory, name);
  writeFileSync(bin, `#!${process.execPath}\n${source}\n`);
  chmodSync(bin, 0o755);
  return bin;
}

const partialReport = {
  requests: 4,
  pagesWritten: 2,
  assetsWritten: 1,
  bytesWritten: 512,
  files: ["index.html", "assets/image.png"],
  failures: [{ url: "https://cdn.example/missing.png", error: "404" }],
};

describe("Aphrody Web mirror CLI client", () => {
  it("passes bounded mirror settings and accepts partial reports", async () => {
    const bin = fixture(
      "mirror-partial",
      `const args=process.argv.slice(2);
if(args[0]!=="web"||args[1]!=="mirror"||args[2]!=="https://wiki.example/"||args[3]!=="/tmp/mirror"||args[args.indexOf("--max-pages")+1]!=="7"||args[args.indexOf("--resolve-cdns")+1]!=="true") process.exit(2);
console.log(${JSON.stringify(JSON.stringify(partialReport))});`,
    );
    const report = await aphrodyWebMirror(
      {
        url: "https://wiki.example/",
        outputDir: "/tmp/mirror",
        maxPages: 7,
        resolveCdns: true,
      },
      { bin },
    );
    expect(report).toEqual(partialReport);
  });

  it("passes explicit CDN hosts as one argument", async () => {
    const bin = fixture(
      "mirror-hosts",
      `const args=process.argv.slice(2); const index=args.indexOf("--resolve-cdns");
if(index<0||args[index+1]!=="static.example,cdn.example") process.exit(3);
console.log(${JSON.stringify(JSON.stringify({ ...partialReport, failures: [] }))});`,
    );
    await expect(
      aphrodyWebMirror(
        {
          url: "https://wiki.example/",
          outputDir: "/tmp/mirror",
          resolveCdns: ["static.example", "cdn.example"],
        },
        { bin },
      ),
    ).resolves.toMatchObject({ failures: [] });
  });

  it("propagates CLI failures and rejects malformed reports", async () => {
    const failed = fixture("mirror-failed", 'console.error("transport failed");process.exit(6);');
    await expect(
      aphrodyWebMirror({ url: "https://wiki.example/", outputDir: "/tmp/mirror" }, { bin: failed }),
    ).rejects.toThrow("exited 6");

    const invalid = fixture(
      "mirror-invalid",
      `console.log(${JSON.stringify(JSON.stringify({ ...partialReport, requests: -1 }))});`,
    );
    await expect(
      aphrodyWebMirror(
        { url: "https://wiki.example/", outputDir: "/tmp/mirror" },
        { bin: invalid },
      ),
    ).rejects.toThrow("invalid report");

    const invalidFailure = fixture(
      "mirror-invalid-failure",
      `console.log(${JSON.stringify(JSON.stringify({ ...partialReport, failures: [null] }))});`,
    );
    await expect(
      aphrodyWebMirror(
        { url: "https://wiki.example/", outputDir: "/tmp/mirror" },
        { bin: invalidFailure },
      ),
    ).rejects.toThrow("invalid report");
  });
});
