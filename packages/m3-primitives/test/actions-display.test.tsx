// SPDX-License-Identifier: Apache-2.0
// M3 anatomy of the action and display primitives (SpaceUI API kept, M3 classes emitted).

import { describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Badge } from "../src/Badge";
import { Banner } from "../src/Banner";
import { Button } from "../src/Button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../src/Card";
import { CircleButton } from "../src/CircleButton";
import { CircleButtonGroup } from "../src/CircleButtonGroup";
import { CircularProgress } from "../src/CircularProgress";
import { Divider } from "../src/Divider";
import { FilterButton } from "../src/FilterButton";
import { InfoBanner, InfoBannerSubtext, InfoBannerText } from "../src/InfoBanner";
import { modifierSymbols, keySymbols, ModifierKeys } from "../src/keys";
import { Card as LayoutCard, GridLayout } from "../src/Layout";
import { Loader } from "../src/Loader";
import { OptionList, OptionListItem } from "../src/OptionList";
import { ProgressBar } from "../src/ProgressBar";
import { SelectPill } from "../src/SelectPill";
import { SelectTriggerButton } from "../src/SelectTriggerButton";
import { ShinyButton } from "../src/ShinyButton";
import { ShinyToggle } from "../src/ShinyToggle";
import { Shortcut } from "../src/Shortcut";
import { SpaceItem } from "../src/SpaceItem";
import { TabBar, TabBarItem } from "../src/TabBar";
import { ToggleGroup } from "../src/ToggleGroup";
import { CategoryHeading, ScreenHeading } from "../src/Typography";
import { m3FocusRing, tw } from "../src/utils";

const SPACEUI_VOCABULARY = /\b(bg|text|border)-(app|ink|sidebar|menu|accent)\b/;

const Glyph = (p: { className?: string }) => <svg data-glyph className={p.className} />;

/** Render, and check the markup is free of SpaceUI vocabulary and hard-coded white text. */
function render(element: ReactElement): string {
  const html = renderToStaticMarkup(element);
  expect(html).not.toMatch(SPACEUI_VOCABULARY);
  expect(html).not.toContain("text-white");
  expect(html).not.toMatch(/brightness-|bg-opacity-/);
  return html;
}

/** The class list of the first element carrying `class`. */
function classesOf(html: string, index = 0): string[] {
  const all = [...html.matchAll(/class="([^"]*)"/g)].map(m => m[1]);
  return (all[index] ?? "").split(/\s+/);
}

const noop = () => {};

describe("Button", () => {
  test("filled is primary / on-primary, full shape, label-large", () => {
    const c = classesOf(render(<Button variant="filled">Go</Button>));
    expect(c).toContain("bg-primary");
    expect(c).toContain("text-on-primary");
    expect(c).toContain("rounded-full");
    expect(c).toContain("text-label-large");
  });

  test("M3 variants", () => {
    expect(classesOf(render(<Button variant="tonal">x</Button>))).toContain("bg-secondary-container");
    expect(classesOf(render(<Button variant="outlined">x</Button>))).toContain("border-outline-variant");
    expect(classesOf(render(<Button variant="text">x</Button>))).toContain("text-primary");
    const elevated = classesOf(render(<Button variant="elevated">x</Button>));
    expect(elevated).toContain("bg-surface-container-low");
    expect(elevated).toContain("shadow-md3-1");
  });

  test("SpaceUI variants map onto the M3 looks", () => {
    expect(classesOf(render(<Button variant="accent">x</Button>))).toContain("bg-primary");
    expect(classesOf(render(<Button>x</Button>))).toContain("bg-secondary-container");
    expect(classesOf(render(<Button variant="gray">x</Button>))).toContain("text-on-secondary-container");
    expect(classesOf(render(<Button variant="outline">x</Button>))).toContain("border-outline-variant");
    expect(classesOf(render(<Button variant="subtle">x</Button>))).toContain("text-primary");
    expect(classesOf(render(<Button variant="dotted">x</Button>))).toContain("border-dashed");
    const colored = classesOf(
      render(
        <Button variant="colored" className="bg-tertiary">
          x
        </Button>,
      ),
    );
    expect(colored).toContain("bg-tertiary");
    expect(colored).toContain("text-on-primary");
    const bare = classesOf(render(<Button variant="bare">x</Button>));
    expect(bare).not.toContain("bg-primary");
    expect(bare).not.toContain("bg-secondary-container");
  });

  test("M3 heights, disabled roles, focus ring, state layer", () => {
    const c = classesOf(
      render(
        <Button variant="filled" size="lg">
          x
        </Button>,
      ),
    );
    expect(c).toContain("h-10");
    expect(c).toContain("disabled:bg-on-surface/12");
    expect(c).toContain("disabled:text-on-surface/38");
    expect(c).toContain("focus-visible:outline-secondary");
    expect(c).toContain("hover:before:opacity-8");
  });

  test("rounding, loading and links keep working", () => {
    expect(classesOf(render(<Button rounding="left">x</Button>))).toContain("rounded-l-full");
    expect(classesOf(render(<Button rounding="none">x</Button>))).toContain("rounded-none");
    expect(render(<Button loading>x</Button>)).toContain("disabled");
    const link = render(
      <Button href="/docs" variant="accent">
        Docs
      </Button>,
    );
    expect(link).toStartWith("<a");
    expect(link).toContain('href="/docs"');
    expect(link).not.toContain('variant="');
  });
});

