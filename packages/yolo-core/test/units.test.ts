// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { renderAll, renderService, renderTimer, unitCatalog, unitFiles } from "../src/units/index.ts";

test("every catalog entry renders a service, timers pair with their service", () => {
  const files = unitFiles();
  for (const e of unitCatalog.units) {
    expect(files).toContain(`${e.name}.service`);
    expect(files.includes(`${e.name}.timer`)).toBe(!!e.timer);
  }
  expect(new Set(renderAll().map(u => u.file)).size).toBe(renderAll().length);
});

test("service rendering: derived Type, default Install, oneshot has none", () => {
  const daemon = renderService({
    name: "x",
    unit: { Description: "d" },
    service: { ExecStart: "/bin/x" },
  }).text;
  expect(daemon).toContain("[Service]\nType=simple\nExecStart=/bin/x");
  expect(daemon).toContain("[Install]\nWantedBy=default.target");
  const once = renderService({
    name: "y",
    kind: "oneshot",
    unit: { Description: "d" },
    service: { ExecStart: ["/a", "/b"] },
  }).text;
  expect(once).toContain("Type=oneshot\nExecStart=/a\nExecStart=/b");
  expect(once).not.toContain("[Install]");
});

test("timer rendering targets its service and is persistent", () => {
  const t = renderTimer({
    name: "z",
    unit: { Description: "d" },
    service: {},
    timer: { description: "daily", OnCalendar: "daily" },
  })!;
  expect(t.file).toBe("z.timer");
  expect(t.text).toContain("OnCalendar=daily\nPersistent=true\nUnit=z.service");
  expect(t.text).toContain("WantedBy=timers.target");
});
