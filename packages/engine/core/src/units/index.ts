// SPDX-License-Identifier: Apache-2.0
/**
 * Systemd unit catalog and renderer. One catalog (`catalog.json`) describes every user
 * service, its optional timer and drop-ins; units are rendered on demand, never hand-written
 * or committed by consumers.
 *
 * Entry shape: `{ name, kind?: "oneshot", unit, service, install?, timer? }`.
 *   - `Type=` comes from `kind` (default simple) and is emitted first in `[Service]`.
 *   - non-oneshot services get `[Install] WantedBy=default.target`; a oneshot only with `install`.
 *   - `timer` renders `<name>.timer` (`description`, any `[Timer]` keys; `Persistent=true`,
 *     `Unit=<name>.service` and `WantedBy=timers.target` are implied).
 *   - section keys starting with `#` render as comments; an array value repeats the key.
 */
import catalog from "./catalog.json" with { type: "json" };

export type Section = Record<string, string | string[]>;
export interface UnitEntry {
  name: string;
  kind?: "oneshot";
  unit: Section;
  service: Section;
  install?: Section;
  timer?: { description: string } & Section;
}
export interface DropIn {
  unit: string;
  name: string;
  comment?: string;
  service: Section;
}
export interface UnitCatalog {
  schemaVersion: 1;
  scope: "user";
  units: UnitEntry[];
  dropIns: DropIn[];
}
export interface RenderedUnit {
  file: string;
  text: string;
}

// JSON imports infer per-unit literal shapes; the catalog schema is the declared contract.
export const unitCatalog = catalog as unknown as UnitCatalog;

const HEADER =
  "# SPDX-License-Identifier: Apache-2.0\n# Generated from @aphrody/yolo-core units/catalog.json; edit the catalog, not this file.\n";

function section(title: string, body: Section): string {
  const lines = [`[${title}]`];
  for (const [k, v] of Object.entries(body)) {
    if (k.startsWith("#")) lines.push(`# ${v as string}`);
    else for (const x of Array.isArray(v) ? v : [v]) lines.push(`${k}=${x}`);
  }
  return lines.join("\n");
}

export function renderService(e: UnitEntry): RenderedUnit {
  const service: Section = { Type: e.kind ?? "simple", ...e.service };
  const install = e.install ?? (e.kind === "oneshot" ? undefined : { WantedBy: "default.target" });
  const parts = [
    section("Unit", e.unit),
    section("Service", service),
    ...(install ? [section("Install", install)] : []),
  ];
  return { file: `${e.name}.service`, text: `${HEADER}${parts.join("\n\n")}\n` };
}

export function renderTimer(e: UnitEntry): RenderedUnit | undefined {
  if (!e.timer) return undefined;
  const { description, ...keys } = e.timer;
  const text = [
    section("Unit", { Description: description }),
    section("Timer", { ...keys, Persistent: "true", Unit: `${e.name}.service` }),
    section("Install", { WantedBy: "timers.target" }),
  ].join("\n\n");
  return { file: `${e.name}.timer`, text: `${HEADER}${text}\n` };
}

export function renderDropIn(d: DropIn): RenderedUnit {
  const comment = d.comment ? `# ${d.comment}\n` : "";
  return {
    file: `${d.unit}.d/${d.name}`,
    text: `${HEADER}${comment}${section("Service", d.service)}\n`,
  };
}

/** Every rendered unit file (services, timers, drop-ins), sorted by file name. */
export function renderAll(cat: UnitCatalog = unitCatalog): RenderedUnit[] {
  const out = cat.units.flatMap((e) =>
    [renderService(e), renderTimer(e)].filter((x): x is RenderedUnit => !!x),
  );
  out.push(...cat.dropIns.map(renderDropIn));
  return out.toSorted((a, b) => a.file.localeCompare(b.file));
}

/** Unit file names only (no drop-ins), for install and drift listings. */
export const unitFiles = (cat: UnitCatalog = unitCatalog): string[] =>
  renderAll(cat)
    .filter((u) => !u.file.includes("/"))
    .map((u) => u.file);
