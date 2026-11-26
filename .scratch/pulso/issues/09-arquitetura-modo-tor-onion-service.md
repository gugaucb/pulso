# Definir arquitetura do Modo Tor (Onion Service v3 zero-config e purga em disco)

Type: grilling
Status: open
Blocked by: 01, 04, 06, 08

## Question

Com base em [Pesquisa de stack full-stack e empacotamento zero-config do daemon Tor](./01-pesquisa-stack-e-empacotamento-tor.md), [Definir ciclo de vida da Sala, Contador de Inatividade e garantias de zero-rastro](./04-ciclo-de-vida-da-sala-inatividade-e-privacidade.md), [Escolher stack full-stack e modelo de distribuição para Modo Normal e Modo Tor](./06-escolha-da-stack-e-arquitetura-de-distribuicao.md) e [Definir arquitetura do backend em memória, WebSocket e sinalização WebRTC](./08-arquitetura-backend-tempo-real-e-webrtc.md), especificar o ciclo de vida do daemon Tor embutido (`torrc` transitório, ControlPort, leitura do `hostname` `.onion`, UX de bootstrap/erro, bloqueio estrito de vídeo/WebRTC, compatibilidade com Tor Browser e purga garantida de `./tor_data` inclusive em shutdown abrupto).
