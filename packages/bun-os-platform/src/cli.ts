#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * bun-os-platform <command>
 *   check [--update-baseline] [--verbose]       catalogs, hardcoded strings, raw tokens
 *   locale [tag]                                negotiated chain (override > OS > en)
 *   t <locale> <domains> <id> [name=value...]   format a message
 *   theme css|resolve [id|path] [--light] [--high-contrast] [--seed #hex]
 *   theme list
 *   plugins list | pin <dir> | menu [locale]
 *   files detect <path...> [--magika] | preview <path> [--out thumb.webp]
 *   transfer get <url> [--dest p] [--sha256 h] [--sha512 h] [--mirror url]... [--bandwidth B/s]
 *   transfer list | pause <id> | resume <id>
 *   transfer upload <file> [--spec r2:private/prefix] [--key k] [--delete]
 *   sidecar                                     JSON-lines service for native hosts
 */
import { runCheck } from "./check";
import { detectFile, previewFile } from "./files";
import { localizer, negotiate } from "./i18n";
import { pinPlugin, plugins } from "./plugins";
import { listThemes, loadTheme, resolveTheme, themeCss } from "./theme";
import { deleteObject, statObject, transfers, uploadFile } from "./transfer";

const argv = Bun.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name: string) => argv.includes(name);
const VALUE_FLAGS = new Set([
  "--dest",
  "--sha256",
  "--sha512",
  "--mirror",
  "--bandwidth",
  "--spec",
  "--key",
  "--seed",
  "--out",
]);
const positional = argv.filter(
  (a, i) => !a.startsWith("--") && !VALUE_FLAGS.has(argv[i - 1] ?? ""),
);
const print = (v: unknown) =>
  console.log(typeof v === "string" ? v : JSON.stringify(v, null, 2));

switch (positional[0]) {
  case "check":
    process.exitCode = runCheck({
      updateBaseline: has("--update-baseline"),
      verbose: has("--verbose"),
    });
    break;
  case "locale":
    print(negotiate({ override: positional[1], os: true }));
    break;
  case "t": {
    const [, tag = "en", domains = "common", id = ""] = positional;
    const n = negotiate({ override: tag });
    const args: Record<string, string | number> = {};
    for (const kv of positional.slice(4)) {
      const [k, v = ""] = kv.split("=");
      if (k) args[k] = Number.isFinite(Number(v)) && v !== "" ? Number(v) : v;
    }
    print(localizer(n.chain, domains.split(",")).t(id, args));
    break;
  }
  case "theme": {
    const id = positional[2];
    if (positional[1] === "list") print([...listThemes().keys()]);
    else if (positional[1] === "css")
      print(themeCss(loadTheme(id), { seed: flag("--seed") }));
    else
      print(
        resolveTheme(loadTheme(id), {
          dark: has("--light") ? false : undefined,
          highContrast: has("--high-contrast"),
          seed: flag("--seed"),
          reducedMotion: has("--reduced-motion"),
        }),
      );
    break;
  }
  case "plugins": {
    if (positional[1] === "pin") {
      print(await pinPlugin(positional[2] ?? ""));
      break;
    }
    const registry = await plugins();
    if (positional[1] === "menu") {
      print(
        registry.menuFor(
          localizer(negotiate({ override: positional[2], os: true }).chain, [
            "common",
            "shell",
          ]),
        ),
      );
      break;
    }
    print({
      loaded: registry.plugins.map(
        (p) =>
          `${p.manifest.name}@${p.manifest.version} (${p.trust}) [${p.manifest.permissions.join(", ")}]`,
      ),
      blocked: registry.blocked,
      detectors: registry.detectors.map((d) => d.plugin),
      previewers: registry.previewers.map(
        (p) => `${p.plugin}:${p.kind ?? "*"}/${p.format ?? "*"}`,
      ),
      machines: registry.machines.length,
      sources: registry.sources.map((s) => `${s.plugin}:${s.id}`),
      providers: registry.providers.map((p) => `${p.plugin}:${p.id}`),
      themes: registry.themes.map((t) => t.id),
      menu: registry.menu.map((m) => `${m.plugin}:${m.id} @${m.location}`),
    });
    break;
  }
  case "files": {
    if (positional[1] === "preview") {
      const p = await previewFile(positional[2] ?? "");
      const out = flag("--out");
      if (out && p.thumbnail) await Bun.write(out, p.thumbnail);
      print({
        ...p,
        thumbnail: p.thumbnail
          ? `${p.thumbnail.length} bytes${out ? ` -> ${out}` : ""}`
          : null,
      });
    } else
      for (const path of positional.slice(2))
        print(await detectFile(path, { magika: has("--magika") }));
    break;
  }
  case "transfer": {
    if (positional[1] === "upload") {
      const result = await uploadFile(positional[2] ?? "", {
        spec: flag("--spec"),
        key: flag("--key"),
      });
      print({ uploaded: result });
      if (has("--delete")) {
        const spec = `s3://${result.bucket}`;
        await deleteObject(spec, result.key);
        print({
          deleted: result.key,
          statAfterDelete: await statObject(spec, result.key),
        });
      }
      break;
    }
    const service = await transfers();
    if (positional[1] === "list") print(service.list());
    else if (positional[1] === "pause") service.pause(positional[2] ?? "");
    else if (positional[1] === "resume") {
      service.resume(positional[2] ?? "");
      print(await service.wait(positional[2] ?? ""));
    } else if (positional[1] === "get") {
      const mirrors = argv.flatMap((a, i) =>
        a === "--mirror" && argv[i + 1] ? [argv[i + 1] as string] : [],
      );
      const r = service.enqueue({
        url: positional[2] ?? "",
        dest: flag("--dest"),
        sha256: flag("--sha256"),
        sha512: flag("--sha512"),
        mirrors,
        bandwidth: Number(flag("--bandwidth") ?? 0),
      });
      service.addEventListener("progress", (e) => {
        const d = (e as CustomEvent).detail;
        if (d.id === r.id)
          console.error(
            `${d.state} ${d.received}/${d.size ?? "?"} ${d.rate} B/s via ${d.via ?? "-"}`,
          );
      });
      print(await service.wait(r.id));
    }
    break;
  }
  case "sidecar":
    await import("./sidecar");
    break;
  default:
    console.log(
      (await Bun.file(import.meta.path).text())
        .match(/\/\*\*([\s\S]*?)\*\//)?.[1]
        ?.replace(/^ \* ?/gm, "")
        .trim(),
    );
    process.exitCode = positional[0] ? 2 : 0;
}
