# Shared platform strings (packages/bun-os-platform): loaded with every domain.

-product = Bun OS
common-unknown-value = -
common-on = On
common-off = Off
common-cancel = Cancel
common-close = Close
common-retry = Retry
common-open = Open

## Language and theme pickers

platform-language = Language
platform-language-system = System language ({ $name })
platform-theme = Theme
platform-theme-baseline = { -product } baseline
platform-theme-dynamic = Colors from the game art
platform-contrast = Contrast
platform-contrast-standard = Standard
platform-contrast-high = High
platform-contrast-system = Follow the system
platform-mode-light = Light
platform-mode-dark = Dark
platform-mode-system = System

## Plugins

plugins-title = Plugins
plugins-count = { $count ->
    [one] { $count } plugin
   *[other] { $count } plugins
}
plugins-blocked = { $name } is blocked: { $reason }
plugins-unpinned = { $name } is not pinned. Run bun-os-platform plugins pin { $name } to trust it.
plugins-permission = { $name } asks for { $permission }

## File types (open, preview, import)

files-open = Open
files-import = Import
files-preview = Preview
files-kind-image = Image
files-kind-video = Video
files-kind-audio = Audio
files-kind-rom = Game image
files-kind-firmware = Firmware
files-kind-save = Save data
files-kind-archive = Archive
files-kind-package = Package
files-kind-executable = Program
files-kind-document = Document
files-kind-font = Font
files-kind-theme = Theme
files-kind-plugin = Plugin
files-kind-unknown = Unknown file
files-detected = { $format } ({ $platform }), detected by { $by }

## Transfers (downloads and uploads)

transfer-title = Transfers
transfer-queued = Queued
transfer-running = { $percent } at { $rate }
transfer-paused = Paused at { $percent }
transfer-done = Done
transfer-failed = Failed: { $error }
transfer-verifying = Verifying { $algorithm }
transfer-mirror = From { $host }
transfer-lancache = Through the LAN cache
transfer-pause = Pause
transfer-resume = Resume
transfer-remaining = { $done } of { $total }
transfer-limit = Limit { $rate }
transfer-unlimited = No limit

## Built-in plugins

plugin-bun-engine-free-roms = Free ROM packs
