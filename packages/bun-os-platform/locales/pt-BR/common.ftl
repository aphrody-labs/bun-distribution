-product = Bun OS
common-unknown-value = -
common-on = Ativado
common-off = Desativado
common-cancel = Cancelar
common-close = Fechar
common-retry = Tentar novamente
common-open = Abrir

## Language and theme pickers

platform-language = Idioma
platform-language-system = Idioma do sistema ({ $name })
platform-theme = Tema
platform-theme-baseline = Tema padrão do { -product }
platform-theme-dynamic = Cores da arte do jogo
platform-contrast = Contraste
platform-contrast-standard = Padrão
platform-contrast-high = Alto
platform-contrast-system = Seguir o sistema
platform-mode-light = Claro
platform-mode-dark = Escuro
platform-mode-system = Sistema

## Plugins

plugins-title = Plugins
plugins-count = { $count ->
    [one] { $count } plugin
   *[other] { $count } plugins
}
plugins-blocked = { $name } está bloqueado: { $reason }
plugins-unpinned = { $name } não está fixado. Execute bun-os-platform plugins pin { $name } para confiar nele.
plugins-permission = { $name } solicita { $permission }

## File types (open, preview, import)

files-open = Abrir
files-import = Importar
files-preview = Pré-visualizar
files-kind-image = Imagem
files-kind-video = Vídeo
files-kind-audio = Áudio
files-kind-rom = Imagem de jogo
files-kind-firmware = Firmware
files-kind-save = Dados salvos
files-kind-archive = Arquivo compactado
files-kind-package = Pacote
files-kind-executable = Programa
files-kind-document = Documento
files-kind-font = Fonte
files-kind-theme = Tema
files-kind-plugin = Plugin
files-kind-unknown = Arquivo desconhecido
files-detected = { $format } ({ $platform }), detectado por { $by }

## Transfers (downloads and uploads)

transfer-title = Transferências
transfer-queued = Na fila
transfer-running = { $percent } a { $rate }
transfer-paused = Pausado em { $percent }
transfer-done = Concluído
transfer-failed = Falha: { $error }
transfer-verifying = Verificando { $algorithm }
transfer-mirror = De { $host }
transfer-lancache = Pelo cache LAN
transfer-pause = Pausar
transfer-resume = Retomar
transfer-remaining = { $done } de { $total }
transfer-limit = Limite { $rate }
transfer-unlimited = Sem limite

## Built-in plugins

plugin-bun-engine-free-roms = Pacotes de ROMs livres
