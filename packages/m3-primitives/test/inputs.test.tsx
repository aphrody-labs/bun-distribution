// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { useForm } from "react-hook-form";
import { renderToStaticMarkup } from "react-dom/server";

import { CheckBox, CheckboxIndicator, CheckboxRoot, RadixCheckbox } from "../src/Checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../src/Collapsible";
import { ErrorMessage, errorStyles, Form, z } from "../src/forms/Form";
import { Input, inputSizes, inputStyles, Label, PasswordInput, SearchInput, TextArea } from "../src/Input";
import { NumberStepper } from "../src/NumberStepper";
import { Item as RadioItem, Root as RadioRoot } from "../src/RadioGroup";
import { Resizable, ResizableHandle, ResizablePanel } from "../src/Resizable";
import { SearchBar } from "../src/SearchBar";
import { Select, SelectOption, SelectRoot, SelectTrigger, SelectValue, selectStyles } from "../src/Select";
import { Slider } from "../src/Slider";
import { Switch } from "../src/Switch";
import { Content as TabsContent, List as TabsList, Root as TabsRoot, Trigger as TabsTrigger } from "../src/Tabs";

const SPACEUI_VOCAB = /\b(bg|text|border)-(app|ink|sidebar|menu|accent)\b/;

const render = (el: ReactElement) => renderToStaticMarkup(el);

/** Rendered markup is M3-only: no SpaceUI vocabulary, no hard-coded white, no brightness hacks. */
function expectM3(html: string) {
  expect(html).not.toMatch(SPACEUI_VOCAB);
  expect(html).not.toContain("text-white");
  expect(html).not.toContain("bg-white");
  expect(html).not.toContain("brightness-");
}

describe("Input", () => {
  test("outlined by default, M3 56dp baseline and body-large", () => {
    const html = render(<Input placeholder="Name" />);
    expect(html).toContain("rounded-extra-small");
    expect(html).toContain("border-outline");
    expect(html).toContain("h-14");
    expect(html).toContain("text-body-large");
    expect(html).toContain("placeholder:text-on-surface-variant");
    expectM3(html);
  });

  test("upstream sizes map to density steps, dense sizes use body-medium", () => {
    expect(render(<Input size="xs" />)).toContain("h-8");
    expect(render(<Input size="sm" />)).toContain("text-body-medium");
    expect(render(<Input size="md" />)).toContain("h-10");
    expect(render(<Input size="lg" />)).toContain("h-12");
    expect(inputSizes.xl).toContain("h-14");
  });

  test("filled variant has the container and active indicator", () => {
    const html = render(<Input variant="filled" />);
    expect(html).toContain("bg-surface-container-highest");
    expect(html).toContain("rounded-t-extra-small");
    expect(html).toContain("border-b");
    expectM3(html);
  });

  test("error state uses the error role and supporting text", () => {
    const html = render(<Input error supportingText="Required" />);
    expect(html).toContain("border-error");
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("text-body-small");
    expect(html).toContain("text-error");
  });

  test("icon accepts a Material Symbols name, upstream transparent variant still works", () => {
    const html = render(<Input icon="mail" variant="transparent" right={<span>R</span>} />);
    expect(html).toContain(">mail<");
    expect(html).toContain("border-transparent");
    expect(html).toContain(">R<");
  });

  test("SearchInput, TextArea, Label, PasswordInput", () => {
    expect(render(<SearchInput />)).toContain(">search<");
    const area = render(<TextArea variant="filled" />);
    expect(area).toContain("<textarea");
    expect(area).toContain("bg-surface-container-highest");
    expect(render(<Label slug="x">L</Label>)).toContain("text-label-large");
    const pw = render(<PasswordInput buttonClassnames="extra" />);
    expect(pw).toContain('type="password"');
    expect(pw).toContain(">visibility<");
    expect(pw).toContain("extra");
    expect(pw).not.toContain("buttonclassnames");
    expectM3(pw);
    expect(inputStyles()).toContain("rounded-extra-small");
  });
});

describe("SearchBar", () => {
  test("M3 search bar anatomy", () => {
    const html = render(<SearchBar value="abc" onChange={() => {}} />);
    expect(html).toContain("rounded-full");
    expect(html).toContain("bg-surface-container-high");
    expect(html).toContain(">search<");
    expect(html).toContain(">close<");
    expect(html).toContain("text-body-large");
    expect(html).toContain("hover:before:opacity-8");
    expectM3(html);
  });

  test("dense size and no clear button when empty", () => {
    const html = render(<SearchBar size="xs" />);
    expect(html).toContain("h-8");
    expect(html).toContain("text-body-medium");
    expect(html).not.toContain(">close<");
  });
});

