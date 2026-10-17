// SPDX-License-Identifier: Apache-2.0
// SSR -> hydration parity: server markup must hydrate without recoverable errors or DOM changes.

import { describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";

import { Badge } from "../src/Badge";
import { Button } from "../src/Button";
import { Card, CardContent, CardHeader, CardTitle } from "../src/Card";
import { Divider } from "../src/Divider";
import { ProgressBar } from "../src/ProgressBar";
import { Switch } from "../src/Switch";

async function hydrate(
  element: ReactElement,
  serverElement: ReactElement = element,
): Promise<{ errors: unknown[]; before: string; after: string }> {
  const container = document.createElement("div");
  document.body.append(container);
  container.innerHTML = renderToString(serverElement);
  const before = container.innerHTML;
  const errors: unknown[] = [];
  const root = hydrateRoot(container, element, {
    onRecoverableError: error => errors.push(error),
  });
  await new Promise(resolve => setTimeout(resolve, 50));
  const after = container.innerHTML;
  root.unmount();
  container.remove();
  return { errors, before, after };
}

describe("SSR hydration parity (m3-primitives)", () => {
  test("action and display primitives hydrate cleanly", async () => {
    const { errors, before, after } = await hydrate(
      <div>
        <Button>Save</Button>
        <Badge>New</Badge>
        <Divider />
        <ProgressBar value={40} />
        <Card>
          <CardHeader>
            <CardTitle>Title</CardTitle>
          </CardHeader>
          <CardContent>Body</CardContent>
        </Card>
      </div>,
    );
    expect(errors).toEqual([]);
    expect(after).toBe(before);
  });

  test("form control hydrates cleanly", async () => {
    const { errors, before, after } = await hydrate(<Switch aria-label="Notifications" />);
    expect(errors).toEqual([]);
    expect(after).toBe(before);
  });

  test("control: a server/client mismatch is reported", async () => {
    const { errors } = await hydrate(<Badge>Client</Badge>, <Badge>Server</Badge>);
    expect(errors.length).toBeGreaterThan(0);
  });
});
