// SPDX-License-Identifier: Apache-2.0
/**
 * Win32 through bun:ffi, without PowerShell or a console helper: TCP listeners with their
 * owning PID (iphlpapi GetExtendedTcpTable), exact process creation time (GetProcessTimes,
 * 100 ns like .NET `Process.StartTime`) and a kill-on-close job object so that a supervised
 * child never outlives its supervisor. Windows x64/arm64 only.
 */
import { dlopen, FFIType, ptr } from "bun:ffi";

export type Listener = { address: string; port: number; pid: number };

const AF_INET = 2;
const AF_INET6 = 23;
const TCP_TABLE_OWNER_PID_LISTENER = 3;
const ERROR_INSUFFICIENT_BUFFER = 122;
const PROCESS_TERMINATE = 0x0001;
const PROCESS_SET_QUOTA = 0x0100;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION = 9;
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
/** FILETIME of 1970-01-01T00:00:00Z. */
const UNIX_EPOCH_FILETIME = 116_444_736_000_000_000n;

const openIphlpapi = () =>
  dlopen("iphlpapi.dll", {
    GetExtendedTcpTable: {
      args: [
        FFIType.ptr,
        FFIType.ptr,
        FFIType.i32,
        FFIType.u32,
        FFIType.i32,
        FFIType.u32,
      ],
      returns: FFIType.u32,
    },
  }).symbols;

const openKernel32 = () =>
  dlopen("kernel32.dll", {
    OpenProcess: {
      args: [FFIType.u32, FFIType.i32, FFIType.u32],
      returns: FFIType.ptr,
    },
    CloseHandle: { args: [FFIType.ptr], returns: FFIType.i32 },
    GetProcessTimes: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
      returns: FFIType.i32,
    },
    CreateJobObjectW: {
      args: [FFIType.ptr, FFIType.ptr],
      returns: FFIType.ptr,
    },
    SetInformationJobObject: {
      args: [FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.u32],
      returns: FFIType.i32,
    },
    AssignProcessToJobObject: {
      args: [FFIType.ptr, FFIType.ptr],
      returns: FFIType.i32,
    },
  }).symbols;

type Handle = NonNullable<
  ReturnType<ReturnType<typeof openKernel32>["CreateJobObjectW"]>
>;

let iphlpapi: ReturnType<typeof openIphlpapi> | undefined;
let kernel32: ReturnType<typeof openKernel32> | undefined;
let job: Handle | undefined;

/** Canonical text of a literal IP (IPv6 compressed and lower-case). */
export function normalizeAddress(address: string): string {
  if (!address.includes(":")) return address;
  try {
    return new URL(`http://[${address}]/`).hostname.slice(1, -1);
  } catch {
    return address.toLowerCase();
  }
}

/** Rows of a `MIB_TCPTABLE_OWNER_PID` (24-byte `MIB_TCPROW_OWNER_PID`, ports in network order). */
export function parseIPv4Table(buffer: Uint8Array): Listener[] {
  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength,
  );
  const rows: Listener[] = [];
  for (let i = 0; i < view.getUint32(0, true); i += 1) {
    const at = 4 + i * 24;
    rows.push({
      address: [...buffer.subarray(at + 4, at + 8)].join("."),
      port: view.getUint16(at + 8, false),
      pid: view.getUint32(at + 20, true),
    });
  }
  return rows;
}

/** Rows of a `MIB_TCP6TABLE_OWNER_PID` (56-byte `MIB_TCP6ROW_OWNER_PID`). */
export function parseIPv6Table(buffer: Uint8Array): Listener[] {
  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength,
  );
  const rows: Listener[] = [];
  for (let i = 0; i < view.getUint32(0, true); i += 1) {
    const at = 4 + i * 56;
    const groups = Array.from({ length: 8 }, (_, g) =>
      view.getUint16(at + g * 2, false).toString(16),
    );
    rows.push({
      address: normalizeAddress(groups.join(":")),
      port: view.getUint16(at + 20, false),
      pid: view.getUint32(at + 52, true),
    });
  }
  return rows;
}

function listenerTable(family: number): Uint8Array {
  const api = (iphlpapi ??= openIphlpapi());
  const size = new Uint32Array([64 * 1024]);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const buffer = new Uint8Array(size[0]!);
    const status = api.GetExtendedTcpTable(
      ptr(buffer),
      ptr(size),
      0,
      family,
      TCP_TABLE_OWNER_PID_LISTENER,
      0,
    );
    if (status === 0) return buffer;
    if (status !== ERROR_INSUFFICIENT_BUFFER)
      throw new Error(`GetExtendedTcpTable : ${status}`);
    size[0] = size[0]! + 16 * 1024;
  }
  throw new Error("GetExtendedTcpTable : table instable");
}

/** Every listening TCP socket (IPv4 and IPv6) with its owning process. */
export function tcpListeners(): Listener[] {
  return [
    ...parseIPv4Table(listenerTable(AF_INET)),
    ...parseIPv6Table(listenerTable(AF_INET6)),
  ];
}

/** `FILETIME` as ISO-8601 UTC with the 7 fractional digits of .NET's round-trip `o` format. */
export function fileTimeIso(fileTime: bigint): string {
  const sinceEpoch = fileTime - UNIX_EPOCH_FILETIME;
  const seconds = sinceEpoch / 10_000_000n;
  const fraction = (sinceEpoch % 10_000_000n).toString().padStart(7, "0");
  return `${new Date(Number(seconds) * 1000).toISOString().slice(0, 19)}.${fraction}Z`;
}

/** Creation time of a live process (identity check against PID reuse), `null` when gone. */
export function processStartedAt(pid: number): string | null {
  const api = (kernel32 ??= openKernel32());
  const handle = api.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
  if (!handle) return null;
  try {
    const times = new Uint32Array(8);
    const ok = api.GetProcessTimes(
      handle,
      ptr(times),
      ptr(times, 8),
      ptr(times, 16),
      ptr(times, 24),
    );
    return ok
      ? fileTimeIso((BigInt(times[1]!) << 32n) | BigInt(times[0]!))
      : null;
  } finally {
    api.CloseHandle(handle);
  }
}

/**
 * Puts a process in this process's job object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`: when
 * the supervisor exits or is terminated (task stopped), Windows kills the child too.
 */
export function killWithThisProcess(pid: number): void {
  const api = (kernel32 ??= openKernel32());
  if (!job) {
    const handle = api.CreateJobObjectW(null, null);
    if (!handle) throw new Error("CreateJobObjectW");
    // JOBOBJECT_EXTENDED_LIMIT_INFORMATION (144 bytes on 64-bit), BasicLimitInformation.LimitFlags at 16.
    const info = new Uint8Array(144);
    new DataView(info.buffer).setUint32(
      16,
      JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
      true,
    );
    if (
      !api.SetInformationJobObject(
        handle,
        JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
        ptr(info),
        144,
      )
    )
      throw new Error("SetInformationJobObject");
    job = handle;
  }
  const target = api.OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
  if (!target) throw new Error(`OpenProcess ${pid}`);
  try {
    if (!api.AssignProcessToJobObject(job, target))
      throw new Error("AssignProcessToJobObject");
  } finally {
    api.CloseHandle(target);
  }
}
