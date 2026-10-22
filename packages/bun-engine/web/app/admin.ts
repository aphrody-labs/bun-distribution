// Administration screens reached from Settings: BIOS, the bep installer and library sources.
import { api, focusFirst, formatSize, h, markTab, setHints, state, view } from "./core";
import type { SystemRow } from "./core";

export async function showBios(): Promise<void> {
  state.tab = "bios";
  const bios = await api<{
    native: Array<{
      system: string;
      machine: string;
      console: string;
      required: boolean;
      freeFirmware: string;
      license?: string;
      status: string;
      images: Array<{ sha256: string; bytes: number }>;
    }>;
    libretro: Array<{
      core: string;
      file: string;
      desc: string;
      optional: boolean;
      md5?: string;
      status: string;
    }>;
    freeFirmware: Array<{
      id: string;
      console: string;
      file: string;
      license: string;
    }>;
    store: Array<{
      console: string;
      sha256: string;
      bytes: number;
      file: string;
    }>;
  }>("/api/bios");
  const cores = new Map<string, typeof bios.libretro>();
  for (const row of bios.libretro) cores.set(row.core, [...(cores.get(row.core) ?? []), row]);
  view.innerHTML = `
    <section class="page">
      <h1>BIOS</h1>
      <p class="lead">Native machines boot open-source firmware from the bep store; RetroArch cores are checked by MD5 like Recalbox does. Proprietary dumps stay user-supplied (<code>bep add firmware &lt;console&gt; &lt;dump&gt;</code>).</p>
      <h2>Native machines</h2>
      <div class="cards">
        ${bios.native
          .map(
            row => `<div class="card">
              <div class="row"><strong>${h(row.system.toUpperCase())}</strong><span class="badge ${row.status}">${h(row.status)}</span></div>
              <div class="muted">${h(row.console)} · ${row.required ? "required" : "optional"}</div>
              ${row.images.map(image => `<div class="mono small">${image.sha256.slice(0, 16)}… ${formatSize(image.bytes)}</div>`).join("")}
              <button data-nav data-install="free-firmware" data-id="${h(row.freeFirmware)}">${row.images.length ? "Reinstall" : "Install"} ${h(row.freeFirmware)}</button>
              <div class="muted small">${h(row.license ?? "")}</div>
            </div>`,
          )
          .join("")}
      </div>
      <h2>Free firmware</h2>
      <table><tbody>
        ${bios.freeFirmware
          .map(
            fw => `<tr><td><strong>${h(fw.id)}</strong></td><td>${h(fw.console)}</td><td class="muted">${h(fw.license)}</td>
              <td><button data-nav data-install="free-firmware" data-id="${h(fw.id)}">Install</button></td></tr>`,
          )
          .join("")}
      </tbody></table>
      <h2>RetroArch cores</h2>
      ${
        cores.size
          ? [...cores]
              .map(
                ([core, rows]) =>
                  `<h3>${h(core)}</h3><table><tbody>${rows
                    .map(
                      row => `<tr><td class="mono">${h(row.file)}</td><td>${h(row.desc)}</td><td class="mono small">${h(row.md5 ?? "")}</td>
                      <td><span class="badge ${row.status}${row.optional ? " optional" : ""}">${h(row.status)}${row.optional ? " (optional)" : ""}</span></td></tr>`,
                    )
                    .join("")}</tbody></table>`,
              )
              .join("")
          : '<p class="muted">No installed core declares BIOS files.</p>'
      }
      <h2>Firmware store</h2>
      <table><tbody>${bios.store.map(image => `<tr><td>${h(image.console)}</td><td class="mono">${h(image.file)}</td><td>${formatSize(image.bytes)}</td></tr>`).join("")}</tbody></table>
    </section>`;
  setHints([
    ["move", "Move"],
    ["select", "Install"],
    ["back", "Settings"],
  ]);
  markTab();
  focusFirst("main [data-nav]");
}

