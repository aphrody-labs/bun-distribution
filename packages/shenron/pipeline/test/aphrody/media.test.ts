// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AphrodyMediaService } from "../../src/aphrody/media";

const directory = mkdtempSync(join(tmpdir(), "aphrody-media-consumer-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

function fixture(name: string, code: string): string {
  const path = join(directory, name);
  writeFileSync(path, `#!${process.execPath}\n${code}\n`);
  chmodSync(path, 0o755);
  return path;
}

describe.skipIf(process.platform === "win32")("Aphrody media consumer contract", () => {
  it("maps the Rust resolver response into Shenron source and stream shapes", async () => {
    const bin = fixture(
      "media-success",
      `
const args=process.argv.slice(2);
if(args[0]!=="web"||args[1]!=="media"||args[2]!=="resolve"||args[3]!=="https://embed.example/watch?id=7"||args.includes("--json")||!args.includes("--variants")||args[args.indexOf("--referer")+1]!=="https://site.example/episode") process.exit(2);
console.log(JSON.stringify({host:"vidmoly.net",embedUrl:args[3],kind:"hls",url:"https://cdn.example/master.m3u8",candidates:[{url:"https://cdn.example/master.m3u8",kind:"hls",rule:"source",confidence:0.9,offset:3,layer:0}],variants:[{url:"https://cdn.example/1080.m3u8",bandwidth:2400000,averageBandwidth:null,width:1920,height:1080,codecs:"avc1",frameRate:null,name:null,label:"1080p"}],headers:{Referer:"https://embed.example/",Origin:"https://embed.example"},poster:null,expiresAt:null}));`,
    );
    const service = new AphrodyMediaService({ bin });
    const embed = "https://embed.example/watch?id=7";
    const options = { referer: "https://site.example/episode" };
    expect(await service.resolveSource(embed, options)).toEqual({
      host: "vidmoly.net",
      originalUrl: embed,
      hlsUrl: "https://cdn.example/master.m3u8",
      qualities: { "1080p": "https://cdn.example/1080.m3u8" },
      headers: { Referer: "https://embed.example/", Origin: "https://embed.example" },
    });
    expect(await service.resolveStream(embed, options)).toMatchObject({
      url: "https://cdn.example/master.m3u8",
      headers: { Referer: "https://embed.example/", Origin: "https://embed.example" },
      type: "application/x-mpegURL",
      provider: "vidmoly.net",
    });
  });

  it("rejects failed owner resolutions and malformed payloads", async () => {
    const failed = fixture(
      "media-failure",
      'console.error("unsupported proprietary player");process.exit(1);',
    );
    await expect(
      new AphrodyMediaService({ bin: failed }).resolveStream("https://embed.example/"),
    ).rejects.toThrow("unsupported proprietary player");
    const malformed = fixture(
      "media-malformed",
      'console.log(JSON.stringify({host:"x",url:"https://cdn.example/a.m3u8"}));',
    );
    await expect(
      new AphrodyMediaService({ bin: malformed }).resolve("https://embed.example/"),
    ).rejects.toThrow();
    await expect(
      new AphrodyMediaService({ bin: "/missing/aphrody" }).resolve("file:///etc/passwd"),
    ).rejects.toThrow("HTTP(S)");
  });
});
