// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from "react";
import { useM3Theme } from "@aphrody/m3-theme/react";
import type { GenerationResult } from "@aphrody/m3-design";
import { Button } from "@aphrody/m3-primitives";
import { Card, Code, Page, Section, Swatch } from "../components/ui.tsx";
import type { PageProps } from "./index.ts";

export default function Design({ adaptive }: PageProps) {
  const theme = useM3Theme();
  const [brief, setBrief] = useState(
    "A minimal dashboard for developers, with a list-detail layout and supporting information.",
  );
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [file, setFile] = useState("src/theme.css");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  async function compile() {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief, seed: theme.seedColor }),
        signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The brief could not be compiled.");
      if (!controller.signal.aborted) {
        setResult(payload as GenerationResult);
        setFile("src/theme.css");
        setNotice("Design generated locally.");
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setNotice(error instanceof Error ? error.message : "Generation failed.");
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <Page
      title="Design"
      summary="Compile a design brief into a typed layout, canonical HCT palette, CSS roles, W3C tokens and React source."
      packages={["@aphrody/m3-design", "@aphrody/m3-tokens"]}
      panes={adaptive.panes}
      aside={
        result ? (
          <Card>
            <h3 className="text-title-medium">Parsed brief</h3>
            <Code>{JSON.stringify(result.brief, null, 2)}</Code>
          </Card>
        ) : undefined
      }
    >
      <Section
        title="Design brief"
        description={"The current theme seed is " + theme.seedColor + "."}
      >
        <Card className="flex flex-col gap-3">
          <label className="text-label-large" htmlFor="design-brief">
            Describe the interface
          </label>
          <textarea
            id="design-brief"
            maxLength={2000}
            className="min-h-32 rounded-medium border border-outline bg-surface p-3 text-body-large"
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
          />
          <Button
            onClick={() => {
              void compile();
            }}
            disabled={busy || !brief.trim()}
          >
            {busy ? "Generating…" : "Generate design"}
          </Button>
          <p role="status" className="text-body-medium text-on-surface-variant">
            {notice}
          </p>
        </Card>
      </Section>
      {result ? (
        <>
          <Section title="Primary tonal palette">
            <div className="grid grid-cols-3 gap-3 expanded:grid-cols-6">
              {Object.entries(result.theme.palettes.primary.tones).map(([tone, value]) => (
                <Swatch
                  key={tone}
                  name={"Tone " + tone}
                  value={value}
                  on={
                    Number(tone) > 50
                      ? result.theme.palettes.neutral.tones[10]
                      : result.theme.palettes.neutral.tones[99]
                  }
                />
              ))}
            </div>
          </Section>
          <Section
            title="Generated files"
            description="Source files are computed in memory and can be copied into a consumer project."
          >
            <Card>
              <label className="flex flex-col gap-2 text-label-large">
                File
                <select
                  className="h-12 rounded-small border border-outline bg-surface px-3"
                  value={file}
                  onChange={(event) => setFile(event.target.value)}
                >
                  {result.files.map((item) => (
                    <option key={item.path}>{item.path}</option>
                  ))}
                </select>
              </label>
              <Code>{result.files.find((item) => item.path === file)?.content}</Code>
              <Button
                variant="outlined"
                onClick={() => {
                  const content = result.files.find((item) => item.path === file)?.content ?? "";
                  if (!navigator.clipboard) {
                    setNotice("Clipboard access is unavailable.");
                    return;
                  }
                  void navigator.clipboard.writeText(content).then(
                    () => setNotice("Generated source copied."),
                    () => setNotice("Clipboard access is unavailable."),
                  );
                }}
              >
                Copy source
              </Button>
            </Card>
          </Section>
          <Section title="Compiler critique">
            <Card>
              <p className="text-body-large">{result.critique.rationale}</p>
              <Code>{JSON.stringify(result.critique.scores, null, 2)}</Code>
            </Card>
          </Section>
        </>
      ) : (
        <Card>
          <p className="text-body-large text-on-surface-variant">
            Generate the brief to inspect its palette and source files.
          </p>
        </Card>
      )}
    </Page>
  );
}
