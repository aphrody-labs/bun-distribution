app-name = Bun OS
nav-games = Juegos
nav-library = Biblioteca
nav-downloads = Descargas
nav-settings = Ajustes
nav-power = Energía
action-play = Jugar
action-resume = Reanudar
action-restart = Reiniciar
action-return = Volver al juego
action-steam-page = Abrir en Steam
action-open = Abrir
action-game-hub = Centro del juego
action-home = Inicio
action-close-game = Cerrar juego
action-screenshot = Captura de pantalla
action-record = Grabar
action-performance = Rendimiento
action-frame-limit = Límite de fotogramas
action-scaling = Escalado
action-volume-down = Bajar volumen
action-volume-up = Subir volumen
action-cancel = Cancelar
action-desktop = Volver al escritorio
action-close-shell = Cerrar Bun OS
action-sleep = Suspender
action-restart-pc = Reiniciar el PC
action-shutdown = Apagar
library-count = { $count ->
    [one] { $count } juego
   *[other] { $count } juegos
}
library-all = Todo
library-steam = Steam
library-emulators = Emuladores
library-web = Web
library-empty-emulators = Aún no hay juegos emulados. Añade una carpeta de ROM con bun-engine library add
platform-steam = Steam
platform-steam-not-installed = Steam, no instalado
platform-web = Núcleo web
meta-instant-resume = Reanudación instantánea lista
meta-bun-engine = Bun Engine
meta-last-played = Última partida: { $date }
hub-profile = Perfil del juego
hub-details = Detalles
hub-suspended-memory = Suspendido en memoria: se reanuda al instante
hub-suspended-disk = Suspendido en disco: se reanuda donde lo dejaste
profile-frame-limit = Límite de fotogramas
profile-scaling = Escalado
profile-borderless = Pantalla completa sin bordes
profile-instant-resume = Reanudación instantánea
profile-performance = Superposición de rendimiento
value-on = Activado
value-off = Desactivado
value-display-rate = Frecuencia de la pantalla
value-fps = { $fps } FPS
value-sharp = Nítido (vecino más cercano)
value-smooth = Suave (bilineal)
value-fsr1 = FSR 1
value-system = Sistema ({ $mode })
value-reduced = Reducido
value-full = Completo
value-registered = Registrado
value-not-registered = No registrado
value-recording = Grabando
downloads-steam = Transferencias de Steam
downloads-none = No hay descargas ni actualizaciones en curso
downloads-packages = Emuladores instalados por bep
downloads-progress = { $done } de { $total } GB
settings-console = Consola
settings-haptics = Vibración del mando
settings-motion = Movimiento reducido
settings-performance = Superposición de rendimiento
settings-reload = Recargar biblioteca
settings-session = Iniciar al iniciar sesión
settings-desktop = Volver al escritorio
settings-system = Sistema
quick-title = Menú rápido
quick-nvidia = NVIDIA
quick-display = Pantalla y captura
quick-session = Sesión
power-title = Energía
activity-title = Actividad
activity-resume = Reanudar
activity-running = En ejecución
activity-downloads = Descargas
activity-transfers = { $count ->
    [one] { $count } transferencia de Steam
   *[other] { $count } transferencias de Steam
}
activity-packages = { $count ->
    [one] { $count } emulador instalado
   *[other] { $count } emuladores instalados
}
activity-last = Jugado recientemente
toast-resumed = { $title } reanudado
toast-resumed-disk = { $title } reanudado donde lo dejaste
toast-playing = Jugando a { $title }
toast-starting = Iniciando { $title }
toast-starting-steam = Iniciando { $title } en Steam
toast-steam-page = { $title } abierto en Steam
toast-not-launched = No se inició { $title }: { $reason }
toast-suspended = Suspendido. Al reanudar, continúa al instante
toast-paused = En pausa. Este sistema no puede guardar su estado
toast-closed = { $title } cerrado
toast-screenshot = Captura guardada: { $path }
toast-recording = Grabando con { $encoder }
toast-recorded = Grabado { $path } con { $encoder }
toast-record-failed = Grabación detenida: { $error }
toast-record-unavailable = Grabar captura juegos de Bun Engine. Para los demás, usa la captura de Steam o de Windows
toast-close-steam = Cierra los juegos de Steam desde el propio juego
toast-asked-close = Se ha pedido a { $title } que se cierre
toast-back-from = De vuelta de { $title }
toast-not-started = { $title } no se inició
toast-reloaded = Biblioteca recargada: { $count ->
    [one] { $count } juego
   *[other] { $count } juegos
}
toast-session = Para iniciar al iniciar sesión, ejecuta: { $command }
toast-start-failed = No se pudo iniciar el juego: { $error }
toast-stopped = { $name } detenido
toast-cannot-save = Cerrado: este sistema no puede guardar su estado
toast-controller = { $name } conectado
busy-steam = La aplicación de Steam { $app } está en ejecución
busy-stream = { $name } está transmitiendo
