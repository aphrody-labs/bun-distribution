// SPDX-License-Identifier: Apache-2.0 AND MIT
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AccordionItem,
  AccordionPanel,
  AccordionRoot,
  AccordionTrigger,
  AlertDialog,
  AvatarFallback,
  AvatarRoot,
  Drawer,
  Field,
  Meter,
  ScrollArea,
} from "../src";

describe("Base UI M3 primitives expansion", () => {
  test("Accordion renders root, item, trigger with indicator and panel", () => {
    const html = renderToStaticMarkup(
      <AccordionRoot defaultValue={["item-1"]}>
        <AccordionItem value="item-1">
          <AccordionTrigger>Section 1</AccordionTrigger>
          <AccordionPanel>Content 1</AccordionPanel>
        </AccordionItem>
      </AccordionRoot>,
    );
    expect(html).toContain("Section 1");
    expect(html).toContain("Content 1");
    expect(html).toContain("expand_more");
  });

  test("ScrollArea renders viewport and custom scrollbars", () => {
    const html = renderToStaticMarkup(
      <ScrollArea.Root className="size-48">
        <ScrollArea.Viewport>
          <div className="size-96">Large Content</div>
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar orientation="vertical">
          <ScrollArea.Thumb />
        </ScrollArea.Scrollbar>
        <ScrollArea.Corner />
      </ScrollArea.Root>,
    );
    expect(html).toContain("Large Content");
    expect(html).toContain("overflow-hidden");
  });

  test("AlertDialog component contract and subcomponents render", () => {
    expect(typeof AlertDialog).toBe("function");
    expect(AlertDialog.Root).toBeDefined();
    expect(AlertDialog.Popup).toBeDefined();
    expect(AlertDialog.Title).toBeDefined();
    expect(AlertDialog.Description).toBeDefined();
    expect(AlertDialog.Backdrop).toBeDefined();
    expect(AlertDialog.Close).toBeDefined();
  });

  test("Avatar renders image and fallback initials", () => {
    const html = renderToStaticMarkup(
      <AvatarRoot size="lg">
        <AvatarFallback>JD</AvatarFallback>
      </AvatarRoot>,
    );
    expect(html).toContain("JD");
    expect(html).toContain("rounded-full");
  });

  test("Meter renders label, track and formatted value", () => {
    const html = renderToStaticMarkup(
      <Meter.Root value={75} max={100} tone="tertiary">
        <Meter.Label>Storage</Meter.Label>
        <Meter.Track>
          <Meter.Indicator tone="tertiary" />
        </Meter.Track>
        <Meter.Value />
      </Meter.Root>,
    );
    expect(html).toContain("Storage");
    expect(html).toContain("bg-tertiary");
  });

  test("Field renders label, description, and error slots", () => {
    const html = renderToStaticMarkup(
      <Field.Root invalid>
        <Field.Label>Username</Field.Label>
        <Field.Description>Enter your handle</Field.Description>
        <Field.Error match={true}>Username is taken</Field.Error>
      </Field.Root>,
    );
    expect(html).toContain("Username");
    expect(html).toContain("Enter your handle");
    expect(html).toContain("Username is taken");
  });

  test("Drawer renders trigger and subcomponents contract", () => {
    expect(Drawer.Root).toBeDefined();
    expect(Drawer.Popup).toBeDefined();
    expect(Drawer.Backdrop).toBeDefined();
    expect(Drawer.Title).toBeDefined();
    expect(Drawer.Close).toBeDefined();
  });
});
