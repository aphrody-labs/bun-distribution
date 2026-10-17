-product = Bun OS
common-unknown-value = -
common-on = Ein
common-off = Aus
common-cancel = Abbrechen
common-close = Schließen
common-retry = Erneut versuchen
common-open = Öffnen

## Language and theme pickers

platform-language = Sprache
platform-language-system = Systemsprache ({ $name })
platform-theme = Design
platform-theme-baseline = { -product }-Standarddesign
platform-theme-dynamic = Farben aus dem Spielbild
platform-contrast = Kontrast
platform-contrast-standard = Standard
platform-contrast-high = Hoch
platform-contrast-system = Systemeinstellung verwenden
platform-mode-light = Hell
platform-mode-dark = Dunkel
platform-mode-system = System

## Plugins

plugins-title = Plug-ins
plugins-count = { $count ->
    [one] { $count } Plug-in
   *[other] { $count } Plug-ins
}
plugins-blocked = { $name } ist blockiert: { $reason }
plugins-unpinned = { $name } ist nicht angeheftet. Führe bun-os-platform plugins pin { $name } aus, um ihm zu vertrauen.
plugins-permission = { $name } fordert { $permission } an

## File types (open, preview, import)

files-open = Öffnen
files-import = Importieren
files-preview = Vorschau
files-kind-image = Bild
files-kind-video = Video
files-kind-audio = Audio
files-kind-rom = Spielabbild
files-kind-firmware = Firmware
files-kind-save = Speicherdaten
files-kind-archive = Archiv
files-kind-package = Paket
files-kind-executable = Programm
files-kind-document = Dokument
files-kind-font = Schriftart
files-kind-theme = Design
files-kind-plugin = Plug-in
files-kind-unknown = Unbekannte Datei
files-detected = { $format } ({ $platform }), erkannt durch { $by }

## Transfers (downloads and uploads)

transfer-title = Übertragungen
transfer-queued = In Warteschlange
transfer-running = { $percent } mit { $rate }
transfer-paused = Pausiert bei { $percent }
transfer-done = Fertig
transfer-failed = Fehlgeschlagen: { $error }
transfer-verifying = { $algorithm } wird überprüft
transfer-mirror = Von { $host }
transfer-lancache = Über den LAN-Cache
transfer-pause = Pausieren
transfer-resume = Fortsetzen
transfer-remaining = { $done } von { $total }
transfer-limit = Limit { $rate }
transfer-unlimited = Kein Limit

## Built-in plugins

plugin-bun-engine-free-roms = Freie ROM-Pakete