describe("Checkbox", () => {
  test("native CheckBox: 18dp, 2dp corner, on-surface-variant outline, primary when checked", () => {
    const html = render(<CheckBox defaultChecked />);
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("size-[18px]");
    expect(html).toContain("rounded-[2px]");
    expect(html).toContain("border-on-surface-variant");
    expect(html).toContain("checked:bg-primary");
    expect(html).toContain("before:size-10");
    expectM3(html);
  });

  test("error variant", () => {
    expect(render(<CheckBox error />)).toContain("border-error");
  });

  test("RadixCheckbox checked renders the check glyph on primary", () => {
    const html = render(<RadixCheckbox name="agree" label="Agree" checked />);
    expect(html).toContain('data-checked=""');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("data-checked:bg-primary");
    expect(html).toContain("text-on-primary");
    expect(html).toContain(">check<");
    expect(html).toContain(">Agree<");
    expect(html).not.toMatch(/<button[^>]* label=/);
    expectM3(html);
  });

  test("indeterminate renders the dash glyph", () => {
    const html = render(<RadixCheckbox checked="indeterminate" />);
    expect(html).toContain('data-indeterminate=""');
    expect(html).toContain('aria-checked="mixed"');
    expect(html).toContain(">remove<");
  });

  test("CheckboxRoot / CheckboxIndicator carry the M3 anatomy", () => {
    const html = render(
      <CheckboxRoot defaultChecked>
        <CheckboxIndicator />
      </CheckboxRoot>,
    );
    expect(html).toContain("rounded-[2px]");
    expect(html).toContain(">check<");
  });
});

describe("Switch", () => {
  test("unselected: surface-container-highest track, outline border and handle", () => {
    const html = render(<Switch />);
    expect(html).toContain("h-8 w-[52px]");
    expect(html).toContain("rounded-full");
    expect(html).toContain("bg-surface-container-highest");
    expect(html).toContain("border-outline");
    expect(html).toContain("bg-outline");
    expect(html).toContain('data-unchecked=""');
    expect(html).toContain('role="switch"');
    expectM3(html);
  });

  test("selected: primary track, on-primary handle, optional check icon", () => {
    const html = render(<Switch checked icons />);
    expect(html).toContain('data-checked=""');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("data-checked:bg-primary");
    expect(html).toContain("data-checked:bg-on-primary");
    expect(html).toContain(">check<");
  });

  test("upstream sizes still work (sm is a density step)", () => {
    expect(render(<Switch size="sm" />)).toContain("h-6 w-10");
    expect(render(<Switch size="lg" thumbClassName="thumb-x" />)).toContain("thumb-x");
  });
});

describe("Slider", () => {
  test("4dp track, secondary-container inactive, primary active, 20dp handle per value", () => {
    const html = render(<Slider defaultValue={[20, 80]} max={100} />);
    expect(html).toContain("h-1");
    expect(html).toContain("bg-secondary-container");
    expect(html).toContain("bg-primary");
    expect(html).toContain("size-5");
    // One native <input type="range"> (implicit role="slider") per handle.
    expect(html.match(/type="range"/g)?.length).toBe(2);
    expectM3(html);
  });
});

describe("RadioGroup", () => {
  test("20dp ring, primary when selected, 10dp dot", () => {
    const html = render(
      <RadioRoot defaultValue="a">
        <RadioItem value="a">A</RadioItem>
        <RadioItem value="b" disabled>
          B
        </RadioItem>
      </RadioRoot>,
    );
    expect(html).toContain("size-5");
    expect(html).toContain("border-2 border-on-surface-variant");
    expect(html).toContain("data-checked:border-primary");
    expect(html).toContain("size-2.5 rounded-full bg-primary");
    expect(html).toContain("before:size-10");
    expect(html).toContain("opacity-38");
    expectM3(html);
  });
});

describe("Select", () => {
  test("trigger is an outlined text field with a dropdown icon", () => {
    const html = render(
      <Select value="a" onChange={() => {}} placeholder="Pick">
        <SelectOption value="a">Alpha</SelectOption>
      </Select>,
    );
    expect(html).toContain("rounded-extra-small");
    expect(html).toContain("border-outline");
    expect(html).toContain(">arrow_drop_down<");
    expectM3(html);
  });

  test("sizes and filled variant", () => {
    expect(selectStyles({ size: "xl" })).toContain("h-14");
    expect(selectStyles({ variant: "filled" })).toContain("bg-surface-container-highest");
    expect(selectStyles()).toContain("h-8");
  });

  test("composable trigger", () => {
    const html = render(
      <SelectRoot>
        <SelectTrigger>
          <SelectValue placeholder="Choose" />
        </SelectTrigger>
      </SelectRoot>,
    );
    expect(html).toContain("border-outline");
    expect(html).toContain(">arrow_drop_down<");
    expectM3(html);
  });
});

