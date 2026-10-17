app-name = Bun OS
nav-games = Jogos
nav-library = Biblioteca
nav-downloads = Downloads
nav-settings = Configurações
nav-power = Energia
action-play = Jogar
action-resume = Retomar
action-restart = Reiniciar
action-return = Voltar ao jogo
action-steam-page = Abrir na Steam
action-open = Abrir
action-game-hub = Central do jogo
action-home = Início
action-close-game = Fechar jogo
action-screenshot = Captura de tela
action-record = Gravar
action-performance = Desempenho
action-frame-limit = Limite de quadros
action-scaling = Escala
action-volume-down = Diminuir volume
action-volume-up = Aumentar volume
action-cancel = Cancelar
action-desktop = Voltar à área de trabalho
action-close-shell = Fechar Bun OS
action-sleep = Suspender
action-restart-pc = Reiniciar o PC
action-shutdown = Desligar
library-count = { $count ->
    [one] { $count } jogo
   *[other] { $count } jogos
}
library-all = Tudo
library-steam = Steam
library-emulators = Emuladores
library-web = Web
library-empty-emulators = Nenhum jogo emulado ainda. Adicione uma pasta de ROMs com bun-engine library add
platform-steam = Steam
platform-steam-not-installed = Steam, não instalada
platform-web = Núcleo web
meta-instant-resume = Retomada instantânea pronta
meta-bun-engine = Bun Engine
meta-last-played = Jogado pela última vez em { $date }
hub-profile = Perfil do jogo
hub-details = Detalhes
hub-suspended-memory = Suspenso na memória: retoma instantaneamente
hub-suspended-disk = Suspenso no disco: retoma de onde você parou
profile-frame-limit = Limite de quadros
profile-scaling = Escala
profile-borderless = Tela cheia sem bordas
profile-instant-resume = Retomada instantânea
profile-performance = Sobreposição de desempenho
value-on = Ativado
value-off = Desativado
value-display-rate = Taxa da tela
value-fps = { $fps } FPS
value-sharp = Nítido (vizinho mais próximo)
value-smooth = Suave (bilinear)
value-fsr1 = FSR 1
value-system = Sistema ({ $mode })
value-reduced = Reduzido
value-full = Completo
value-registered = Registrado
value-not-registered = Não registrado
value-recording = Gravando
downloads-steam = Transferências da Steam
downloads-none = Nenhum download ou atualização em andamento
downloads-packages = Emuladores instalados pelo bep
downloads-progress = { $done } de { $total } GB
settings-console = Console
settings-haptics = Vibração do controle
settings-motion = Movimento reduzido
settings-performance = Sobreposição de desempenho
settings-reload = Recarregar biblioteca
settings-session = Iniciar ao entrar
settings-desktop = Voltar à área de trabalho
settings-system = Sistema
quick-title = Menu rápido
quick-nvidia = NVIDIA
quick-display = Tela e captura
quick-session = Sessão
power-title = Energia
activity-title = Atividade
activity-resume = Retomar
activity-running = Em execução
activity-downloads = Downloads
activity-transfers = { $count ->
    [one] { $count } transferência da Steam
   *[other] { $count } transferências da Steam
}
activity-packages = { $count ->
    [one] { $count } emulador instalado
   *[other] { $count } emuladores instalados
}
activity-last = Jogados recentemente
toast-resumed = { $title } retomado
toast-resumed-disk = { $title } retomado de onde você parou
toast-playing = Jogando { $title }
toast-starting = Iniciando { $title }
toast-starting-steam = Iniciando { $title } na Steam
toast-steam-page = { $title } aberto na Steam
toast-not-launched = { $title } não foi iniciado: { $reason }
toast-suspended = Suspenso. A retomada é instantânea
toast-paused = Pausado. Este sistema não pode salvar o estado
toast-closed = { $title } fechado
toast-screenshot = Captura salva: { $path }
toast-recording = Gravando com { $encoder }
toast-recorded = { $path } gravado com { $encoder }
toast-record-failed = Gravação interrompida: { $error }
toast-record-unavailable = Gravar captura jogos do Bun Engine. Para os outros, use a captura da Steam ou do Windows
toast-close-steam = Feche os jogos da Steam pelo próprio jogo
toast-asked-close = Solicitado o fechamento de { $title }
toast-back-from = De volta de { $title }
toast-not-started = { $title } não foi iniciado
toast-reloaded = Biblioteca recarregada: { $count ->
    [one] { $count } jogo
   *[other] { $count } jogos
}
toast-session = Para iniciar ao entrar, execute: { $command }
toast-start-failed = Não foi possível iniciar o jogo: { $error }
toast-stopped = { $name } parou
toast-cannot-save = Fechado: este sistema não pode salvar o estado
toast-controller = { $name } conectado
busy-steam = O app { $app } da Steam está em execução
busy-stream = { $name } está transmitindo
