// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import {
  MdElevatedButton,
  MdFilledButton,
  MdFilledTonalButton,
  MdOutlinedButton,
  MdTextButton,
} from "@aphrody/m3-react/button";
import {
  MdOutlinedTextField,
  MdFilledTextField,
} from "@aphrody/m3-react/textfield";
import { MdSwitch } from "@aphrody/m3-react/switch";
import { MdSlider } from "@aphrody/m3-react/slider";
import { Card, Page, Section } from "../ui.tsx";
import type { PageProps } from "./index.ts";

export default function Components({ adaptive }: PageProps) {
  const [clicks, setClicks] = useState(0);
  const [name, setName] = useState("Aphrody");
  const [enabled, setEnabled] = useState(true);
  const [volume, setVolume] = useState(50);
  return (
    <Page
      title="Web components"
      summary="Material Web custom elements rendered through the React adapters. The shared theme reaches their shadow roots; native events update React state."
      packages={["@aphrody/material-web", "@aphrody/m3-react"]}
      panes={adaptive.panes}
    >
      <Section
        title="Button family"
        description="All five Material 3 emphasis levels trigger the same local counter."
      >
        <Card className="flex flex-wrap items-center gap-3">
          <MdElevatedButton onClick={() => setClicks((value) => value + 1)}>
            Elevated
          </MdElevatedButton>
          <MdFilledButton onClick={() => setClicks((value) => value + 1)}>
            Filled
          </MdFilledButton>
          <MdFilledTonalButton onClick={() => setClicks((value) => value + 1)}>
            Tonal
          </MdFilledTonalButton>
          <MdOutlinedButton onClick={() => setClicks((value) => value + 1)}>
            Outlined
          </MdOutlinedButton>
          <MdTextButton onClick={() => setClicks((value) => value + 1)}>
            Text
          </MdTextButton>
          <output className="text-body-large" aria-live="polite">
            Activations: {clicks}
          </output>
        </Card>
      </Section>
      <Section
        title="Text fields"
        description="Input events keep outlined and filled fields in sync."
      >
        <Card className="flex flex-wrap items-start gap-4">
          <MdOutlinedTextField
            label="Outlined name"
            value={name}
            onInput={(event) =>
              setName((event.currentTarget as HTMLInputElement).value)
            }
          />
          <MdFilledTextField
            label="Filled name"
            value={name}
            onInput={(event) =>
              setName((event.currentTarget as HTMLInputElement).value)
            }
          />
          <p className="text-body-large">Hello, {name || "visitor"}.</p>
        </Card>
      </Section>
      <Section title="Selection and range">
        <Card className="flex flex-col gap-4">
          <label className="flex items-center gap-3">
            <MdSwitch
              selected={enabled}
              onChange={(event) =>
                setEnabled(
                  (event.currentTarget as unknown as { selected: boolean })
                    .selected,
                )
              }
              aria-label="Enable notifications"
            />
            Enable notifications: {enabled ? "on" : "off"}
          </label>
          <MdSlider
            min={0}
            max={100}
            value={volume}
            aria-label="Volume"
            onInput={(event) =>
              setVolume(Number((event.currentTarget as HTMLInputElement).value))
            }
          />
          <output className="text-body-large">Volume: {volume}%</output>
        </Card>
      </Section>
    </Page>
  );
}
