# IECODE GUI

`IECODE.Gui` is the single Avalonia desktop host for the integrated IECODE tools. It owns the
window lifetime and theme; feature code remains in libraries and plugin views keep their existing
view-model contracts.

The command and navigation ownership rules are defined in [SHELL-CONTRACT.md](../../../apis/iecode/gui/SHELL-CONTRACT.md).
The host also compiles the absorbed, UI-independent logic from the toolbox, map editor, save editor
and Strikers tools; platform-specific designer/forms are being replaced by shell contributions, not
run as second application lifetimes.

## UI contract

- Avalonia is the cross-platform host and FluentAvalonia supplies Fluent density, navigation and
  dialogs.
- Material Icons supplies the shared icon vocabulary used by the integrated NDS viewer and future
  tools. New toolbars should use the existing icon resources instead of introducing another icon
  package.
- `RequestedThemeVariant="Default"` follows the operating system. `App.axaml` defines the small
  IECODE surface/accent token set in both light and dark dictionaries; feature views consume those
  dynamic resources and do not hard-code a theme.
- Buttons and navigation entries must expose an automation name when their visible content is an
  icon or is not self-describing. Keep keyboard gestures in the native menu and tooltips on dense
  toolbars.
- A plugin is a view or capability, not an application. It may register a view-model, command or
  file association through the shared viewer services, but it must not create an `Application`, a
  second window host, or a competing theme.
- The host registry in `src/IECODE/Gui/Shell` gives commands stable IDs and a single `ICommand`
  instance for menu, keyboard and toolbar activation.
- `viewer.nds.open` is a host command exposed by the main menu and shell toolbar. It opens the
  integrated NDS viewer window under the existing Avalonia lifetime, including its 3D, sound and
  file-plugin surfaces. `toolbox.text-decoder.open` exposes the integrated Level-5 text decoder.
  The `ievr` shell contribution exposes Steam detection, configuration, profiles and mod
  management through the same command registry and host lifetime.

## Compatibility boundary

The former ndsSharp viewer is compiled into this host under `NdsViewer`, `NdsViewerShared` and
`NdsViewerPlugins`. Its static service API is retained as a compatibility seam while the unified
`IESE.App` owns startup. The old viewer `App` and `Program` are source-preserved but excluded from
the build, so there is one Avalonia lifetime and one main window.

The GUI project uses central package versions from `Directory.Packages.props` and targets
`net10.0`. A major Avalonia upgrade is a separately measured migration because FluentAvalonia and
the plugin XAML must move together; the current 11.3 line is the latest compatible line validated
by the workspace build.

## Verification

```sh
dotnet build src/IECODE/Gui/IECODE.Gui.csproj --configuration Release --no-restore
dotnet test src/IECODE/Core.Tests/IECODE.Core.Tests.csproj --configuration Release --no-restore
```

The repository-level stabilization gates and version freeze are recorded in [PLAN.md](../../../plans/iecode/PLAN.md).

The remaining WinForms/WPF feature batches, current inventory and their exit gates are recorded
in [`docs/REMAINING-WORK.md`](../../../reference/iecode/REMAINING-WORK.md). Empty tabs, disabled commands and retained
designer resources are migration work until the matrix gives them a verified owner.

The GUI build is expected to report inherited nullable warnings from absorbed plugin code. They
must be reduced at the owning feature boundary; do not hide them with a project-wide suppression.