describe("Tabs", () => {
  test("M3 primary tabs", () => {
    const html = render(
      <TabsRoot defaultValue="one">
        <TabsList>
          <TabsTrigger value="one">One</TabsTrigger>
          <TabsTrigger value="two" size="sm">
            Two
          </TabsTrigger>
        </TabsList>
        <TabsContent value="one">Body</TabsContent>
      </TabsRoot>,
    );
    expect(html).toContain("border-b border-outline-variant");
    expect(html).toContain("h-12");
    expect(html).toContain("h-8");
    expect(html).toContain("text-label-large");
    expect(html).toContain("text-on-surface-variant");
    expect(html).toContain("data-active:text-primary");
    expect(html).toContain("after:h-[3px]");
    expect(html).toContain("after:bg-primary");
    expect(html).toContain('data-active=""');
    expect(html).toContain('aria-selected="true"');
    expectM3(html);
  });
});

describe("NumberStepper", () => {
  test("outlined field with add / remove icon buttons and linear progress", () => {
    const html = render(
      <NumberStepper
        value={5}
        onChange={() => {}}
        min={0}
        max={10}
        showProgress
        label="Count"
        description="How many"
        suffix="x"
      />,
    );
    expect(html).toContain("rounded-extra-small border border-outline");
    expect(html).toContain(">add<");
    expect(html).toContain(">remove<");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain("bg-secondary-container");
    expect(html).toContain("width:50%");
    expect(html).toContain(">5x<");
    expectM3(html);
  });

  test("dense size", () => {
    expect(render(<NumberStepper value={1} onChange={() => {}} size="sm" />)).toContain("h-10");
  });
});

describe("Collapsible", () => {
  test("expansion panel header with rotating expand_more, content when open", () => {
    const html = render(
      <Collapsible defaultOpen>
        <CollapsibleTrigger>Header</CollapsibleTrigger>
        <CollapsibleContent>Inner</CollapsibleContent>
      </Collapsible>,
    );
    expect(html).toContain("rounded-medium");
    expect(html).toContain("text-title-small");
    expect(html).toContain(">expand_more<");
    expect(html).toContain("group-data-panel-open:rotate-180");
    expect(html).toContain("Inner");
    expectM3(html);
  });

  test("closed content is not rendered; indicator can be disabled", () => {
    const html = render(
      <Collapsible>
        <CollapsibleTrigger indicator={false}>Header</CollapsibleTrigger>
        <CollapsibleContent>Inner</CollapsibleContent>
      </Collapsible>,
    );
    expect(html).not.toContain("Inner");
    expect(html).not.toContain("expand_more");
  });
});

describe("Resizable", () => {
  test("handle uses outline-variant at rest and primary when active", () => {
    const html = render(
      <Resizable initial={200} min={100}>
        <ResizablePanel>Panel</ResizablePanel>
        <ResizableHandle />
      </Resizable>,
    );
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain("before:bg-outline-variant");
    expect(html).toContain("after:bg-primary");
    expect(html).toContain("cursor-col-resize");
    expect(html).toContain("width:200px");
    expectM3(html);
  });
});

/** Seeds the error through the `errors` option instead of mutating `formState`. */
const NAME_REQUIRED = {
  name: { type: "required", message: "Name is required" },
};

function Harness({ withError }: { withError: boolean }) {
  const form = useForm<{ name: string }>({
    errors: withError ? NAME_REQUIRED : undefined,
  });
  return (
    <Form form={form}>
      <input />
      <ErrorMessage name="name" className="extra" />
    </Form>
  );
}

describe("Form", () => {
  test("renders a form and fieldset", () => {
    const html = render(<Harness withError={false} />);
    expect(html).toContain("<form");
    expect(html).toContain("<fieldset");
    expect(html).not.toContain('role="alert"');
  });

  test("error message is M3 error supporting text with a leading error icon", () => {
    const html = render(<Harness withError />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("text-error");
    expect(html).toContain("text-body-small");
    expect(html).toContain(">error<");
    expect(html).toContain("Name is required");
    expectM3(html);
  });

  test("errorStyles variants and the zod re-export", () => {
    expect(errorStyles({ variant: "large" })).toContain("text-body-medium");
    const schema = z.object({ name: z.string().min(1) });
    expect(schema.safeParse({ name: "" }).success).toBe(false);
    expect(schema.parse({ name: "a" })).toEqual({ name: "a" });
  });
});
