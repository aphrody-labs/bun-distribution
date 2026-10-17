import type { BunPlugin } from "bun";
import type { AndroidManifest } from "./types.ts";

const ANDROID = "android:";

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name.replace(":", "\\:")}\\s*=\\s*"([^"]*)"`).exec(tag);
  return match?.[1];
}

function elements(xml: string, name: string): string[] {
  return [...xml.matchAll(new RegExp(`<${name}\\b[\\s\\S]*?(?:/>|</${name}>)`, "g"))].map(match => match[0]);
}

/** Parse the subset of `AndroidManifest.xml` needed by tooling and applications. */
export function parseManifest(xml: string): AndroidManifest {
  const manifest = /<manifest\b[^>]*>/.exec(xml)?.[0] ?? "";
  const usesSdk = /<uses-sdk\b[^>]*>/.exec(xml)?.[0] ?? "";
  const names = (tag: string) =>
    elements(xml, tag)
      .map(item => attribute(item, `${ANDROID}name`))
      .filter((name): name is string => !!name);
  return {
    package: attribute(manifest, "package"),
    namespace: attribute(manifest, "package"),
    versionCode: attribute(manifest, `${ANDROID}versionCode`),
    versionName: attribute(manifest, `${ANDROID}versionName`),
    minSdk: attribute(usesSdk, `${ANDROID}minSdkVersion`),
    targetSdk: attribute(usesSdk, `${ANDROID}targetSdkVersion`),
    permissions: names("uses-permission"),
    activities: elements(xml, "activity").map(item => ({
      name: attribute(item, `${ANDROID}name`) ?? "",
      exported: attribute(item, `${ANDROID}exported`) === "true",
      launcher: item.includes("android.intent.category.LAUNCHER"),
    })),
    services: names("service"),
    receivers: names("receiver"),
    providers: names("provider"),
  };
}

/**
 * Bun plugin: `import manifest from "./AndroidManifest.xml"` yields a parsed
 * manifest, and `import url from "android-asset:index.html"`
 * yields the WebView asset-loader URL of a file under `assets/`.
 */
export function androidPlugin(options: { assetHost?: string } = {}): BunPlugin {
  const host = options.assetHost ?? "appassets.androidplatform.net";
  return {
    name: "bun-android",
    setup(build) {
      build.onLoad({ filter: /AndroidManifest\.xml$/ }, async args => ({
        loader: "object",
        exports: { default: parseManifest(await Bun.file(args.path).text()) },
      }));
      build.onResolve({ filter: /^android-asset:/ }, args => ({
        path: args.path.slice("android-asset:".length).replace(/^\/+/, ""),
        namespace: "android-asset",
      }));
      build.onLoad({ filter: /.*/, namespace: "android-asset" }, args => ({
        loader: "object",
        exports: { default: `https://${host}/assets/${args.path}` },
      }));
    },
  };
}

export default androidPlugin();
