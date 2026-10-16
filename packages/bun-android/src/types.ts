/** Android ABIs supported by the embedded Bun runtime. */
export type AndroidAbi = "arm64-v8a" | "x86_64";

/** Rust target triple for an Android ABI. */
export type AndroidTriple = "aarch64-linux-android" | "x86_64-linux-android";

/** `bun build --compile` target for an Android ABI. */
export type BunAndroidCompileTarget = "bun-android-arm64" | "bun-android-x64";

export type BuildVariant = "debug" | "release";

/** Resolved host toolchain used to build and drive Android applications. */
export interface AndroidToolchain {
  sdk: string;
  ndk: string | undefined;
  adb: string;
  sdkmanager: string;
  gradle: string | undefined;
  javaHome: string | undefined;
}

export interface AndroidDevice {
  serial: string;
  state: string;
  properties: Record<string, string>;
}

export interface BuildOptions {
  project: string;
  variant?: BuildVariant;
  abis?: readonly AndroidAbi[];
  /** Directory receiving `jniLibs/<abi>/*.so`. */
  jniLibs?: string;
  /** Prebuilt `libbun.so` per ABI to embed in the APK. */
  libbun?: Partial<Record<AndroidAbi, string>>;
  native?: boolean;
}

/** Parsed `AndroidManifest.xml` exposed by the loader. */
export interface AndroidManifest {
  package: string | undefined;
  namespace: string | undefined;
  versionCode: string | undefined;
  versionName: string | undefined;
  minSdk: string | undefined;
  targetSdk: string | undefined;
  permissions: string[];
  activities: { name: string; exported: boolean; launcher: boolean }[];
  services: string[];
  receivers: string[];
  providers: string[];
}