describe("CircleButton", () => {
  test("M3 icon button: 40 dp, full shape, Material Symbol", () => {
    const html = render(<CircleButton icon="search" aria-label="Search" />);
    const c = classesOf(html);
    expect(c).toContain("h-10");
    expect(c).toContain("rounded-full");
    expect(html).toContain(">search</span>");
  });

  test("legacy active / activeAccent props and variants", () => {
    expect(classesOf(render(<CircleButton icon="add" active />))).toContain("bg-secondary-container");
    const accent = classesOf(render(<CircleButton icon="add" active activeAccent />));
    expect(accent).toContain("bg-primary");
    expect(accent).toContain("text-on-primary");
    expect(classesOf(render(<CircleButton variant="standard" icon="add" />))).toContain("bg-transparent");
    expect(classesOf(render(<CircleButton variant="solid" icon="add" />))).toContain("border-outline-variant");
  });

  test("icon components and labels still render", () => {
    const html = render(<CircleButton icon={Glyph}>Label</CircleButton>);
    expect(html).toContain("data-glyph");
    expect(html).toContain("text-label-large");
  });

  test("group joins buttons on surface-container-high", () => {
    const html = render(
      <CircleButtonGroup>
        <CircleButton icon="chevron_left" />
        <CircleButton icon="chevron_right" />
      </CircleButtonGroup>,
    );
    expect(classesOf(html)).toContain("bg-surface-container-high");
    expect(html).toContain("bg-outline-variant");
    expect(html).toContain("!rounded-none");
  });
});

describe("Shiny components", () => {
  test("ShinyButton: primary→tertiary gradient, on-primary, default icon", () => {
    const html = render(<ShinyButton>Download</ShinyButton>);
    const c = classesOf(html);
    expect(c).toContain("from-primary");
    expect(c).toContain("to-tertiary");
    expect(c).toContain("text-on-primary");
    expect(c).toContain("rounded-full");
    expect(html).toContain("arrow_circle_down");
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });

  test("ShinyButton: link, size, glow, custom icon", () => {
    const html = render(
      <ShinyButton href="/get" size="small" glow="none" icon="bolt">
        Get
      </ShinyButton>,
    );
    expect(html).toStartWith("<a");
    expect(html).toContain("bolt");
    expect(html).toContain("text-label-large");
  });

  test("ShinyToggle: selected option on the gradient, others on-surface-variant", () => {
    const html = render(
      <ShinyToggle
        value="a"
        onChange={noop}
        options={[
          { value: "a", label: "All", count: 3 },
          { value: "b", label: "Mine" },
        ]}
      />,
    );
    expect(html).toContain("from-primary");
    expect(html).toContain("text-on-primary");
    expect(html).toContain("text-on-surface-variant");
    expect(html).toContain("All (3)");
    expect(html).toContain('aria-checked="true"');
  });
});

