import { afterEach, describe, expect, test } from "bun:test";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "../src/components/button";
import { Checkbox } from "../src/components/checkbox";
import { Switch } from "../src/components/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../src/components/tabs";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "../src/components/accordion";
import { ToggleGroup, ToggleGroupItem } from "../src/components/toggle-group";
import { Slider } from "../src/components/slider";
import { RadioGroup, RadioGroupItem } from "../src/components/radio-group";
import { Progress } from "../src/components/progress";
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerTitle,
  DrawerDescription,
  DrawerClose,
} from "../src/components/drawer";

let root: ReturnType<typeof createRoot> | undefined;
async function render(children: React.ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await React.act(async () => root?.render(children));
}
async function click(selector: string) {
  const element = document.querySelector(selector);
  if (!element) throw new Error("Missing " + selector);
  await React.act(async () => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}
async function key(selector: string, pressedKey: string) {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error("Missing " + selector);
  await React.act(async () => element.focus());
  await React.act(async () =>
    element.dispatchEvent(new KeyboardEvent("keydown", { key: pressedKey, bubbles: true })),
  );
}
afterEach(async () => {
  await React.act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

describe("Bun Base UI control compatibility", () => {
  test("Button keeps asChild links and disabled native button behavior", async () => {
    let linked = 0;
    let disabled = 0;
    await render(
      <>
        <Button asChild onClick={() => linked++}>
          <a id="link" href="#target">
            Link
          </a>
        </Button>
        <Button id="disabled" disabled onClick={() => disabled++}>
          Disabled
        </Button>
      </>,
    );
    expect(document.querySelector("#link")?.tagName).toBe("A");
    await click("#link");
    await click("#disabled");
    expect(linked).toBe(1);
    expect(disabled).toBe(0);
  });
  test("an uncontrolled mixed checkbox resolves to checked and switch submits native form data", async () => {
    let checked: boolean | "indeterminate" = false;
    await render(
      <form id="form">
        <Checkbox
          id="mixed"
          name="choice"
          defaultChecked="indeterminate"
          onCheckedChange={(value) => {
            checked = value;
          }}
        />
        <Switch id="switch" name="enabled" defaultChecked />
      </form>,
    );
    expect(document.querySelector('[role="checkbox"]')?.getAttribute("aria-checked")).toBe("mixed");
    await click('[role="checkbox"]');
    expect(checked).toBe(true);
    expect(document.querySelector('[role="checkbox"]')?.getAttribute("aria-checked")).toBe("true");
    const form = document.querySelector<HTMLFormElement>("#form")!;
    expect(new FormData(form).get("enabled")).toBe("on");
    await click('[role="switch"]');
    expect(new FormData(form).get("enabled")).toBeNull();
  });
  test("Tabs preserve automatic arrow activation and force-mounted inactive panels", async () => {
    let active = "a";
    await render(
      <Tabs
        defaultValue="a"
        onValueChange={(value) => {
          active = value;
        }}
      >
        <TabsList>
          <TabsTrigger id="tab-a" value="a">
            A
          </TabsTrigger>
          <TabsTrigger id="tab-b" value="b">
            B
          </TabsTrigger>
        </TabsList>
        <TabsContent value="a">Panel A</TabsContent>
        <TabsContent id="panel-b" value="b" forceMount>
          Panel B
        </TabsContent>
      </Tabs>,
    );
    expect(document.querySelector("#panel-b")?.hasAttribute("hidden")).toBe(true);
    await key("#tab-a", "ArrowRight");
    expect(active).toBe("b");
    expect(document.querySelector("#tab-b")?.getAttribute("aria-selected")).toBe("true");
  });
  test("single and multiple accordion and toggle values retain their consumer shapes", async () => {
    let single = "";
    let multiple: string[] = [];
    let toggled = "";
    await render(
      <>
        <Accordion
          type="single"
          collapsible
          onValueChange={(value) => {
            single = value;
          }}
        >
          <AccordionItem value="a">
            <AccordionTrigger id="accordion-a">A</AccordionTrigger>
            <AccordionContent>Content</AccordionContent>
          </AccordionItem>
        </Accordion>
        <Accordion
          type="multiple"
          onValueChange={(value) => {
            multiple = value;
          }}
        >
          <AccordionItem value="b">
            <AccordionTrigger id="accordion-b">B</AccordionTrigger>
            <AccordionContent>Content</AccordionContent>
          </AccordionItem>
        </Accordion>
        <ToggleGroup
          type="single"
          onValueChange={(value) => {
            toggled = value;
          }}
        >
          <ToggleGroupItem id="toggle-a" value="a">
            A
          </ToggleGroupItem>
        </ToggleGroup>
      </>,
    );
    await click("#accordion-a");
    expect(single).toBe("a");
    await click("#accordion-a");
    expect(single).toBe("");
    await click("#accordion-b");
    expect(multiple).toEqual(["b"]);
    await click("#toggle-a");
    expect(toggled).toBe("a");
  });
  test("range slider renders every thumb and keyboard changes the array value", async () => {
    let values = [20, 70];
    await render(
      <Slider
        defaultValue={values}
        onValueChange={(next) => {
          values = next;
        }}
        minStepsBetweenThumbs={2}
        aria-label="Range"
      />,
    );
    expect(document.querySelectorAll('input[type="range"]').length).toBe(2);
    await key('input[type="range"]', "ArrowRight");
    expect(values).toEqual([21, 70]);
  });
  test("radio controls submit their scalar value and progress exposes the actual range", async () => {
    let value = "a";
    await render(
      <form id="radio-form">
        <RadioGroup
          name="choice"
          defaultValue="a"
          onValueChange={(next: string) => {
            value = next;
          }}
        >
          <RadioGroupItem id="radio-a" value="a" />
          <RadioGroupItem id="radio-b" value="b" />
        </RadioGroup>
        <Progress value={25} max={50} />
      </form>,
    );
    await click("#radio-b");
    expect(value).toBe("b");
    expect(
      new FormData(document.querySelector<HTMLFormElement>("#radio-form")!).get("choice"),
    ).toBe("b");
    expect(document.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe(
      "25",
    );
    expect(
      document.querySelector('[data-slot="progress-indicator"]')?.getAttribute("style"),
    ).toContain("width: 50%");
  });
  test("Drawer retains its edge direction, title and trigger focus on close", async () => {
    await render(
      <Drawer direction="left">
        <DrawerTrigger id="drawer-trigger">Open</DrawerTrigger>
        <DrawerContent>
          <DrawerTitle>Menu</DrawerTitle>
          <DrawerDescription>Navigation</DrawerDescription>
          <DrawerClose id="drawer-close">Close</DrawerClose>
        </DrawerContent>
      </Drawer>,
    );
    await click("#drawer-trigger");
    expect(
      document.querySelector('[data-slot="drawer-content"]')?.getAttribute("data-drawer-direction"),
    ).toBe("left");
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await click("#drawer-close");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(document.querySelector("#drawer-trigger"));
  });
  test("the selected tab and native progress value are available during server rendering", () => {
    const html = renderToStaticMarkup(
      <>
        <Tabs defaultValue="a">
          <TabsList>
            <TabsTrigger value="a">A</TabsTrigger>
          </TabsList>
          <TabsContent value="a">Panel</TabsContent>
        </Tabs>
        <Progress value={30} />
      </>,
    );
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('aria-valuenow="30"');
  });
});
