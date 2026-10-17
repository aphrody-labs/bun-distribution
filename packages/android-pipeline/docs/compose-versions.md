# Android, Material and Compose versions — October 2026

Imported from `aphrody-labs/bun-engine` (`docs/android/android-october-2026.md`,
revision `6afa5a7e1f04e29ee1ec75ede9c7c2220ad12b68`, MIT, Aphrody Labs) and
translated. The research covered the official Android sources, Google Maven,
Maven Central and Google's GitHub repositories. The versions below are
published releases verified on **2026-10-12**; later releases are not implied.

## Verified stable versions

| Item                                          | Version        | Local primary source          |
| --------------------------------------------- | -------------- | ----------------------------- |
| Android Gradle Plugin                         | 9.4.1          | `references/agp.xml`          |
| Kotlin Gradle Plugin / Compose compiler       | 2.4.21         | `references/kotlin.xml`       |
| Compose BOM                                   | **2026.09.00** | `references/compose-bom.xml`  |
| Compose Runtime, UI, Foundation and Animation | 1.12.1         | `references/bom-pom.pom`      |
| Compose Material 3                            | 1.4.0          | `references/material3.xml`    |
| Material 3 Adaptive, Layout and Navigation    | 1.3.0          | `references/bom-pom.pom`      |
| Activity Compose                              | 1.13.0         | `references/activity.xml`     |
| Lifecycle Runtime Compose                     | 2.11.0         | `references/lifecycle.xml`    |
| Material Components Android (Views)           | 1.14.0         | `references/mdc-metadata.xml` |

