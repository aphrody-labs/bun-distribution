// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from "react";
import { useM3Theme } from "@aphrody/m3-theme/react";
import { Button } from "@aphrody/m3-primitives";
import { Card, Code, Page, Section } from "../ui.tsx";
import type { PageProps } from "./index.ts";

interface ThemeFile {
  target: string;
  path: string;
  bytes: number;
  binary: boolean;
}
interface SystemOutput {
  themeFiles: ThemeFile[];
  templates: { name: string; summary: string }[];
  scaffold: Record<string, string>;
  mcpTools: { name: string; description?: string }[];
  lintRules: { name: string; description: string }[];
  migration: { source: string; diagnostics: string[] };
}
const sample =
  'import { Button } from "@mui/material";\nexport default () => <Button variant="contained">Save</Button>;';
export default function System({ adaptive }: PageProps) {
  const { seedColor } = useM3Theme();
  const [target, setTarget] = useState("all");
  const [data, setData] = useState<SystemOutput | null>(null);
  const [path, setPath] = useState("");
  const [content, setContent] = useState("");
  const [scaffoldFile, setScaffoldFile] = useState("m3.config.ts");
  const [notice, setNotice] = useState("");
  const [source, setSource] = useState(sample);
  const [migration, setMigration] = useState<SystemOutput["migration"] | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  const query =
    "seed=" +
    encodeURIComponent(seedColor) +
    "&target=" +
    encodeURIComponent(target);
  useEffect(() => {
    const controller = new AbortController();
    // oxlint-disable-next-line react/set-state-in-effect -- réinitialise le message de chargement à chaque changement de requête (graine ou cible)
    setNotice("Computing local system outputs…");
    void fetch("/api/system?" + query, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok)
          throw new Error(payload.error ?? "System outputs are unavailable.");
        if (!controller.signal.aborted) {
          const result = payload as SystemOutput;
          setData(result);
          setMigration(result.migration);
          setPath((current) =>
            result.themeFiles.some((file) => file.path === current)
              ? current
              : (result.themeFiles.find((file) => !file.binary)?.path ?? ""),
          );
          setNotice("Generated files are ready to inspect.");
        }
        return payload;
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setNotice(
            error instanceof Error
              ? error.message
              : "System outputs are unavailable.",
          );
      });
    return () => controller.abort();
  }, [query]);
  const selected = data?.themeFiles.find((file) => file.path === path);
  useEffect(() => {
    if (!path || selected?.binary) {
      // oxlint-disable-next-line react/set-state-in-effect -- vide l'aperçu quand aucun fichier texte n'est sélectionné (réaction au changement de sélection)
      setContent("");
      return;
    }
    const controller = new AbortController();
    setContent("");
    void fetch("/api/os-theme?" + query + "&path=" + encodeURIComponent(path), {
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok)
          throw new Error(payload.error ?? "Theme file is unavailable.");
        if (!controller.signal.aborted) setContent(payload.content);
        return payload;
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setNotice(
            error instanceof Error
              ? error.message
              : "Theme file is unavailable.",
          );
      });
    return () => controller.abort();
  }, [path, query, selected?.binary]);
  async function migrate() {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    try {
      const response = await fetch("/api/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, kind: "mui" }),
        signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Migration failed.");
      if (!controller.signal.aborted) {
        setMigration(payload);
        setNotice("Source transformed in memory.");
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setNotice(error instanceof Error ? error.message : "Migration failed.");
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <Page
      title="System"
      summary="Generate OS themes and scaffolds, discover design MCP tools, inspect lint rules and run a source migration in memory."
      packages={[
        "@aphrody/m3-os-themes",
        "@aphrody/scaffold",
        "@aphrody/m3-mcp",
        "@aphrody/m3-codemods",
        "@aphrody/eslint-plugin-m3",
      ]}
      panes={adaptive.panes}
      aside={
        data ? (
          <Card>
            <h3 className="text-title-medium">Local capabilities</h3>
            <Code>
              {JSON.stringify(
                {
                  themeFiles: data.themeFiles.length,
                  tools: data.mcpTools.length,
                  rules: data.lintRules.length,
                  seed: seedColor,
                },
                null,
                2,
              )}
            </Code>
          </Card>
        ) : undefined
      }
    >
      <output className="block text-body-medium text-on-surface-variant">
        {notice}
      </output>
      <Section
        title="OS theme artifacts"
        description="Inspect generated files before applying them through their native installer."
      >
        <Card className="flex flex-col gap-3">
          <label className="flex flex-col gap-2 text-label-large">
            Target
            <select
              className="h-12 rounded-small border border-outline bg-surface px-3"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            >
              {["all", "windows", "gnome", "cosmic", "chromium"].map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>
          {data ? (
            <>
              <label className="flex flex-col gap-2 text-label-large">
                Generated file
                <select
                  className="h-12 rounded-small border border-outline bg-surface px-3"
                  value={path}
                  onChange={(event) => setPath(event.target.value)}
                >
                  {data.themeFiles.map((file) => (
                    <option key={file.path} value={file.path}>
                      {file.path} · {file.bytes} B
                    </option>
                  ))}
                </select>
              </label>
              {selected?.binary ? (
                <img
                  src={
                    "/api/os-theme?" +
                    query +
                    "&path=" +
                    encodeURIComponent(path)
                  }
                  width={256}
                  height={144}
                  className="rounded-medium"
                  alt="Wallpaper generated from the current Material 3 theme"
                />
              ) : (
                <Code>{content || "Loading generated file…"}</Code>
              )}
            </>
          ) : null}
        </Card>
      </Section>
      {data ? (
        <>
          <Section
            title="Project scaffold"
            description="The public renderTemplate export produces this Bun and M3 web project without writing files."
          >
            <Card>
              <label className="flex flex-col gap-2 text-label-large">
                Scaffold file
                <select
                  className="h-12 rounded-small border border-outline bg-surface px-3"
                  value={scaffoldFile}
                  onChange={(event) => setScaffoldFile(event.target.value)}
                >
                  {Object.keys(data.scaffold).map((file) => (
                    <option key={file}>{file}</option>
                  ))}
                </select>
              </label>
              <Code>{data.scaffold[scaffoldFile]}</Code>
            </Card>
          </Section>
          <Section
            title="MCP tool discovery"
            description="These schemas are returned by the design server's real MCP discovery protocol."
          >
            <div className="grid gap-3 expanded:grid-cols-2">
              {data.mcpTools.map((tool) => (
                <Card key={tool.name}>
                  <h3 className="text-title-medium">{tool.name}</h3>
                  <p className="text-body-medium text-on-surface-variant">
                    {tool.description}
                  </p>
                </Card>
              ))}
            </div>
          </Section>
          <Section title="M3 lint rules">
            <div className="grid gap-3 expanded:grid-cols-2">
              {data.lintRules.map((rule) => (
                <Card key={rule.name}>
                  <h3 className="text-title-medium">{rule.name}</h3>
                  <p className="text-body-medium text-on-surface-variant">
                    {rule.description}
                  </p>
                </Card>
              ))}
            </div>
          </Section>
        </>
      ) : null}
      <Section
        title="MUI source migration"
        description="A labelled source fixture exercises the actual codemod. Unsupported semantics produce explicit migration diagnostics."
      >
        <Card className="flex flex-col gap-3">
          <label htmlFor="migration-source" className="text-label-large">
            TSX source
          </label>
          <textarea
            id="migration-source"
            maxLength={40000}
            rows={6}
            className="rounded-medium border border-outline bg-surface p-3 font-code text-body-small"
            value={source}
            onChange={(event) => setSource(event.target.value)}
          />
          <Button
            disabled={busy || !source.trim()}
            onClick={() => {
              void migrate();
            }}
          >
            {busy ? "Transforming…" : "Transform source"}
          </Button>
          {migration ? (
            <>
              <Code>{migration.source}</Code>
              <p className="text-body-medium text-on-surface-variant">
                {migration.diagnostics.length
                  ? migration.diagnostics.join("\n")
                  : "This fixture migrated without manual decisions."}
              </p>
            </>
          ) : null}
        </Card>
      </Section>
    </Page>
  );
}
