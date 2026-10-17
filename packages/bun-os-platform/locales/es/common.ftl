-product = Bun OS
common-unknown-value = -
common-on = Activado
common-off = Desactivado
common-cancel = Cancelar
common-close = Cerrar
common-retry = Reintentar
common-open = Abrir

## Language and theme pickers

platform-language = Idioma
platform-language-system = Idioma del sistema ({ $name })
platform-theme = Tema
platform-theme-baseline = Tema base de { -product }
platform-theme-dynamic = Colores del arte del juego
platform-contrast = Contraste
platform-contrast-standard = Estándar
platform-contrast-high = Alto
platform-contrast-system = Según el sistema
platform-mode-light = Claro
platform-mode-dark = Oscuro
platform-mode-system = Sistema

## Plugins

plugins-title = Complementos
plugins-count = { $count ->
    [one] { $count } complemento
   *[other] { $count } complementos
}
plugins-blocked = { $name } está bloqueado: { $reason }
plugins-unpinned = { $name } no está fijado. Ejecuta bun-os-platform plugins pin { $name } para confiar en él.
plugins-permission = { $name } solicita { $permission }

## File types (open, preview, import)

files-open = Abrir
files-import = Importar
files-preview = Vista previa
files-kind-image = Imagen
files-kind-video = Vídeo
files-kind-audio = Audio
files-kind-rom = Imagen de juego
files-kind-firmware = Firmware
files-kind-save = Datos guardados
files-kind-archive = Archivo comprimido
files-kind-package = Paquete
files-kind-executable = Programa
files-kind-document = Documento
files-kind-font = Fuente
files-kind-theme = Tema
files-kind-plugin = Complemento
files-kind-unknown = Archivo desconocido
files-detected = { $format } ({ $platform }), detectado por { $by }

## Transfers (downloads and uploads)

transfer-title = Transferencias
transfer-queued = En cola
transfer-running = { $percent } a { $rate }
transfer-paused = En pausa al { $percent }
transfer-done = Completado
transfer-failed = Error: { $error }
transfer-verifying = Verificando { $algorithm }
transfer-mirror = Desde { $host }
transfer-lancache = Mediante la caché LAN
transfer-pause = Pausar
transfer-resume = Reanudar
transfer-remaining = { $done } de { $total }
transfer-limit = Límite { $rate }
transfer-unlimited = Sin límite

## Built-in plugins

plugin-bun-engine-free-roms = Paquetes de ROM libres
