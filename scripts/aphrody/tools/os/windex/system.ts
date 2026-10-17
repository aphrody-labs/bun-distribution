// SPDX-License-Identifier: Apache-2.0
// System metadata feeding the graph: the ApiSet schema (apisetschema.dll `.apiset` section) and the service/driver
// registry (HKLM\SYSTEM\CurrentControlSet\Services through advapi32, read-only: KEY_READ, never written).
import type { SQL } from "bun";
import { readFileSync } from "node:fs";
import { pathKey } from "./config.ts";
import { memorySource, parseApiSetSchema, parsePe } from "./pe.ts";
import { advapi, isWindows, readWstr, wstr } from "./win32.ts";

const HKEY_LOCAL_MACHINE = 0xffff_ffff_8000_0002n;
const KEY_READ = 0x2_0019;
const ERROR_SUCCESS = 0;
const ERROR_MORE_DATA = 234;
const ERROR_NO_MORE_ITEMS = 259;
const REG_SZ = 1;
const REG_EXPAND_SZ = 2;
const REG_DWORD = 4;
const REG_MULTI_SZ = 7;

/** Reads the ApiSet contracts of `apisetschema.dll` (contract -> hosts). */
export function readApiSet(windir = "C:\\Windows"): Map<string, string[]> {
  const file = `${windir}\\System32\\apisetschema.dll`;
  const bytes = new Uint8Array(readFileSync(file));
  const pe = parsePe(memorySource(bytes), "apisetschema.dll");
  const section = pe?.sections.find(s => s.name === ".apiset");
  if (!section) throw new Error(`section .apiset absente de ${file}`);
  return parseApiSetSchema(bytes.subarray(section.rawOffset, section.rawOffset + section.rawSize));
}

export async function loadApiSet(sql: SQL, windir = "C:\\Windows"): Promise<number> {
  const map = readApiSet(windir);
  const rows = [...map].map(([contract, hosts]) => ({ contract, hosts }));
  await sql.begin(async tx => {
    await tx`DELETE FROM windex.apiset`;
    await tx.unsafe(
      `INSERT INTO windex.apiset (contract, hosts)
       SELECT contract, hosts FROM jsonb_to_recordset($1::jsonb) AS r(contract text, hosts text[])`,
      [rows],
    );
  });
  return rows.length;
}

type RegValue = string | number | string[] | null;

class RegKey {
  private constructor(readonly hkey: bigint) {}

  static open(parent: bigint, path: string): RegKey | null {
    const out = new BigUint64Array(1);
    const rc = advapi().RegOpenKeyExW(parent, wstr(path), 0, KEY_READ, out);
    return rc === ERROR_SUCCESS ? new RegKey(out[0]!) : null;
  }

  close(): void {
    advapi().RegCloseKey(this.hkey);
  }

  subkeys(): string[] {
    const names: string[] = [];
    const buf = new Uint8Array(512);
    const len = new Uint32Array(1);
    for (let i = 0; ; i++) {
      len[0] = 256;
      const rc = advapi().RegEnumKeyExW(this.hkey, i, buf, len, null, null, null, null);
      if (rc === ERROR_NO_MORE_ITEMS) break;
      if (rc !== ERROR_SUCCESS) continue;
      names.push(readWstr(buf, 0, len[0]!));
    }
    return names;
  }

  value(name: string): RegValue {
    const type = new Uint32Array(1);
    const size = new Uint32Array(1);
    let buf = new Uint8Array(1024);
    for (let attempt = 0; attempt < 4; attempt++) {
      size[0] = buf.byteLength;
      const rc = advapi().RegQueryValueExW(this.hkey, wstr(name), null, type, buf, size);
      if (rc === ERROR_MORE_DATA) {
        buf = new Uint8Array(size[0]! + 16);
        continue;
      }
      if (rc !== ERROR_SUCCESS) return null;
      const data = buf.subarray(0, size[0]!);
      switch (type[0]) {
        case REG_SZ:
        case REG_EXPAND_SZ:
          return readWstr(data, 0, data.byteLength / 2);
        case REG_DWORD:
          return data.byteLength >= 4 ? new DataView(data.buffer, data.byteOffset).getUint32(0, true) : null;
        case REG_MULTI_SZ:
          return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
            .toString("utf16le")
            .split("\0")
            .filter(Boolean);
        default:
          return null;
      }
    }
    return null;
  }
}

const START_MODES = ["boot", "system", "auto", "demand", "disabled"];

export function serviceKind(type: number | null): string {
  if (type === null) return "unknown";
  if (type & 0x1) return "kernel-driver";
  if (type & 0x2) return "fs-driver";
  if (type & 0x4) return "adapter";
  if (type & 0x8) return "recognizer-driver";
  if (type & 0x40 || type & 0x80) return "user-service";
  if (type & 0x20) return "share-process";
  if (type & 0x10) return "own-process";
  return "unknown";
}

/**
 * Resolves a registry ImagePath/ServiceDll to an absolute file path: strips quotes and arguments, expands
 * `%SystemRoot%`/`%windir%`/`%ProgramFiles%`, `\SystemRoot\`, `\??\` and the System32-relative driver form.
 */
