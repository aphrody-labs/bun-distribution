// SPDX-License-Identifier: Apache-2.0
/** The only PowerShell the kit sends to Windows is inline: parse every snippet with the real PowerShell parser (skipped without pwsh). */
import { expect, test } from "bun:test";

import { stepKit } from "../../src/admin/lib/steps.ts";
import { elevatedCommand } from "../../src/admin/lib/tunnel.ts";
import { testContext } from "./helpers.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const pwsh = Bun.which("pwsh");

function parseErrors(script: string): string {
  const proc = Bun.spawnSync(
    [
      pwsh!,
      "-NoProfile",
      "-Command",
      "$e=$null;$t=$null;[void][System.Management.Automation.Language.Parser]::ParseInput($env:SNIPPET,[ref]$t,[ref]$e);($e|ForEach-Object Message) -join '|'",
    ],
    { windowsHide: true, env: { ...process.env, SNIPPET: script } },
  );
  return proc.stdout.toString().trim();
}

test.skipIf(!pwsh)(
  "the elevation and shortcut snippets are valid PowerShell, even with quotes and spaces in paths",
  async () => {
    const snippets = [
      elevatedCommand([
        "C:\\Users\\Omar O'Neil\\Aphrody-Omar.exe",
        "interne",
        "wg-installer",
        "C:\\ProgramData\\x y\\aphrody.conf",
        "aphrody",
      ])[5]!,
    ];
    const t = testContext();
    mkdirSync(dirname(t.ctx.exePath), { recursive: true });
    writeFileSync(t.ctx.exePath, "x");
    t.sys.handlers.push({ match: /^powershell /, result: {} });
    await stepKit.run(t.ctx, "executer", { repoReady: false });
    for (const call of t.sys.calls) snippets.push(call.argv[3]!);
    expect(snippets.length).toBe(3);
    for (const snippet of snippets)
      expect(parseErrors(snippet), snippet).toBe("");
    expect(parseErrors("Start-Process -FilePath 'x' -ArgumentList (")).not.toBe(
      "",
    );
    expect(join("a", "b")).toBeDefined();
  },
);
