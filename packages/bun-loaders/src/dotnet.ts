// SPDX-License-Identifier: MIT
/** C# loader backend: build a `.cs` source as a library with the .NET SDK, then reflect/invoke it. */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const REFLECT = join(import.meta.dir, "dotnet", "reflect.cs");

export interface CSharpParameter {
  name: string;
  type: string;
  optional: boolean;
}
export interface CSharpMethod {
  name: string;
  static: boolean;
  returns: string;
  parameters: CSharpParameter[];
}
export interface CSharpMember {
  name: string;
  type: string;
  static: boolean;
  value?: unknown;
}
export interface CSharpType {
  name: string;
  kind: "class" | "struct" | "interface" | "enum";
  static: boolean;
  methods: CSharpMethod[];
  properties: CSharpMember[];
  fields: CSharpMember[];
}
export interface CSharpAssembly {
  assembly: string;
  version: string | null;
  dll: string;
  source: string;
  types: CSharpType[];
}

function dotnet(): string {
  const found = Bun.env.DOTNET_HOST_PATH ?? Bun.which("dotnet");
  if (!found) throw new Error("the .NET SDK (dotnet) is required to load .cs files");
  return found;
}

async function exec(args: string[], timeout = 300_000): Promise<string> {
  const proc = Bun.spawn([dotnet(), ...args], {
    stdout: "pipe",
    stderr: "pipe",
    timeout,
    windowsHide: true,
    env: { ...Bun.env, DOTNET_CLI_TELEMETRY_OPTOUT: "1", DOTNET_NOLOGO: "1" },
  });
  const [out, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (code !== 0) throw new Error(`dotnet ${args[0]} exited ${code}: ${(err || out).trim()}`);
  return out;
}

const project = (name: string, source: string): string => `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net${Bun.env.BUN_LOADERS_DOTNET_TFM ?? "10.0"}</TargetFramework>
    <OutputType>Library</OutputType>
    <AssemblyName>${name}</AssemblyName>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <EnableDefaultCompileItems>false</EnableDefaultCompileItems>
  </PropertyGroup>
  <ItemGroup><Compile Include="${Bun.escapeHTML(source)}" /></ItemGroup>
</Project>
`;

/** Compile `source` into a library assembly cached by content hash; returns the DLL path. */
export async function buildCSharp(source: string): Promise<string> {
  const path = resolve(source);
  const hash = Bun.hash(await Bun.file(path).bytes()).toString(16);
  const name = basename(path, ".cs").replace(/[^A-Za-z0-9_.]/g, "_") || "Script";
  const dir = join(Bun.env.BUN_LOADERS_CACHE ?? join(tmpdir(), "bun-loaders"), "cs", `${name}-${hash}`);
  const dll = join(dir, "out", `${name}.dll`);
  if (await Bun.file(dll).exists()) return dll;
  mkdirSync(dir, { recursive: true });
  const csproj = join(dir, `${name}.csproj`);
  await Bun.write(csproj, project(name, path));
  await exec(["build", csproj, "-c", "Release", "-o", join(dir, "out"), "-nologo", "-v", "q"]);
  return dll;
}

export async function describeCSharp(source: string): Promise<CSharpAssembly> {
  const dll = await buildCSharp(source);
  const info = JSON.parse(await exec(["run", REFLECT, "--", "describe", dll])) as Omit<
    CSharpAssembly,
    "dll" | "source"
  >;
  return { ...info, dll, source: resolve(source) };
}

/** Invoke a public static method; arguments and result cross the boundary as JSON. */
export async function invokeCSharp(dll: string, type: string, method: string, args: unknown[] = []): Promise<unknown> {
  const out = await exec(["run", REFLECT, "--", "invoke", dll, type, method, JSON.stringify(args)]);
  return out.trim() ? JSON.parse(out) : undefined;
}

/** Module exports of a `.cs` file: `default`/`metadata`, one object per public type, one async function per public static method. */
export async function csharpExports(source: string): Promise<Record<string, unknown>> {
  const info = await describeCSharp(source);
  const exports: Record<string, unknown> = { default: info, metadata: info };
  for (const type of info.types) {
    const short = type.name.slice(type.name.lastIndexOf(".") + 1).replace(/[^A-Za-z0-9_$]/g, "_");
    const bag: Record<string, unknown> = { $type: type };
    for (const m of type.methods) {
      if (!m.static || m.name in bag) continue;
      bag[m.name] = (...args: unknown[]) => invokeCSharp(info.dll, type.name, m.name, args);
      exports[m.name] ??= bag[m.name];
    }
    exports[short] ??= bag;
  }
  return exports;
}