export function resolveImagePath(raw: string | null, windir = "C:\\Windows"): string | null {
  if (!raw) return null;
  let p = raw.trim();
  if (p.startsWith('"')) {
    const end = p.indexOf('"', 1);
    p = end > 0 ? p.slice(1, end) : p.slice(1);
  } else {
    const m = /^(.*?\.(?:exe|sys|dll|com))(?:\s|$)/i.exec(p);
    if (m) p = m[1]!;
  }
  const env: Record<string, string> = {
    systemroot: windir,
    windir,
    programfiles: "C:\\Program Files",
    "programfiles(x86)": "C:\\Program Files (x86)",
    programdata: "C:\\ProgramData",
    systemdrive: "C:",
  };
  p = p.replace(/%([^%]+)%/g, (all, name: string) => env[name.toLowerCase()] ?? all);
  p = p.replace(/^\\\?\?\\/, "");
  if (/^\\systemroot\\/i.test(p)) p = `${windir}${p.slice("\\SystemRoot".length)}`;
  if (/^system32\\/i.test(p) || /^syswow64\\/i.test(p)) p = `${windir}\\${p}`;
  if (!/^[a-z]:\\/i.test(p)) return null;
  return p;
}

export type ServiceRow = {
  name: string;
  display_name: string | null;
  description: string | null;
  type: number | null;
  kind: string;
  start: number | null;
  start_mode: string | null;
  error_control: number | null;
  grp: string | null;
  image_path: string | null;
  image_lc: string | null;
  service_dll: string | null;
  service_dll_lc: string | null;
  object_name: string | null;
  depend_on_service: string[];
  depend_on_group: string[];
};

const str = (v: RegValue) => (typeof v === "string" ? v : null);
const num = (v: RegValue) => (typeof v === "number" ? v : null);
const list = (v: RegValue) => (Array.isArray(v) ? v : typeof v === "string" && v ? [v] : []);

/** Reads every service and driver key; indirect strings (`@dll,-id`) are kept as stored. */
export function readServices(windir = "C:\\Windows"): ServiceRow[] {
  if (!isWindows) return [];
  const root = RegKey.open(HKEY_LOCAL_MACHINE, "SYSTEM\\CurrentControlSet\\Services");
  if (!root) throw new Error("clé HKLM\\SYSTEM\\CurrentControlSet\\Services illisible");
  const out: ServiceRow[] = [];
  try {
    for (const name of root.subkeys()) {
      const key = RegKey.open(root.hkey, name);
      if (!key) continue;
      try {
        const type = num(key.value("Type"));
        // Keys without a Type are configuration containers (event log sources, parameters), not services.
        if (type === null) continue;
        let serviceDll: string | null = null;
        const params = RegKey.open(key.hkey, "Parameters");
        if (params) {
          serviceDll = str(params.value("ServiceDll"));
          params.close();
        }
        serviceDll ??= str(key.value("ServiceDll"));
        const image = str(key.value("ImagePath"));
        const imageAbs =
          resolveImagePath(image, windir) ?? (type & 0x3 ? `${windir}\\System32\\drivers\\${name}.sys` : null);
        const dllAbs = resolveImagePath(serviceDll, windir);
        const start = num(key.value("Start"));
        out.push({
          name,
          display_name: str(key.value("DisplayName")),
          description: str(key.value("Description")),
          type,
          kind: serviceKind(type),
          start,
          start_mode: start === null ? null : (START_MODES[start] ?? String(start)),
          error_control: num(key.value("ErrorControl")),
          grp: str(key.value("Group")),
          image_path: image,
          image_lc: imageAbs ? pathKey(imageAbs) : null,
          service_dll: serviceDll,
          service_dll_lc: dllAbs ? pathKey(dllAbs) : null,
          object_name: str(key.value("ObjectName")),
          depend_on_service: list(key.value("DependOnService")),
          depend_on_group: list(key.value("DependOnGroup")),
        });
      } finally {
        key.close();
      }
    }
  } finally {
    root.close();
  }
  return out;
}

/** Replaces the service table (ids of surviving names are kept) and recomputes the service/driver edges. */
export async function loadServices(sql: SQL, windir = "C:\\Windows"): Promise<number> {
  const rows = readServices(windir);
  await sql.begin(async tx => {
    await tx.unsafe(
      `INSERT INTO windex.service AS s (name, display_name, description, type, kind, start, start_mode,
         error_control, grp, image_path, image_lc, service_dll, service_dll_lc, object_name, depend_on_service,
         depend_on_group, seen_at)
       SELECT r.name, r.display_name, r.description, r.type, r.kind, r.start, r.start_mode, r.error_control, r.grp,
         r.image_path, r.image_lc, r.service_dll, r.service_dll_lc, r.object_name,
         COALESCE(r.depend_on_service, '{}'), COALESCE(r.depend_on_group, '{}'), now()
       FROM jsonb_to_recordset($1::jsonb) AS r(name text, display_name text, description text, type integer,
         kind text, start integer, start_mode text, error_control integer, grp text, image_path text,
         image_lc text, service_dll text, service_dll_lc text, object_name text, depend_on_service text[],
         depend_on_group text[])
       ON CONFLICT (name) DO UPDATE SET display_name = excluded.display_name, description = excluded.description,
         type = excluded.type, kind = excluded.kind, start = excluded.start, start_mode = excluded.start_mode,
         error_control = excluded.error_control, grp = excluded.grp, image_path = excluded.image_path,
         image_lc = excluded.image_lc, service_dll = excluded.service_dll,
         service_dll_lc = excluded.service_dll_lc, object_name = excluded.object_name,
         depend_on_service = excluded.depend_on_service, depend_on_group = excluded.depend_on_group,
         seen_at = now()`,
      [rows],
    );
    const gone = await tx`DELETE FROM windex.service WHERE seen_at < now() RETURNING id`;
    if (gone.length) {
      const ids = `{${gone.map((r: { id: string }) => r.id).join(",")}}`;
      await tx.unsafe(`DELETE FROM windex.edge WHERE src = ANY($1::bigint[]) OR dst = ANY($1::bigint[])`, [ids]);
    }
    await tx`SELECT windex.refresh_service_edges()`;
  });
  return rows.length;
}
