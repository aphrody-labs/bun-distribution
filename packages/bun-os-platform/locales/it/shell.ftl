app-name = Bun OS
nav-games = Giochi
nav-library = Libreria
nav-downloads = Download
nav-settings = Impostazioni
nav-power = Alimentazione
action-play = Gioca
action-resume = Riprendi
action-restart = Riavvia
action-return = Torna al gioco
action-steam-page = Apri in Steam
action-open = Apri
action-game-hub = Hub del gioco
action-home = Home
action-close-game = Chiudi gioco
action-screenshot = Screenshot
action-record = Registra
action-performance = Prestazioni
action-frame-limit = Limite fotogrammi
action-scaling = Ridimensionamento
action-volume-down = Abbassa volume
action-volume-up = Alza volume
action-cancel = Annulla
action-desktop = Torna al desktop
action-close-shell = Chiudi Bun OS
action-sleep = Sospendi
action-restart-pc = Riavvia il PC
action-shutdown = Spegni
library-count = { $count ->
    [one] { $count } gioco
   *[other] { $count } giochi
}
library-all = Tutti
library-steam = Steam
library-emulators = Emulatori
library-web = Web
library-empty-emulators = Ancora nessun gioco emulato. Aggiungi una cartella di ROM con bun-engine library add
platform-steam = Steam
platform-steam-not-installed = Steam, non installato
platform-web = Core web
meta-instant-resume = Ripresa istantanea pronta
meta-bun-engine = Bun Engine
meta-last-played = Ultima partita { $date }
hub-profile = Profilo di gioco
hub-details = Dettagli
hub-suspended-memory = Sospeso in memoria: riprende all'istante
hub-suspended-disk = Sospeso su disco: riprende da dove eri rimasto
profile-frame-limit = Limite fotogrammi
profile-scaling = Ridimensionamento
profile-borderless = Schermo intero senza bordi
profile-instant-resume = Ripresa istantanea
profile-performance = Overlay prestazioni
value-on = Attivo
value-off = Disattivo
value-display-rate = Frequenza dello schermo
value-fps = { $fps } fps
value-sharp = Nitido (nearest)
value-smooth = Morbido (bilineare)
value-fsr1 = FSR 1
value-system = Sistema ({ $mode })
value-reduced = Ridotto
value-full = Completo
value-registered = Registrato
value-not-registered = Non registrato
value-recording = Registrazione in corso
downloads-steam = Trasferimenti Steam
downloads-none = Nessun download o aggiornamento in corso
downloads-packages = Emulatori installati da bep
downloads-progress = { $done } di { $total } GB
settings-console = Console
settings-haptics = Vibrazione del controller
settings-motion = Riduci animazioni
settings-performance = Overlay prestazioni
settings-reload = Ricarica libreria
settings-session = Avvia all'accesso
settings-desktop = Torna al desktop
settings-system = Sistema
quick-title = Menu rapido
quick-nvidia = NVIDIA
quick-display = Schermo e acquisizione
quick-session = Sessione
power-title = Alimentazione
activity-title = Attività
activity-resume = Riprendi
activity-running = In esecuzione
activity-downloads = Download
activity-transfers = { $count ->
    [one] { $count } trasferimento Steam
   *[other] { $count } trasferimenti Steam
}
activity-packages = { $count ->
    [one] { $count } emulatore installato
   *[other] { $count } emulatori installati
}
activity-last = Ultima partita
toast-resumed = { $title } ripreso
toast-resumed-disk = { $title } ripreso da dove eri rimasto
toast-playing = In gioco: { $title }
toast-starting = Avvio di { $title }
toast-starting-steam = Avvio di { $title } in Steam
toast-steam-page = { $title } aperto in Steam
toast-not-launched = { $title } non avviato: { $reason }
toast-suspended = Sospeso. La ripresa è istantanea
toast-paused = In pausa. Questo sistema non può salvare il proprio stato
toast-closed = { $title } chiuso
toast-screenshot = Screenshot salvato: { $path }
toast-recording = Registrazione con { $encoder }
toast-recorded = { $path } registrato con { $encoder }
toast-record-failed = Registrazione interrotta: { $error }
toast-record-unavailable = La registrazione acquisisce i giochi Bun Engine. Per gli altri usa l'acquisizione di Steam o Windows
toast-close-steam = Chiudi i giochi Steam dall'interno del gioco
toast-asked-close = Richiesta di chiusura inviata a { $title }
toast-back-from = Di ritorno da { $title }
toast-not-started = { $title } non si è avviato
toast-reloaded = Libreria ricaricata: { $count ->
    [one] { $count } gioco
   *[other] { $count } giochi
}
toast-session = Per avviare all'accesso, esegui: { $command }
toast-start-failed = Impossibile avviare il gioco: { $error }
toast-stopped = { $name } arrestato
toast-cannot-save = Chiuso: questo sistema non può salvare il proprio stato
toast-controller = { $name } connesso
busy-steam = L'app Steam { $app } è in esecuzione
busy-stream = { $name } è in streaming
