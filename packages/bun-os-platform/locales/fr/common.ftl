-product = Bun OS
common-unknown-value = -
common-on = Activé
common-off = Désactivé
common-cancel = Annuler
common-close = Fermer
common-retry = Réessayer
common-open = Ouvrir

## Langue et thème

platform-language = Langue
platform-language-system = Langue du système ({ $name })
platform-theme = Thème
platform-theme-baseline = Thème de base { -product }
platform-theme-dynamic = Couleurs tirées de l'illustration du jeu
platform-contrast = Contraste
platform-contrast-standard = Standard
platform-contrast-high = Élevé
platform-contrast-system = Suivre le système
platform-mode-light = Clair
platform-mode-dark = Sombre
platform-mode-system = Système

## Extensions

plugins-title = Extensions
plugins-count = { $count ->
    [one] { $count } extension
   *[other] { $count } extensions
}
plugins-blocked = { $name } est bloquée : { $reason }
plugins-unpinned = { $name } n'est pas épinglée. Lancez bun-os-platform plugins pin { $name } pour lui faire confiance.
plugins-permission = { $name } demande { $permission }

## Types de fichiers

files-open = Ouvrir
files-import = Importer
files-preview = Aperçu
files-kind-image = Image
files-kind-video = Vidéo
files-kind-audio = Audio
files-kind-rom = Image de jeu
files-kind-firmware = Firmware
files-kind-save = Sauvegarde
files-kind-archive = Archive
files-kind-package = Paquet
files-kind-executable = Programme
files-kind-document = Document
files-kind-font = Police
files-kind-theme = Thème
files-kind-plugin = Extension
files-kind-unknown = Fichier inconnu
files-detected = { $format } ({ $platform }), détecté par { $by }

## Transferts

transfer-title = Transferts
transfer-queued = En file d'attente
transfer-running = { $percent } à { $rate }
transfer-paused = En pause à { $percent }
transfer-done = Terminé
transfer-failed = Échec : { $error }
transfer-verifying = Vérification { $algorithm }
transfer-mirror = Depuis { $host }
transfer-lancache = Par le cache LAN
transfer-pause = Pause
transfer-resume = Reprendre
transfer-remaining = { $done } sur { $total }
transfer-limit = Limite { $rate }
transfer-unlimited = Sans limite

## Built-in plugins

plugin-bun-engine-free-roms = Packs de ROM libres
