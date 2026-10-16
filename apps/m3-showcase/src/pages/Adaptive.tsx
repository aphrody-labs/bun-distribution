import { BREAKPOINTS, HEIGHT_BREAKPOINTS, marginFor, navigationFor, panesFor, WINDOW_SIZE_CLASSES } from "@aphrody/m3-tokens/breakpoints";
import { useEffect, useRef, useState } from "react";
import { attachDpad } from "../adaptive/dpad.ts";
import { LAYOUT_MODES, setLayoutOverride, type LayoutMode } from "../adaptive/window.ts";
import { Card, Page, Section } from "../components/ui.tsx";
import type { PageProps } from "./index.ts";

const FRAMES: ReadonlyArray<{ mode: LayoutMode; width: number; height: number; label: string }> = [
  { mode: "mobile", width: 390, height: 844, label: "Mobile · 390 × 844" },
  { mode: "desktop", width: 1280, height: 800, label: "Desktop · 1280 × 800" },
  { mode: "tv", width: 1920, height: 1080, label: "TV · 1920 × 1080" },
];

function Frame({ mode, width, height, label, scale }: { mode: LayoutMode; width: number; height: number; label: string; scale: number }) {
  return (
    <figure className="flex flex-col gap-2" data-testid={`frame-${mode}`}>
      <div className="overflow-hidden rounded-large border border-outline-variant" style={{ width: width * scale, height: height * scale }}>
        <iframe title={`${label} preview`} src={`${location.pathname}?layout=${mode}#/overview`} loading="lazy" className="origin-top-left border-0" style={{ width, height, transform: `scale(${scale})` }} />
      </div>
      <figcaption className="text-label-medium text-on-surface-variant">{label}</figcaption>
    </figure>
  );
}

