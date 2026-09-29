# IECODE shell contract

This is the implementation contract for the unified Avalonia shell. It is intentionally
dependency-free: the implementation uses the Avalonia, FluentAvalonia, and MVVM types already
referenced by `src/IECODE/Gui/IECODE.Gui.csproj`.

## Current ownership

- `src/IECODE/Gui/App.axaml` and `App.axaml.cs` own the one application lifetime, theme, resource
  dictionaries, and desktop `MainWindow` creation.
- `src/IECODE/Gui/Views/MainWindow.axaml` and `.cs` own the save-editor shell, its native menu,
  focusable content, and message/dialog bridge.
- The former `NdsViewer/Application/App.axaml` and application code-behind are removed; the viewer
  services now run under the host lifetime directly.
- `NdsViewerShared` and `NdsViewerPlugins` are feature/plugin contracts. A plugin must not replace
  `ApplicationService.Application`, create an `Application`, or install a second theme.

## Implemented shell boundary

The current host implements the first migration slice:

1. Exactly one native menu declaration remains. `MainWindow` owns the menu because its commands
   and `MainViewModel` are available there. Its open/save actions use the same commands as the
   shell registry.
2. The in-process shell registry lives in `IECODE.Gui/Shell` (no package or process boundary):

   ```text
   ShellCommand
     Id: stable machine-readable identifier
     Label: visible localized label
     AutomationName: complete spoken/action name
     Gesture: optional Avalonia key gesture
     Command: existing ICommand/IRelayCommand

   ShellContribution
     PluginId: stable plugin identifier
     Commands: zero or more ShellCommand values
     NavigationEntries: zero or more { Id, Label, AutomationName, ViewFactory }
     FileAssociations: existing viewer associations
   ```

   The registry is owned by the host and the IECODE save-editor contribution is registered during
   startup. The existing `BaseViewerPlugin` and `ViewerPluginWindowEntry` APIs remain an adapter
   during the migration; plugins are not required to change in the same patch.
3. The next plugin migration step is to replace string/type-only navigation with the registry
   adapter. A plugin contribution is
   identified by a stable ID and a host-owned view factory or command. XAML must not receive an
   arbitrary reflected `Type` as the only activation contract. Existing plugin windows may still
   be opened through the adapter until an in-shell view is available.
4. Make the shell keyboard-complete and screen-reader-readable:

   - Every icon-only control and every plugin navigation entry has
     `AutomationProperties.Name` and a stable automation ID.
   - `TabItem Header="+"` becomes an explicit action named “Add player tab”; placeholder tabs and
     disabled actions remain visibly and semantically disabled rather than silently inert.
   - The first meaningful action receives focus when the shell opens; opening a plugin or dialog
     moves focus into it, and closing it returns focus to its invoking control.
   - No action is available only through `PointerPressed`, hover, or a tooltip. Native menu
     gestures, buttons, and plugin commands all route through the registry command.
   - Decorative title-bar content is not in the tab order and does not expose a false action.

## Acceptance checks

The source patch is complete only when all of these are true:

- `Tab` and `Shift+Tab` reach every enabled shell action in a deterministic order; `Enter` or
  `Space` activates the focused action; `Esc` closes the active dialog or transient surface.
- Each declared menu gesture activates the same command as its corresponding button, including its
  enabled/disabled state.
- An accessibility inspector can identify the shell window, navigation entries, plugin entries,
  dialogs, and icon-only controls without relying on visible glyphs.
- Loading a plugin adds only its declared contribution. It does not create another application
  lifetime, replace the host theme, or bypass the host command/focus path.
- The existing GUI build and tests remain the gates:

  ```sh
  dotnet build src/IECODE/Gui/IECODE.Gui.csproj --configuration Release --no-restore
  dotnet test src/IECODE/Core.Tests/IECODE.Core.Tests.csproj --configuration Release --no-restore
  ```

This document is a contract and migration target; it does not authorize edits to the currently
untracked `App.axaml` or `MainWindow` files when another agent owns those changes.
