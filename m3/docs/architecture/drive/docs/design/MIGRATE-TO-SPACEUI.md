# Migrate @sd/ui → @aphrody/m3-primitives

> Historical import plan. The current Windows/Linux/Web migration is tracked in
> `docs/design/SPACEUI-SPACEDRIVE-MIGRATION.md` at the repository root. The
> React Native app has been removed.

Replace all imports from `@sd/ui` with `@aphrody/m3-primitives` across the spacedrive codebase. The components are identical — same names, same props, same behavior. This is a pure import path swap.

## Rules

1. **Do NOT modify any component logic, props, or JSX.** Only change import paths.
2. **Do NOT delete `@sd/ui` yet.** Just change the imports. Deletion is a separate step.
3. `cva` and `cx` from `class-variance-authority` should be imported directly from `class-variance-authority`, not from `@sd/ui`.

## Import Mapping

Every import from `'@sd/ui'` becomes an import from `'@aphrody/m3-primitives'` with these exceptions:

### Form field wrappers → `@aphrody/m3-forms`

These imports come from `@aphrody/m3-forms`, NOT `@aphrody/m3-primitives`:

- `FormField`
- `CheckBoxField`
- `InputField`
- `SwitchField`
- `SelectField`
- `TextAreaField`
- `RadioGroupField`

### Direct from `class-variance-authority`

- `cva` → `import { cva } from 'class-variance-authority'`
- `cx` → `import { cx } from 'class-variance-authority'`

### Everything else → `@aphrody/m3-primitives`

All of these come from `@aphrody/m3-primitives`:

```
Button, buttonStyles, buttonVariants, ButtonProps, LinkButtonProps
Input, SearchInput, TextArea, PasswordInput, Label, inputStyles, InputProps
CheckBox, RadixCheckbox
Switch, SwitchProps
Slider
RadioGroupRoot, RadioGroupItem (namespace: import * as RadioGroup from ...)
Dialog, dialogManager, useDialog, Dialogs, DialogProps, UseDialogProps
Popover, usePopover, PopoverClose
Tooltip, TooltipProvider, Kbd, TooltipProps
TabsRoot, TabsList, TabsTrigger, TabsContent (namespace: import * as Tabs from ...)
DropdownMenu
ContextMenu, ContextMenuDivItem, useContextMenuContext
Dropdown (namespace: import * as Dropdown from ...)
Select, SelectOption, selectStyles, SelectProps
toast, Toaster, TOAST_TIMEOUT
Loader
Divider
ProgressBar
CircularProgress
SearchBar
Shortcut
TopBarButton
TopBarButtonGroup
ShinyButton
ShinyToggle
InfoBanner, InfoBannerText, InfoBannerSubtext
Card, GridLayout
CategoryHeading, ScreenHeading
Resizable, ResizablePanel, ResizableHandle, useResizableContext
ModifierKeys, EditingKeys, UIKeys, NavigationKeys, modifierSymbols, keySymbols
tw
Form, ErrorMessage, errorStyles, z
```

## Namespace Imports

Some modules use namespace imports. Preserve the pattern:

```typescript
// Before
import * as Dropdown from '@sd/ui';     // WRONG - this isn't how it works
import { Dropdown } from '@sd/ui';       // this re-exports as namespace

// The actual pattern in @sd/ui/index.ts:
export * as Dropdown from './Dropdown';
export * as RadioGroup from './RadioGroup';
export * as Tabs from './Tabs';

// After — same namespace pattern from @aphrody/m3-primitives:
import { Dropdown } from '@aphrody/m3-primitives';   // if using the namespace re-export
// OR
import * as Dropdown from '@aphrody/m3-primitives/src/Dropdown';  // direct
```

Check each file's actual usage to determine the correct import style.

## Files to Modify

All files matching this grep pattern in these directories:

```
packages/interface/src/**/*.{ts,tsx}
apps/tauri/src/**/*.{ts,tsx}
```

Search for: `from '@sd/ui'` or `from "@sd/ui"`

**Do NOT touch:**
- `packages/` (the source package itself)

## How to Handle Split Imports

Some files import both primitives AND form fields from `@sd/ui`. Split into two imports:

```typescript
// Before
import { Button, Input, Dialog, useDialog, dialogManager, InputField, FormField } from '@sd/ui';

// After
import { Button, Input, Dialog, useDialog, dialogManager } from '@aphrody/m3-primitives';
import { InputField, FormField } from '@aphrody/m3-forms';
```

## How to Handle cva/cx

```typescript
// Before
import { cva, cx, Button } from '@sd/ui';

// After
import { cva, cx } from 'class-variance-authority';
import { Button } from '@aphrody/m3-primitives';
```

## Verification

After all imports are changed, the app should compile and run with zero behavior changes. Run:

```bash
cd apps/tauri && bun run dev
```

Every component should look and behave identically — we copied the source code exactly.