describe("chips and pickers", () => {
  test("FilterButton: M3 filter chip", () => {
    const off = render(<FilterButton label="Images" />);
    expect(classesOf(off)).toContain("rounded-small");
    expect(classesOf(off)).toContain("h-8");
    expect(classesOf(off)).toContain("border-outline-variant");
    const on = render(<FilterButton active>Images</FilterButton>);
    expect(classesOf(on)).toContain("bg-secondary-container");
    expect(on).toContain(">check</span>");
  });

  test("SelectPill: variants, sizes, caret, selected", () => {
    const html = render(
      <SelectPill size="lg" variant="ghost">
        Model
      </SelectPill>,
    );
    expect(classesOf(html)).toContain("h-10");
    expect(classesOf(html)).toContain("rounded-full");
    expect(html).toContain("expand_more");
    expect(render(<SelectPill hideCaret>x</SelectPill>)).not.toContain("expand_more");
    expect(render(<SelectPill variant="sidebar">x</SelectPill>)).toContain("bg-surface-container-low");
    const selected = render(<SelectPill selected>x</SelectPill>);
    expect(selected).toContain("bg-secondary-container");
    expect(selected).toContain(">check</span>");
  });

  test("SelectTriggerButton: outlined, placeholder", () => {
    const html = render(<SelectTriggerButton placeholder="Pick one" />);
    expect(classesOf(html)).toContain("border-outline-variant");
    expect(classesOf(html)).toContain("h-10");
    expect(html).toContain("Pick one");
    expect(html).toContain("expand_more");
  });

  test("ToggleGroup: segmented button with check on the selection", () => {
    const html = render(
      <ToggleGroup
        value="grid"
        onChange={noop}
        options={[
          { value: "grid", label: "Grid", icon: "grid_view" },
          { value: "list", label: "List", icon: "list" },
        ]}
      />,
    );
    expect(classesOf(html)).toContain("rounded-full");
    expect(classesOf(html)).toContain("border-outline");
    expect(html).toContain("data-pressed:bg-secondary-container");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain(">check</span>");
    expect(html).toContain(">list</span>");
    expect(html).not.toContain(">grid_view</span>");
  });

  test("OptionList: selection indicator", () => {
    const html = render(
      <OptionList>
        <OptionListItem selected>One</OptionListItem>
        <OptionListItem size="lg">Two</OptionListItem>
      </OptionList>,
    );
    expect(classesOf(html, 1)).toContain("bg-secondary-container");
    expect(classesOf(html, 1)).toContain("text-on-secondary-container");
    expect(classesOf(html, 2)).toContain("text-on-surface");
    expect(classesOf(html, 2)).toContain("text-body-large");
  });
});

describe("status", () => {
  test("Badge: container roles per status variant", () => {
    expect(classesOf(render(<Badge variant="success">ok</Badge>))).toContain("bg-success-container");
    expect(classesOf(render(<Badge variant="warning">!</Badge>))).toContain("text-on-warning-container");
    expect(classesOf(render(<Badge variant="error">x</Badge>))).toContain("bg-error-container");
    expect(classesOf(render(<Badge variant="destructive">x</Badge>))).toContain("bg-error-container");
    expect(classesOf(render(<Badge variant="accent">x</Badge>))).toContain("bg-primary-container");
    const badge = classesOf(
      render(
        <Badge variant="badge" size="sm">
          3
        </Badge>,
      ),
    );
    expect(badge).toContain("bg-error");
    expect(badge).toContain("text-on-error");
    expect(classesOf(render(<Badge>x</Badge>))).toContain("text-label-small");
  });

  test("Banner: container roles, icon, dot", () => {
    const html = render(<Banner variant="error">Failed</Banner>);
    expect(classesOf(html)).toContain("bg-error-container");
    expect(classesOf(html)).toContain("rounded-medium");
    expect(html).toContain(">cancel</span>");
    expect(html).toContain("bg-error");
    const plain = render(
      <Banner showDot={false} icon="bolt">
        x
      </Banner>,
    );
    expect(plain).toContain("bg-surface-container-high");
    expect(plain).toContain(">bolt</span>");
    expect(plain).not.toContain("size-2");
  });

  test("InfoBanner: filled card on container roles", () => {
    const html = render(
      <InfoBanner variant="danger" icon="warning">
        <InfoBannerText>Title</InfoBannerText>
        <InfoBannerSubtext>More</InfoBannerSubtext>
      </InfoBanner>,
    );
    expect(classesOf(html)).toContain("bg-error-container");
    expect(classesOf(html)).toContain("text-on-error-container");
    expect(html).toContain(">warning</span>");
    expect(render(<InfoBanner icon={<i>i</i>}>x</InfoBanner>)).toContain("bg-primary-container");
  });
});

