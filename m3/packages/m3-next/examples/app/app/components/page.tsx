// SPDX-License-Identifier: Apache-2.0
// A Server Component that renders Base UI parts styled with M3: the wrappers are 'use client' modules, so a server page
// composes them with plain props (render elements, items, values) and ships only their interactive code.
import {
  M3Accordion,
  M3Avatar,
  M3Button,
  M3Checkbox,
  M3Dialog,
  M3Field,
  M3Input,
  M3Menu,
  M3Meter,
  M3NumberField,
  M3Popover,
  M3Progress,
  M3Radio,
  M3RadioGroup,
  M3Select,
  M3Separator,
  M3Slider,
  M3Switch,
  M3Tabs,
  M3Toggle,
  M3ToggleGroup,
  M3Tooltip,
} from "@aphrody/m3-baseui";
import { Nav } from "../nav";
import { Notifier } from "./notifier";

const fruit = [
  { label: "Apple", value: "apple" },
  { label: "Banana", value: "banana" },
  { label: "Cherry", value: "cherry" },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-extra-large bg-surface-container-low p-6">
      <h2 className="text-title-medium text-on-surface-variant">{title}</h2>
      <div className="flex flex-wrap items-center gap-4">{children}</div>
    </section>
  );
}

export default function ComponentsPage() {
  return (
    <>
      <Nav />
      <main className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
        <h1 className="text-headline-medium">Base UI, styled by M3</h1>

        <Section title="Button: five types">
          <M3Button>Filled</M3Button>
          <M3Button variant="tonal">Tonal</M3Button>
          <M3Button variant="outlined">Outlined</M3Button>
          <M3Button variant="text">Text</M3Button>
          <M3Button variant="elevated">Elevated</M3Button>
          <M3Button disabled>Disabled</M3Button>
        </Section>

        <Section title="Selection controls">
          <M3Switch defaultChecked aria-label="Wi-Fi" />
          <M3Checkbox defaultChecked aria-label="Accept" />
          <M3Checkbox indeterminate aria-label="Some" />
          <M3RadioGroup defaultValue="a" aria-label="Choice" className="flex-row">
            <M3Radio value="a" aria-label="A" />
            <M3Radio value="b" aria-label="B" />
          </M3RadioGroup>
          <M3ToggleGroup defaultValue={["bold"]} aria-label="Format">
            <M3Toggle value="bold">Bold</M3Toggle>
            <M3Toggle value="italic">Italic</M3Toggle>
          </M3ToggleGroup>
        </Section>

        <Section title="Text fields">
          <M3Field.Root className="min-w-64">
            <M3Field.Label>Name</M3Field.Label>
            <M3Field.Control placeholder="Ada Lovelace" />
            <M3Field.Description>As on your passport.</M3Field.Description>
          </M3Field.Root>
          <M3Input variant="filled" aria-label="Email" placeholder="Filled field" />
          <M3NumberField.Root defaultValue={3} min={0} max={9}>
            <M3NumberField.Group>
              <M3NumberField.Decrement aria-label="Less">-</M3NumberField.Decrement>
              <M3NumberField.Input aria-label="Quantity" />
              <M3NumberField.Increment aria-label="More">+</M3NumberField.Increment>
            </M3NumberField.Group>
          </M3NumberField.Root>
        </Section>

        <Section title="Select, menu, popover, tooltip, dialog">
          <M3Select.Root items={fruit} defaultValue="banana">
            <M3Select.Trigger aria-label="Fruit">
              <M3Select.Value />
              <M3Select.Icon>▾</M3Select.Icon>
            </M3Select.Trigger>
            <M3Select.Portal>
              <M3Select.Positioner sideOffset={4}>
                <M3Select.Popup>
                  <M3Select.List>
                    {fruit.map((item) => (
                      <M3Select.Item key={item.value} value={item.value}>
                        <M3Select.ItemIndicator>✓</M3Select.ItemIndicator>
                        <M3Select.ItemText>{item.label}</M3Select.ItemText>
                      </M3Select.Item>
                    ))}
                  </M3Select.List>
                </M3Select.Popup>
              </M3Select.Positioner>
            </M3Select.Portal>
          </M3Select.Root>

          <M3Menu.Root>
            <M3Menu.Trigger render={<M3Button variant="outlined" />}>Menu</M3Menu.Trigger>
            <M3Menu.Portal>
              <M3Menu.Positioner sideOffset={4}>
                <M3Menu.Popup>
                  <M3Menu.Item>Cut</M3Menu.Item>
                  <M3Menu.Item>Copy</M3Menu.Item>
                  <M3Menu.Separator />
                  <M3Menu.Item>Paste</M3Menu.Item>
                </M3Menu.Popup>
              </M3Menu.Positioner>
            </M3Menu.Portal>
          </M3Menu.Root>

          <M3Popover.Root>
            <M3Popover.Trigger render={<M3Button variant="tonal" />}>Popover</M3Popover.Trigger>
            <M3Popover.Portal>
              <M3Popover.Positioner sideOffset={8}>
                <M3Popover.Popup>
                  <M3Popover.Title>Rich content</M3Popover.Title>
                  <M3Popover.Description>Anchored to its trigger.</M3Popover.Description>
                </M3Popover.Popup>
              </M3Popover.Positioner>
            </M3Popover.Portal>
          </M3Popover.Root>

          <M3Tooltip.Provider>
            <M3Tooltip.Root>
              <M3Tooltip.Trigger render={<M3Button variant="text" />}>Tooltip</M3Tooltip.Trigger>
              <M3Tooltip.Portal>
                <M3Tooltip.Positioner sideOffset={6}>
                  <M3Tooltip.Popup>Plain tooltip</M3Tooltip.Popup>
                </M3Tooltip.Positioner>
              </M3Tooltip.Portal>
            </M3Tooltip.Root>
          </M3Tooltip.Provider>

          <M3Dialog.Root>
            <M3Dialog.Trigger render={<M3Button />}>Open dialog</M3Dialog.Trigger>
            <M3Dialog.Portal>
              <M3Dialog.Backdrop />
              <M3Dialog.Popup>
                <M3Dialog.Title>Discard draft?</M3Dialog.Title>
                <M3Dialog.Description>
                  The draft is deleted and cannot be restored.
                </M3Dialog.Description>
                <div className="flex justify-end gap-2">
                  <M3Dialog.Close render={<M3Button variant="text" />}>Cancel</M3Dialog.Close>
                  <M3Dialog.Close render={<M3Button variant="text" />}>Discard</M3Dialog.Close>
                </div>
              </M3Dialog.Popup>
            </M3Dialog.Portal>
          </M3Dialog.Root>
        </Section>

        <Section title="Navigation and disclosure">
          <M3Tabs.Root defaultValue="one" className="w-full">
            <M3Tabs.List>
              <M3Tabs.Tab value="one">One</M3Tabs.Tab>
              <M3Tabs.Tab value="two">Two</M3Tabs.Tab>
              <M3Tabs.Indicator />
            </M3Tabs.List>
            <M3Tabs.Panel value="one">First panel</M3Tabs.Panel>
            <M3Tabs.Panel value="two">Second panel</M3Tabs.Panel>
          </M3Tabs.Root>
          <M3Accordion.Root className="w-full">
            <M3Accordion.Item value="a">
              <M3Accordion.Header>
                <M3Accordion.Trigger>What is Cache Components?</M3Accordion.Trigger>
              </M3Accordion.Header>
              <M3Accordion.Panel>
                `use cache`, `cacheLife` and `cacheTag`, with a static shell.
              </M3Accordion.Panel>
            </M3Accordion.Item>
          </M3Accordion.Root>
        </Section>

        <Section title="Feedback">
          <M3Slider.Root defaultValue={40} className="w-64">
            <M3Slider.Label>Volume</M3Slider.Label>
            <M3Slider.Value />
            <M3Slider.Control>
              <M3Slider.Track>
                <M3Slider.Indicator />
                <M3Slider.Thumb aria-label="Volume" />
              </M3Slider.Track>
            </M3Slider.Control>
          </M3Slider.Root>
          <M3Progress.Root value={65} className="w-64">
            <M3Progress.Label>Upload</M3Progress.Label>
            <M3Progress.Value />
            <M3Progress.Track>
              <M3Progress.Indicator />
            </M3Progress.Track>
          </M3Progress.Root>
          <M3Meter.Root value={30} className="w-64">
            <M3Meter.Label>Disk</M3Meter.Label>
            <M3Meter.Track>
              <M3Meter.Indicator />
            </M3Meter.Track>
          </M3Meter.Root>
          <M3Avatar.Root>
            <M3Avatar.Fallback>AL</M3Avatar.Fallback>
          </M3Avatar.Root>
          <M3Separator className="w-full" />
          <Notifier />
        </Section>
      </main>
    </>
  );
}