export default function Adaptive({ adaptive: a }: PageProps) {
  const [dpad, setDpad] = useState(false);
  const [focused, setFocused] = useState("none");
  const grid = useRef<HTMLDivElement>(null);
  const framed = window.self !== window.top;

  useEffect(() => {
    if (!dpad || a.mode === "tv") return;
    document.documentElement.dataset["dpad"] = "on";
    const detach = attachDpad({ onBack: () => history.back() });
    return () => {
      detach();
      delete document.documentElement.dataset["dpad"];
    };
  }, [dpad, a.mode]);

  return (
    <Page title="Adaptive" summary="One app, three layouts. The window size class (M3 breakpoints at 600, 840, 1200 and 1600 dp) picks the navigation and the panes; the TV layout adds a 10-foot type scale and D-pad focus navigation." packages={["@aphrody/m3-tokens", "@aphrody/m3-front"]} panes={a.panes}>
      <Section title="This window" description="Live from @aphrody/m3-front (observeWindowClass) and @aphrody/m3-tokens.">
        <dl className="grid grid-cols-2 gap-3 expanded:grid-cols-4" data-testid="window-state">
          {[
            ["Width class", `${a.width} (${a.widthPx} px)`],
            ["Height class", `${a.height} (${a.heightPx} px)`],
            ["Navigation", a.navigation],
            ["Panes", String(a.panes)],
            ["Layout mode", `${a.mode} (${a.source})`],
            ["Margin", `${marginFor(a.width)} dp`],
            ["Orientation", a.landscape ? "landscape" : "portrait"],
            ["Pointer", a.touch ? "coarse (touch)" : "fine"],
          ].map(([term, value]) => (
            <Card key={term}>
              <dt className="text-label-medium text-on-surface-variant">{term}</dt>
              <dd className="text-title-medium text-on-surface">{value}</dd>
            </Card>
          ))}
        </dl>
      </Section>

      <Section title="Layout mode" description="TV is chosen by user agent (Tizen, webOS, Android TV, Fire TV, Chromecast, consoles), by ?layout=tv, or here.">
        <div role="radiogroup" aria-label="Layout mode" className="inline-flex flex-wrap gap-2">
          {[...LAYOUT_MODES, null].map((mode) => (
            <button key={mode ?? "auto"} type="button" role="radio" aria-checked={(mode ?? "auto") === (a.source === "override" ? a.mode : "auto")} data-dpad data-testid={`layout-${mode ?? "auto"}`} className={`state-layer rounded-full border px-4 py-2 text-label-large ${(mode ?? "auto") === (a.source === "override" ? a.mode : "auto") ? "border-transparent bg-secondary-container text-on-secondary-container" : "border-outline text-on-surface-variant"}`} onClick={() => setLayoutOverride(mode)}>
              {mode ?? "auto"}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Window size classes" description="Lower bounds in dp from @aphrody/m3-tokens/breakpoints; navigation and panes per class.">
        <div className="m3-scroll overflow-x-auto rounded-large bg-surface-container">
          <table className="w-full text-left text-body-medium" data-testid="breakpoints">
            <thead className="text-label-large text-on-surface-variant">
              <tr>
                <th className="p-3">Class</th>
                <th className="p-3">From</th>
                <th className="p-3">Navigation</th>
                <th className="p-3">Panes</th>
                <th className="p-3">Margin</th>
              </tr>
            </thead>
            <tbody>
              {WINDOW_SIZE_CLASSES.map((c) => (
                <tr key={c} className={c === a.width ? "bg-secondary-container text-on-secondary-container" : ""} aria-current={c === a.width ? "true" : undefined}>
                  <td className="p-3 font-medium">{c}</td>
                  <td className="p-3">{BREAKPOINTS[c]} dp</td>
                  <td className="p-3">{navigationFor(c)}</td>
                  <td className="p-3">{panesFor(c)}</td>
                  <td className="p-3">{marginFor(c)} dp</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-body-small text-on-surface-variant">Height classes: compact &lt; {HEIGHT_BREAKPOINTS.medium}, medium &lt; {HEIGHT_BREAKPOINTS.expanded}, expanded from {HEIGHT_BREAKPOINTS.expanded} dp.</p>
      </Section>

      <Section title="D-pad lab" description="Arrow keys move focus to the nearest control in that direction, Enter activates, Back (Escape, Backspace, TV Back keys) leaves. It is always on in the TV layout; switch it on here to try it with a keyboard.">
        <div className="flex items-center gap-3">
          <button type="button" role="switch" aria-checked={dpad || a.mode === "tv"} data-dpad data-testid="dpad-toggle" disabled={a.mode === "tv"} className="state-layer rounded-full border border-outline px-4 py-2 text-label-large" onClick={() => setDpad((v) => !v)}>
            D-pad navigation: {dpad || a.mode === "tv" ? "on" : "off"}
          </button>
          <span className="text-body-medium text-on-surface-variant" data-testid="dpad-focus">Focused: {focused}</span>
        </div>
        <div ref={grid} className="grid grid-cols-3 gap-3 expanded:grid-cols-6" onFocusCapture={(event) => setFocused((event.target as HTMLElement).dataset["tile"] ?? "none")}>
          {Array.from({ length: 12 }, (_, i) => (
            <button key={i} type="button" data-dpad data-tile={`tile ${i + 1}`} className="state-layer flex h-24 items-center justify-center rounded-large bg-surface-container-high text-title-medium text-on-surface" onClick={() => setFocused(`tile ${i + 1} (activated)`)}>
              {i + 1}
            </button>
          ))}
        </div>
      </Section>

      {framed ? null : (
        <Section title="Three layouts, side by side" description="The same app in three frames: the iframes load this page with ?layout=mobile, desktop and tv.">
          <div className="flex flex-wrap items-start gap-6" data-testid="frames">
            {FRAMES.map((f) => (
              <Frame key={f.mode} {...f} scale={f.mode === "mobile" ? 0.6 : f.mode === "desktop" ? 0.4 : 0.3} />
            ))}
          </div>
        </Section>
      )}
    </Page>
  );
}
