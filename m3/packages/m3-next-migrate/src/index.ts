// SPDX-License-Identifier: Apache-2.0

// Core Migration Engine
export { transformComponent, type TransformOptions, type TransformResult } from "./transform";
export { scanNextDirectory, type ScanStats } from "./scanner";
export { scaffoldTargetProject, TAURI_3, type ScaffoldOptions } from "./scaffolder";
export { migrateProject, type MigrateProjectOptions, type MigrateProjectReport } from "./migrator";
export {
  buildRouteHierarchy,
  composeLayouts,
  generateAppRouterCode,
  matchRoutePath,
  type RouteDefinition,
  type RouteHierarchy,
} from "./layout";

// Codemods: Next 14/15 -> 16, MUI -> M3, Tailwind v3 -> v4, Pages -> App hints
export * as codemods from "./codemods";

// Runtime Shims
export {
  NextMigrateProvider,
  RouteParamsProvider,
  useNextMigrateContext,
  type RouteParams,
  type RouterMode,
  type NextMigrateProviderProps,
} from "./shims/provider";
export {
  useRouter,
  usePathname,
  useSearchParams,
  useParams,
  useSelectedLayoutSegment,
  useSelectedLayoutSegments,
  redirect,
  permanentRedirect,
  notFound,
  NavigationRedirectError,
  NavigationNotFoundError,
  type AppRouterInstance,
} from "./shims/navigation";
export { Link, default as LinkComponent, type LinkProps, type UrlObject } from "./shims/link";
export {
  Image,
  default as ImageComponent,
  getImageProps,
  type ImageProps,
  type StaticImageData,
} from "./shims/image";
export {
  dynamic,
  default as dynamicComponent,
  type DynamicOptions,
  type DynamicComponent,
} from "./shims/dynamic";
export { cookies, headers, type RequestCookie, type ReadonlyRequestCookies } from "./shims/headers";
export { Form, default as FormComponent, type FormProps } from "./shims/form";
export { tauriInvoke, createServerActionBridge, type TauriInvokeOptions } from "./shims/tauri-ipc";
export {
  setWindowTitle,
  setMetaTag,
  syncMetadata,
  useMetadata,
  Head,
  resolveTitle,
  type Metadata,
  type ResolvingMetadata,
  type MetadataTitle,
  type MetadataOpenGraph,
  type HeadProps,
} from "./shims/metadata";
export {
  NextRequest,
  NextResponse,
  createNextBunServer,
  type BunServerOptions,
} from "./shims/server";
export {
  Inter,
  Roboto,
  Roboto_Mono,
  Geist,
  Geist_Mono,
  Poppins,
  Open_Sans,
  Fira_Code,
  localFont,
  type FontConfig,
  type NextFont,
  type LocalFontConfig,
} from "./shims/font";

export {
  migrationRequirements,
  assertMigrationRequirements,
  type MigrationRequirement,
} from "./requirements";
