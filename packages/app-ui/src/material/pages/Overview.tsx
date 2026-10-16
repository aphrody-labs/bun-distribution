import { useEffect, useState } from "react";
import { Card, Code, Page, Section, Svg, Chips } from "../ui.tsx";
import { PACKAGES } from "../inventory.ts";
import { DESTINATIONS } from "../nav.ts";
import type { PageProps } from "./index.ts";
import arrowIcon from "m3:icons/chevron_right";

interface Info {
  name: string;
  version: string;
  buildId: string;
  bun: string;
  files: number;
  api: string[];
}

function useInfo(enabled: boolean): { info?: Info; error?: string } {
  const [state, setState] = useState<{ info?: Info; error?: string }>({});
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch("/api/m3/info", { signal: controller.signal })
      .then((response) =>
        response.ok
          ? (response.json() as Promise<Info>)
          : Promise.reject(new Error(`HTTP ${response.status}`)),
      )
      .then((info) => setState({ info }))
      .catch(
        (error: Error) =>
          error.name !== "AbortError" && setState({ error: error.message }),
      );
    return () => controller.abort();
  }, [enabled]);
  return state;
}

export default function Overview({ adaptive, host = "bun" }: PageProps) {
  const { info, error } = useInfo(host === "bun");
  const inWorkspace = PACKAGES.filter((p) => p.workspace).length;
  const columns =
    adaptive.mode === "tv"
      ? "grid-cols-3"
      : adaptive.width === "compact"
        ? "grid-cols-1"
        : adaptive.width === "medium"
          ? "grid-cols-2"
          : "grid-cols-3";
  return (
    <Page
      title="Aphrody Material 3"
      summary={
        host === "native"
          ? "The real Material 3 packages, together in the Aphrody application. Explore components, forms, motion and the pet's generated theme."
          : "Every package of the aphrody-m3 monorepo in one adaptive app. It is built, served and compiled by @aphrody/m3-bun: the UI files and this page's API come from one Bun process."
      }
      packages={["@aphrody/m3", "@aphrody/m3-bun"]}
      panes={adaptive.panes}
      aside={
        host === "bun" ? (
          <Card>
            <h3 className="mb-2 text-title-medium">One process: UI and API</h3>
            <p className="mb-3 text-body-small text-on-surface-variant">
              This card is a live <code>GET /api/m3/info</code> from the process
              that served the page.
            </p>
            {info ? (
              <Code>{JSON.stringify(info, null, 2)}</Code>
            ) : (
              <output className="block text-body-small text-error">
                {error ? `API unreachable: ${error}` : "Loading…"}
              </output>
            )}
          </Card>
        ) : undefined
      }
    >
      <Section title="By the numbers">
        <div
          className="grid grid-cols-2 gap-3 expanded:grid-cols-4"
          data-testid="stats"
        >
          {[
            [String(PACKAGES.length), "packages and apps"],
            [String(inWorkspace), "in the Bun workspace"],
            [String(DESTINATIONS.length), "pages"],
            host === "native"
              ? [
                  String(PACKAGES.filter((entry) => !entry.private).length),
                  "reusable packages",
                ]
              : [info ? `Bun ${info.bun}` : "…", "serving this page"],
          ].map(([value, label]) => (
            <Card key={label}>
              <div className="text-headline-medium text-primary">{value}</div>
              <div className="text-body-small text-on-surface-variant">
                {label}
              </div>
            </Card>
          ))}
        </div>
      </Section>
      <Section
        title="Explore"
        description="Each page imports and runs the packages it names."
      >
        <div className={`grid gap-3 ${columns}`} data-testid="destinations">
          {DESTINATIONS.filter((d) => d.id !== "overview").map((d) => (
            <a
              key={d.id}
              href={host === "native" ? `/material-3/${d.id}` : `#/${d.id}`}
              data-dpad
              data-testid={`card-${d.id}`}
              className="state-layer flex flex-col gap-2 rounded-large bg-surface-container p-4 text-left"
            >
              <span className="flex items-center gap-2 text-title-medium text-on-surface">
                <Svg html={d.icon} className="text-primary" />
                {d.label}
                <Svg
                  html={arrowIcon}
                  className="ml-auto text-on-surface-variant"
                  small
                />
              </span>
              <span className="text-body-small text-on-surface-variant">
                {d.summary}
              </span>
              <Chips names={d.packages.slice(0, 3)} />
            </a>
          ))}
        </div>
      </Section>
    </Page>
  );
}
