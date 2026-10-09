// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import {
  Button,
  CheckBox,
  Switch,
  Slider,
  Card as PrimitiveCard,
  CardHeader,
  CardTitle,
  CardContent,
  TabsRoot,
  TabsList,
  TabsTrigger,
  TabsContent,
  DialogRoot,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
  AccordionRoot,
  AccordionItem,
  AccordionTrigger,
  AccordionPanel,
  ProgressBar,
  Badge,
  Icon,
} from "@aphrody/m3-primitives";
import { Card, Page, Section } from "../ui.tsx";
import type { PageProps } from "./index.ts";

export default function Primitives({ adaptive }: PageProps) {
  const [count, setCount] = useState(0);
  const [checked, setChecked] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [progress, setProgress] = useState([35]);
  return (
    <Page
      title="React primitives"
      summary="The Base UI component family styled with Material 3 roles. Try keyboard focus, tabs, a modal dialog and the controlled inputs."
      packages={["@aphrody/m3-primitives", "@aphrody/m3-baseui"]}
      panes={adaptive.panes}
    >
      <Section title="Actions and surfaces">
        <div className="grid gap-3 expanded:grid-cols-3">
          {(["elevated", "filled", "outlined"] as const).map((variant) => (
            <PrimitiveCard key={variant} variant={variant}>
              <CardHeader>
                <CardTitle>{variant} card</CardTitle>
              </CardHeader>
              <CardContent>
                <Button
                  variant={variant === "elevated" ? "filled" : "outlined"}
                  onClick={() => setCount((value) => value + 1)}
                >
                  <Icon name="add" size={20} />
                  Activate
                </Button>
              </CardContent>
            </PrimitiveCard>
          ))}
        </div>
        <output className="text-body-large" aria-live="polite">
          Activations: {count}
        </output>
      </Section>
      <Section title="Controlled inputs">
        <Card className="flex flex-col gap-4">
          <label htmlFor="primitives-newsletter" className="flex items-center gap-3">
            <CheckBox
              id="primitives-newsletter"
              checked={checked}
              onChange={(event) => setChecked(event.target.checked)}
            />
            Receive a local demonstration newsletter
          </label>
          <label className="flex items-center gap-3">
            <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Enable preview" />
            Preview: {enabled ? "enabled" : "disabled"}
          </label>
          <Slider
            value={progress}
            onValueChange={setProgress}
            min={0}
            max={100}
            step={1}
            getAriaLabel={() => "Progress"}
          />
          <ProgressBar percent={progress[0]!} />
          <output>{progress[0]}%</output>
        </Card>
      </Section>
      <Section title="Tabs and disclosure">
        <Card>
          <TabsRoot defaultValue="preview">
            <TabsList aria-label="Primitive examples">
              <TabsTrigger value="preview">Preview</TabsTrigger>
              <TabsTrigger value="details">Details</TabsTrigger>
            </TabsList>
            <TabsContent value="preview" className="pt-4">
              <Badge>Interactive preview</Badge>
              <p className="mt-3 text-body-large">Use left and right arrows in the tab list.</p>
            </TabsContent>
            <TabsContent value="details" className="pt-4">
              <AccordionRoot>
                <AccordionItem value="accessibility">
                  <AccordionTrigger>Keyboard and focus</AccordionTrigger>
                  <AccordionPanel>
                    Base UI owns focus movement, expanded state and dismissal. M3 owns typography,
                    shape and theme roles.
                  </AccordionPanel>
                </AccordionItem>
              </AccordionRoot>
            </TabsContent>
          </TabsRoot>
        </Card>
      </Section>
      <Section
        title="Modal dialog"
        description="Opening the dialog moves focus inside; Escape closes it and restores focus to the trigger."
      >
        <DialogRoot>
          <DialogTrigger asChild>
            <Button variant="tonal">Open dialog</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogTitle>Local preview dialog</DialogTitle>
            <DialogDescription>
              This demonstration changes no account or remote data.
            </DialogDescription>
            <div className="pt-4">
              <DialogClose asChild>
                <Button>Close dialog</Button>
              </DialogClose>
            </div>
          </DialogContent>
        </DialogRoot>
      </Section>
    </Page>
  );
}
