// SPDX-License-Identifier: Apache-2.0
// Crawlability of the server-rendered markup: stable data-m3-component hooks, real links and
// accessible names, with no client JavaScript (renderToStaticMarkup runs no effects).

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  Badge,
  Banner,
  Button,
  Card,
  CardTitle,
  CircleButton,
  CircularProgress,
  Divider,
  Input,
  Label,
  Meter,
  ProgressBar,
  SearchBar,
  Switch,
  TabsContent,
  TabsList,
  TabsRoot,
  TabsTrigger,
} from "../src/index";

const hook = (name: string) => `data-m3-component="${name}"`;

describe("crawlable SSR markup (m3-primitives)", () => {
  test("Button renders a real link when it has an href, a typed button otherwise", () => {
    const link = renderToStaticMarkup(<Button href="/docs">Docs</Button>);
    expect(link).toMatch(/^<a /);
    expect(link).toContain('href="/docs"');
    expect(link).toContain(hook("Button"));
    const button = renderToStaticMarkup(<Button>Save</Button>);
    expect(button).toMatch(/^<button type="button"/);
    expect(button).toContain(hook("Button"));
  });

  test("hooks are plain data attributes that consumers can override", () => {
    expect(renderToStaticMarkup(<Badge>New</Badge>)).toContain(hook("Badge"));
    expect(
      renderToStaticMarkup(<Badge data-m3-component="Mine">New</Badge>),
    ).toContain(hook("Mine"));
    expect(
      renderToStaticMarkup(<Badge data-m3-component="Mine">New</Badge>),
    ).not.toContain(hook("Badge"));
    expect(
      renderToStaticMarkup(
        <Card>
          <CardTitle>T</CardTitle>
        </Card>,
      ),
    ).toMatch(/data-m3-component="Card"[^>]*>.*data-m3-component="CardTitle"/);
    expect(renderToStaticMarkup(<Divider />)).toContain(hook("Divider"));
    expect(
      renderToStaticMarkup(<Banner variant="info">Saved</Banner>),
    ).toContain(hook("Banner"));
  });

  test("controls keep the names their API can supply", () => {
    const icon = renderToStaticMarkup(
      <CircleButton icon="more_horiz" aria-label="More actions" />,
    );
    expect(icon).toContain('aria-label="More actions"');
    expect(icon).toContain('aria-hidden="true"'); // the glyph ligature text is hidden from readers
    expect(
      renderToStaticMarkup(<Switch aria-label="Notifications" />),
    ).toContain(hook("Switch"));
    expect(renderToStaticMarkup(<SearchBar aria-label="Search" />)).toContain(
      hook("SearchBar"),
    );
    const field = renderToStaticMarkup(
      <div>
        <Label slug="email">Email</Label>
        <Input id="email" />
      </div>,
    );
    expect(field).toContain('<label data-m3-component="Label" for="email"');
    expect(field).toContain('id="email"');
  });

  test("progress indicators always carry an accessible name", () => {
    expect(renderToStaticMarkup(<ProgressBar value={1} total={2} />)).toMatch(
      /role="progressbar"[^>]*aria-label="Progress"/,
    );
    expect(renderToStaticMarkup(<ProgressBar pending />)).toContain(
      'aria-label="Loading"',
    );
    const circular = renderToStaticMarkup(
      <CircularProgress radius={20} progress={50} />,
    );
    expect(circular).toContain('aria-label="Progress"');
    expect(circular).toContain('<svg aria-hidden="true"');
    expect(
      renderToStaticMarkup(<Meter label="Storage used" value={62} />),
    ).toContain('aria-label="Storage used"');
  });

  test("tabs expose the tablist, tab and tabpanel roles in the first HTML", () => {
    const html = renderToStaticMarkup(
      <TabsRoot defaultValue="a">
        <TabsList aria-label="Sections">
          <TabsTrigger value="a">Alpha</TabsTrigger>
          <TabsTrigger value="b">Beta</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Alpha content</TabsContent>
      </TabsRoot>,
    );
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Sections"');
    expect(html.match(/role="tab"/g)).toHaveLength(2);
    expect(html).toContain("Alpha content");
    expect(html).toContain(hook("Tabs"));
    expect(html).toContain(hook("TabsTrigger"));
  });
});
