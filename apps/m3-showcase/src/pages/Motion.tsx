// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { Button } from "@aphrody/m3-primitives";
import {
  M3Transition,
  M3Fade,
  M3Collapse,
  M3ContainerTransform,
  M3ContainerTransformStart,
  M3ContainerTransformEnd,
  M3ListStagger,
  M3ListStaggerItem,
  useM3ReducedMotion,
  type M3TransitionPattern,
} from "@aphrody/m3-motion";
import { Card, Page, Section } from "../components/ui.tsx";
import type { PageProps } from "./index.ts";

const PATTERNS: M3TransitionPattern[] = [
  "fade",
  "fade-through",
  "shared-axis-x",
  "shared-axis-y",
  "shared-axis-z",
  "collapse",
];
export default function Motion({ adaptive }: PageProps) {
  const reduced = useM3ReducedMotion();
  const [pattern, setPattern] = useState<M3TransitionPattern>("shared-axis-x");
  const [step, setStep] = useState(0);
  const [forward, setForward] = useState(true);
  const [shown, setShown] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [items, setItems] = useState([1, 2, 3]);
  return (
    <Page
      title="Motion"
      summary="Material 3 transitions, shared containers and list staggering. Every example follows your operating system's reduced-motion preference, including changes while this page is open."
      packages={["@aphrody/m3-motion"]}
      panes={adaptive.panes}
    >
      <p role="status" className="text-body-medium">
        Reduced motion:{" "}
        {reduced ? "on — states update without animation" : "off — Material motion is active"}
      </p>
      <Section title="Navigation patterns">
        <Card className="flex flex-col gap-4">
          <label className="flex flex-col gap-2 text-label-large">
            Transition pattern
            <select
              value={pattern}
              onChange={(event) => setPattern(event.target.value as M3TransitionPattern)}
              className="rounded-small border border-outline bg-surface p-3"
            >
              {PATTERNS.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <div className="min-h-28 overflow-hidden rounded-medium bg-primary-container p-4">
            <M3Transition stateKey={step} pattern={pattern} forward={forward}>
              <h3 className="text-title-large text-on-primary-container">View {step + 1}</h3>
              <p className="text-body-large text-on-primary-container">
                The state key drives entry and exit. Try forward and backward navigation.
              </p>
            </M3Transition>
          </div>
          <div className="flex gap-3">
            <Button
              variant="outlined"
              disabled={step === 0}
              onClick={() => {
                setForward(false);
                setStep((value) => Math.max(0, value - 1));
              }}
            >
              Previous
            </Button>
            <Button
              onClick={() => {
                setForward(true);
                setStep((value) => value + 1);
              }}
            >
              Next
            </Button>
          </div>
        </Card>
      </Section>
      <Section title="Fade and collapse">
        <Card className="flex flex-col gap-4">
          <Button variant="tonal" onClick={() => setShown((value) => !value)} aria-expanded={shown}>
            Toggle content
          </Button>
          <M3Fade in={shown}>
            <p className="text-body-large">A fade keeps the transition focused on opacity.</p>
          </M3Fade>
          <M3Collapse in={shown}>
            <div className="rounded-medium bg-secondary-container p-4 text-on-secondary-container">
              Collapse interpolates the natural height of this disclosure.
            </div>
          </M3Collapse>
        </Card>
      </Section>
      <Section title="Container transform">
        <M3ContainerTransform
          isExpanded={expanded}
          layoutId="showcase-container"
          className="rounded-large bg-tertiary-container text-on-tertiary-container p-4"
          style={{ height: expanded ? 210 : 100 }}
        >
          <M3ContainerTransformStart>
            <h3 className="text-title-medium">Compact card</h3>
            <Button variant="text" onClick={() => setExpanded(true)}>
              Expand card
            </Button>
          </M3ContainerTransformStart>
          <M3ContainerTransformEnd>
            <h3 className="text-headline-small">Expanded details</h3>
            <p className="my-4 text-body-large">
              The inactive layer is inert and hidden from assistive technology.
            </p>
            <Button variant="text" onClick={() => setExpanded(false)}>
              Collapse card
            </Button>
          </M3ContainerTransformEnd>
        </M3ContainerTransform>
      </Section>
      <Section title="List staggering">
        <Card className="flex flex-col gap-4">
          <div className="flex gap-3">
            <Button onClick={() => setItems((values) => [...values, (values.at(-1) ?? 0) + 1])}>
              Add item
            </Button>
            <Button
              variant="outlined"
              disabled={items.length === 0}
              onClick={() => setItems((values) => values.slice(0, -1))}
            >
              Remove item
            </Button>
          </div>
          <M3ListStagger className="flex flex-wrap gap-3">
            {items.map((item) => (
              <M3ListStaggerItem
                key={item}
                className="rounded-medium bg-surface-container-high px-4 py-3 text-body-large"
              >
                Item {item}
              </M3ListStaggerItem>
            ))}
          </M3ListStagger>
        </Card>
      </Section>
    </Page>
  );
}
