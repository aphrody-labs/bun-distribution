-product = Bun OS
common-unknown-value = -
common-on = Attivo
common-off = Disattivo
common-cancel = Annulla
common-close = Chiudi
common-retry = Riprova
common-open = Apri

## Language and theme pickers

platform-language = Lingua
platform-language-system = Lingua di sistema ({ $name })
platform-theme = Tema
platform-theme-baseline = Tema di base { -product }
platform-theme-dynamic = Colori dall'immagine del gioco
platform-contrast = Contrasto
platform-contrast-standard = Standard
platform-contrast-high = Alto
platform-contrast-system = Segui il sistema
platform-mode-light = Chiaro
platform-mode-dark = Scuro
platform-mode-system = Sistema

## Plugins

plugins-title = Plugin
plugins-count = { $count ->
    [one] { $count } plugin
   *[other] { $count } plugin
}
plugins-blocked = { $name } è bloccato: { $reason }
plugins-unpinned = { $name } non è fissato. Esegui bun-os-platform plugins pin { $name } per considerarlo attendibile.
plugins-permission = { $name } richiede { $permission }

## File types (open, preview, import)

files-open = Apri
files-import = Importa
files-preview = Anteprima
files-kind-image = Immagine
files-kind-video = Video
files-kind-audio = Audio
files-kind-rom = Immagine di gioco
files-kind-firmware = Firmware
files-kind-save = Dati di salvataggio
files-kind-archive = Archivio
files-kind-package = Pacchetto
files-kind-executable = Programma
files-kind-document = Documento
files-kind-font = Carattere
files-kind-theme = Tema
files-kind-plugin = Plugin
files-kind-unknown = File sconosciuto
files-detected = { $format } ({ $platform }), rilevato da { $by }

## Transfers (downloads and uploads)

transfer-title = Trasferimenti
transfer-queued = In coda
transfer-running = { $percent } a { $rate }
transfer-paused = In pausa al { $percent }
transfer-done = Completato
transfer-failed = Non riuscito: { $error }
transfer-verifying = Verifica { $algorithm }
transfer-mirror = Da { $host }
transfer-lancache = Tramite la cache LAN
transfer-pause = Pausa
transfer-resume = Riprendi
transfer-remaining = { $done } di { $total }
transfer-limit = Limite { $rate }
transfer-unlimited = Nessun limite

## Built-in plugins

plugin-bun-engine-free-roms = Pacchetti di ROM liberi