export async function showInstaller(): Promise<void> {
  state.tab = "installer";
  const data = await api<{
    project: string;
    binaries: Array<{
      id: string;
      console: string;
      repo: string;
      systems: string[];
      installed: { version: string } | null;
    }>;
    libretro: Array<{
      id: string;
      name: string;
      systems: string[];
      license: string;
      installed: boolean;
    }>;
    mirrors: Array<{
      service: string;
      endpoints: number;
      healthy: number;
      best?: string;
      latencyMs?: number | null;
    }>;
  }>("/api/installer");
  view.innerHTML = `
    <section class="page">
      <h1>Installer</h1>
      <p class="lead">bep project <code>${h(data.project)}</code>. Release emulators install into <code>usr/lib</code> with launchers in <code>usr/bin</code>; libretro cores into <code>usr/lib/libretro</code>.</p>
      <div class="toolbar">
        <button data-nav data-install="install">bep install</button>
        <button data-nav data-install="update">bep update</button>
        <button data-nav data-install="mirrors-index">Index mirrors</button>
        <button data-nav data-install="mirrors-probe">Probe mirrors</button>
      </div>
      <h2>Release emulators</h2>
      <table><tbody>
        ${data.binaries
          .map(
            bin => `<tr><td><strong>${h(bin.id)}</strong><div class="muted small">${h(bin.repo)}</div></td>
              <td>${bin.systems.map(id => `<span class="chip">${h(id)}</span>`).join("")}</td>
              <td>${bin.installed ? `<span class="badge present">${h(bin.installed.version)}</span>` : '<span class="badge missing">not installed</span>'}</td>
              <td class="buttons"><button data-nav data-install="bin" data-id="${h(bin.id)}">${bin.installed ? "Reinstall" : "Install"}</button>
              <button data-nav data-install="update" data-id="${h(bin.id)}">Update</button>
              <button data-nav data-install="remove" data-id="${h(bin.id)}" class="danger">Remove</button></td></tr>`,
          )
          .join("")}
      </tbody></table>
      <h2>libretro cores</h2>
      <table><tbody>
        ${data.libretro
          .map(
            core => `<tr><td><strong>${h(core.id)}</strong><div class="muted small">${h(core.name)} · ${h(core.license)}</div></td>
              <td>${core.systems.map(id => `<span class="chip">${h(id)}</span>`).join("")}</td>
              <td>${core.installed ? '<span class="badge present">installed</span>' : '<span class="badge missing">not installed</span>'}</td>
              <td class="buttons"><button data-nav data-install="libretro" data-id="${h(core.id)}">${core.installed ? "Reinstall" : "Install"}</button>
              <button data-nav data-install="remove" data-id="${h(core.id)}" class="danger">Remove</button></td></tr>`,
          )
          .join("")}
      </tbody></table>
      <h2>Mirrors</h2>
      ${
        data.mirrors.length
          ? `<table><tbody>${data.mirrors
              .map(
                row => `<tr><td><strong>${h(row.service)}</strong></td><td>${row.healthy}/${row.endpoints} healthy</td>
                  <td class="mono small">${h(row.best ?? "")}</td><td>${row.latencyMs == null ? "" : `${row.latencyMs} ms`}</td></tr>`,
              )
              .join("")}</tbody></table>`
          : '<p class="muted">No mirror index yet: run Index mirrors.</p>'
      }
      <h2>Jobs</h2>
      <div id="jobs">${jobsHtml()}</div>
    </section>`;
  setHints([
    ["move", "Move"],
    ["select", "Run"],
    ["back", "Settings"],
  ]);
  markTab();
  focusFirst(".toolbar [data-nav]");
}

export function jobsHtml(): string {
  if (!state.jobs.length) return '<p class="muted">No jobs yet.</p>';
  return `<table><tbody>${state.jobs
    .map(
      job => `<tr><td>#${job.id}</td><td>${h(job.title)}</td><td><span class="badge ${job.status === "done" ? "present" : job.status === "failed" ? "missing" : "running"}">${job.status}</span></td>
        <td class="mono small">${h(job.error ?? (job.result === undefined ? "" : JSON.stringify(job.result).slice(0, 160)))}</td></tr>`,
    )
    .join("")}</tbody></table>`;
}

export async function showSources(): Promise<void> {
  state.tab = "sources";
  const sources =
    await api<Array<{ id: number; kind: string; path: string; system: string | null }>>("/api/library/sources");
  if (!state.systems.length) state.systems = await api<SystemRow[]>("/api/systems");
  const describe = (source: { kind: string; path: string }) =>
    source.kind === "bep"
      ? "bep project (package.json bunEngine + bep.lock)"
      : source.kind === "store"
        ? "content-addressed ROM store"
        : source.kind === "free"
          ? "free ROM packs (bep roms)"
          : source.path;
  view.innerHTML = `
    <section class="page">
      <h1>Sources</h1>
      <p class="lead">Folders are scanned recursively. Without a system, files are assigned by a <code>&lt;system&gt;/</code> directory (Recalbox layout) or an unambiguous extension.</p>
      <table><tbody>
        ${sources
          .map(
            source => `<tr><td><span class="chip">${h(source.kind)}</span></td><td>${h(describe(source))}</td><td>${h(source.system ?? "")}</td>
              <td><button data-nav data-remove-source="${source.id}" class="danger">Remove</button></td></tr>`,
          )
          .join("")}
      </tbody></table>
      <h2>Add folder</h2>
      <form class="add" id="add">
        <input data-nav name="path" placeholder="C:\\Games\\roms" autocomplete="off" />
        <select data-nav name="system"><option value="">auto-detect</option>${state.systems.map(s => `<option value="${h(s.id)}">${h(s.name)}</option>`).join("")}</select>
        <button data-nav type="submit">Add</button>
      </form>
      <div class="toolbar"><button data-nav data-action="scan" class="primary">Rescan library</button></div>
    </section>`;
  setHints([
    ["move", "Move"],
    ["select", "Select"],
    ["back", "Settings"],
  ]);
  markTab();
  focusFirst("[data-action=scan]");
}