describe("containment and text", () => {
  test("Card: M3 variants, default elevated", () => {
    const html = render(
      <Card>
        <CardHeader>
          <CardTitle>T</CardTitle>
          <CardDescription>D</CardDescription>
        </CardHeader>
        <CardContent>C</CardContent>
        <CardFooter>F</CardFooter>
      </Card>,
    );
    const c = classesOf(html);
    expect(c).toContain("rounded-medium");
    expect(c).toContain("bg-surface-container-low");
    expect(c).toContain("shadow-md3-1");
    expect(html).toContain("text-title-large");
    expect(classesOf(render(<Card variant="filled" />))).toContain("bg-surface-container-highest");
    const outlined = classesOf(render(<Card variant="outlined" />));
    expect(outlined).toContain("bg-surface");
    expect(outlined).toContain("border-outline-variant");
    expect(classesOf(render(<Card variant="dark" />))).toContain("border-outline-variant");
  });

  test("Layout card and grid", () => {
    expect(classesOf(render(<LayoutCard>x</LayoutCard>))).toContain("border-outline-variant");
    expect(classesOf(render(<GridLayout className="extra" />))).toContain("extra");
  });

  test("Typography maps onto the typescale", () => {
    expect(classesOf(render(<ScreenHeading>S</ScreenHeading>))).toContain("text-headline-small");
    expect(classesOf(render(<CategoryHeading>C</CategoryHeading>))).toContain("text-title-small");
  });

  test("Divider: 1 dp outline-variant", () => {
    const c = classesOf(render(<Divider className="my-2" />));
    expect(c).toContain("bg-outline-variant");
    expect(c).toContain("h-px");
    expect(c).toContain("my-2");
    expect(classesOf(render(<Divider orientation="vertical" />))).toContain("w-px");
  });

  test("Shortcut: key chip", () => {
    const html = render(<Shortcut chars="⌘K" />);
    expect(html).toStartWith("<kbd");
    const c = classesOf(html);
    expect(c).toContain("bg-surface-container-high");
    expect(c).toContain("text-label-small");
    expect(c).toContain("font-code");
  });

  test("keys and tw keep their upstream shape", () => {
    expect(modifierSymbols[ModifierKeys.Meta].macOS).toBe("⌘");
    expect(keySymbols.Tab?.Other).toBe("⭾");
    const Box = tw.div`bg-surface`;
    expect(classesOf(render(<Box className="p-2" />))).toEqual(["bg-surface", "p-2"]);
    expect(m3FocusRing).toContain("focus-visible:outline-3");
  });
});

describe("progress", () => {
  test("Loader: circular indeterminate on primary, color override", () => {
    const html = render(<Loader />);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain("text-primary");
    expect(html).toContain("animateTransform");
    expect(html).toContain("size-7");
    expect(render(<Loader color="red" className="size-4" />)).toContain('stroke="red"');
  });

  test("ProgressBar: 4 dp track, primary indicator, all prop shapes", () => {
    const html = render(<ProgressBar value={1} total={4} />);
    const c = classesOf(html);
    expect(c).toContain("h-1");
    expect(c).toContain("rounded-full");
    expect(c).toContain("bg-secondary-container");
    expect(html).toContain("bg-primary");
    expect(html).toContain("width:25%");
    expect(render(<ProgressBar percent={60} />)).toContain("width:60%");
    const pending = render(<ProgressBar pending percent={0} />);
    expect(pending).toContain("indeterminate-progress-bar");
    expect(pending).toContain("bg-primary");
  });

  test("CircularProgress: primary arc, secondary-container track, 4 dp stroke", () => {
    const html = render(<CircularProgress radius={20} progress={50} />);
    expect(html).toContain("stroke-primary");
    expect(html).toContain("stroke-secondary-container");
    expect(html).toContain('stroke-width="4"');
    expect(html).toContain('aria-valuenow="50"');
    const custom = render(<CircularProgress radius={10} progress={10} strokeColor="red" strokeWidth={2} />);
    expect(custom).toContain('stroke="red"');
    expect(custom).not.toContain("stroke-primary");
  });
});

describe("navigation", () => {
  test("SpaceItem: drawer item with full-shape active indicator", () => {
    const html = render(<SpaceItem label="Library" icon="folder" active right={<span>3</span>} />);
    const c = classesOf(html);
    expect(c).toContain("h-10");
    expect(c).toContain("rounded-full");
    expect(c).toContain("bg-secondary-container");
    expect(c).toContain("text-on-secondary-container");
    expect(html).toContain(">folder</span>");
    expect(html).toContain('aria-current="page"');
    expect(classesOf(render(<SpaceItem label="x" />))).toContain("text-on-surface-variant");
  });

  test("SpaceItem: image URL, color dot, iconElement", () => {
    expect(render(<SpaceItem label="x" icon="/img/a.png" />)).toContain('<img src="/img/a.png"');
    expect(render(<SpaceItem label="x" color="#f00" />)).toContain("background-color:#f00");
    expect(render(<SpaceItem label="x" iconElement={<b>i</b>} />)).toContain("<b>i</b>");
  });

  test("TabBar: primary tabs with a 3 dp primary indicator", () => {
    const html = render(
      <TabBar trailing={<button type="button">+</button>}>
        <TabBarItem label="One" active onClose={noop} />
        <TabBarItem label="Two" />
      </TabBar>,
    );
    expect(html).toContain('role="tablist"');
    expect(html).toContain("text-primary");
    expect(html).toContain("text-on-surface-variant");
    expect(html).toContain("h-[3px]");
    expect(html).toContain("bg-primary");
    expect(html).toContain("text-label-large");
    expect(html).toContain('aria-label="Close tab"');
    expect(html).toContain(">close</span>");
  });
});