BOM 2026.09.00 already publishes Compose 1.12.1, Material 3 1.4.0 and Adaptive
1.3.0. The metadata also lists Runtime 1.13.0-beta01, Material 3 1.5.0-beta01
and Kotlin 2.5.0-Beta1; those are pre-releases. Sources:
[Google Maven](https://dl.google.com/dl/android/maven2/androidx/compose/compose-bom/2026.09.00/compose-bom-2026.09.00.pom),
[Kotlin on Maven Central](https://repo.maven.apache.org/maven2/org/jetbrains/kotlin/kotlin-gradle-plugin/maven-metadata.xml).

## Native Android configuration

AGP 9 enables built-in Kotlin. In the Android module keep
`com.android.application`, apply `org.jetbrains.kotlin.plugin.compose`, enable
`buildFeatures.compose` and align the Compose plugin with the Kotlin compiler
that is actually resolved. The BOM manages Compose library versions, not the
compiler. Activity and Lifecycle keep explicit versions.
[Built-in Kotlin](https://developer.android.com/build/migrate-to-built-in-kotlin),
[Compose compiler](https://developer.android.com/develop/ui/compose/setup-compose-dependencies-and-compiler),
[BOM](https://developer.android.com/develop/ui/compose/bom).

The workspace applies these versions in
[`apps/bun-android/gradle/libs.versions.toml`](../../../apps/bun-android/gradle/libs.versions.toml)
and [`apps/bun-android/app/build.gradle`](../../../apps/bun-android/app/build.gradle):
AGP 9.4.1, Kotlin/Compose compiler 2.4.21, BOM 2026.09.00, Activity 1.13.0,
Lifecycle 2.11.0 and Adaptive 1.3.0, with Compose, debug preview tooling,
Compose tests and dependency locking. Compile SDK 37.2, target SDK 37, min SDK
**24** (required by WebKit 1.17.1) and NDK 30.0.16248370. The Rust library
remains API 23 compatible.

Owners: `apps/bun-android` (Kotlin/Java and the APK), `crates/android-native`
(Rust JNI and C ABI), `packages/android-web` (Bun bundle), `apps/java-ffi`
(JNI on Java 21, FFM on newer JDKs) and `packages/bun-android`
(`bun android build|install|run`). Bun builds the JavaScript on the host; the
Rust Android libraries load through JNI. The Compose app ships a Material 3
gallery, `GalleryViewModel`, lifecycle-aware collection,
`NavigationSuiteScaffold`, a dynamic theme and Bun content loaded through
`WebViewAssetLoader`. That WebView belongs to the Compose app; Tauri Android
is not qualified.

## UI rules

- Shared screen state belongs to its ViewModel; components receive state and
  callbacks. Collect Flows with `collectAsStateWithLifecycle`. Restorable local
  state uses `rememberSaveable`; durable data stays in the data layer.
  [State hoisting](https://developer.android.com/develop/ui/compose/state-hoisting),
  [state saving](https://developer.android.com/develop/ui/compose/state-saving).
- Start effects through the dedicated APIs: `LaunchedEffect` with relevant
  keys, `DisposableEffect` for a resource to release and `rememberUpdatedState`
  for a callback that must not restart the effect.
  [Side effects](https://developer.android.com/develop/ui/compose/side-effects).
- Use `MaterialTheme.colorScheme`, typography and shapes; provide light and dark
  themes and dynamic color on Android 12+, with a defined palette for older
  releases. [Material 3](https://developer.android.com/develop/ui/compose/designsystems/material3).
- Adapt navigation to the **available window** and posture with
  `NavigationSuiteScaffold` and `currentWindowAdaptiveInfo`. Preserve state on
  resize; handle insets and foldables.
  [Adaptive navigation](https://developer.android.com/develop/ui/compose/layouts/adaptive/build-adaptive-navigation).
- Keep 48 dp touch targets and native semantics. Describe active icons, leave
  decorations without descriptions, use localized strings and check large
  font scales. The Compose Samples fix of 2026-10-06 replaces fixed heights by
  minimums to avoid clipped text.
  [Accessibility](https://developer.android.com/develop/ui/compose/accessibility/api-defaults),
  [official fix](https://github.com/android/compose-samples/commit/5a390e4a9d3c4e5b30e942041bde93582c4d9492).
- Give lists stable keys, avoid expensive work in composition, limit frequent
  state reads and reserve `derivedStateOf` for values that change less often
  than their input. Measure critical journeys in release builds; an
  app-specific Baseline Profile must be validated with Macrobenchmark.
  [Performance](https://developer.android.com/develop/ui/compose/performance/bestpractices),
  [Baseline Profiles](https://developer.android.com/develop/ui/compose/performance/baseline-profiles).

## Pinned GitHub references

| Official repository                                                                                                                             | Commit                                     | Date (UTC) | Use                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ---------- | ------------------------------------------------------------------ |
| [android/compose-samples](https://github.com/android/compose-samples/tree/5a390e4a9d3c4e5b30e942041bde93582c4d9492)                             | `5a390e4a9d3c4e5b30e942041bde93582c4d9492` | 2026-10-06 | Jetchat: state/theme; Reply: adaptation; Jetcaster: Flow/lifecycle |
| [android/nowinandroid](https://github.com/android/nowinandroid/tree/a49ed253d75e61a2b6ab80a8da677b57437b08eb)                                   | `a49ed253d75e61a2b6ab80a8da677b57437b08eb` | 2026-09-22 | Reactive architecture, UI/data layers, tests and modularization    |
| [androidx/androidx](https://github.com/androidx/androidx/tree/034d37ae95b7db8560e520c0366696af56a37b96/compose)                                 | `034d37ae95b7db8560e520c0366696af56a37b96` | 2026-10-12 | Compose source; development branch, distinct from stable artifacts |
| [material-components-android](https://github.com/material-components/material-components-android/tree/60ff09436d5d477a4b9d02940f31eb01e1250620) | `60ff09436d5d477a4b9d02940f31eb01e1250620` | 2026-09-14 | Official status of Material Views                                  |

Material Components (Views) is in maintenance since the 2026 Compose-first
announcement; the repository recommends Compose for new Material and Android
features.
[Pinned guide](https://github.com/material-components/material-components-android/blob/60ff09436d5d477a4b9d02940f31eb01e1250620/docs/getting-started.md).

## Evidence and limits

Context7 resolution and documentation queries covered setup/BOM,
state/lifecycle, performance and Material/accessibility with their official
URLs. The additional adaptive and AndroidX source queries hit the monthly
Context7 quota; those points were checked directly against the primary
Google/GitHub sources, and a quota error was not counted as validation. This
document records contracts; APK execution and instrumented tests are separate
qualifications.

The downloaded Maven XML/POM metadata and the query provenance are in
[`references/`](references/android-october-2026.json). They are metadata
snapshots from Google Maven and Maven Central kept as provenance, not vendored
executable code.
