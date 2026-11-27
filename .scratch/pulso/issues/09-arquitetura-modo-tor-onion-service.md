# Definir arquitetura do Modo Tor (Onion Service v3 zero-config e purga em disco)

Type: grilling
Status: resolved
Blocked by: 01, 04, 06, 08

## Question

Com base em [Pesquisa de stack full-stack e empacotamento zero-config do daemon Tor](./01-pesquisa-stack-e-empacotamento-tor.md), [Definir ciclo de vida da Sala, Contador de Inatividade e garantias de zero-rastro](./04-ciclo-de-vida-da-sala-inatividade-e-privacidade.md), [Escolher stack full-stack e modelo de distribuição para Modo Normal e Modo Tor](./06-escolha-da-stack-e-arquitetura-de-distribuicao.md) e [Definir arquitetura do backend em memória, WebSocket e sinalização WebRTC](./08-arquitetura-backend-tempo-real-e-webrtc.md), especificar o ciclo de vida do daemon Tor embutido (`torrc` transitório, ControlPort, leitura do `hostname` `.onion`, UX de bootstrap/erro, bloqueio estrito de vídeo/WebRTC, compatibilidade com Tor Browser e purga garantida de `./tor_data` inclusive em shutdown abrupto).

## Answer

Decisões consolidadas na especificação da Fase 2 ([spec.md](../../pulso-backend/spec.md)):

- **Launcher local integrado (`start:tor`):** acopla o servidor Fastify escutando apenas em `127.0.0.1` à fronteira testável `TorController`, abrindo a aplicação para o **Anfitrião** no navegador local enquanto expõe o Onion Service para o **Convidado** via Tor Browser.
- **Resolução do binário `tor`:** ordem `PULSO_TOR_BIN` (variável de ambiente) → `./bin/tor` (Tor Expert Bundle local) → `tor` no `PATH`, acompanhado de script auxiliar documentado para obtenção e verificação de integridade do Tor Expert Bundle.
- **Configuração transitória e criação efêmera:** daemon iniciado com `SocksPort 0`, `ControlPort auto`, `ControlPortWriteToFile`, `CookieAuthentication 1` (`SAFECOOKIE` via HMAC-SHA256), `AvoidDiskWrites 1` e `DataDirectory ./tor_data`. O Onion Service v3 é provisionado via `ADD_ONION NEW:ED25519-V3 Flags=DiscardPK Port=80,127.0.0.1:<porta_local>` (garantindo que a chave privada `.onion` nunca seja escrita em disco), aguardando `BOOTSTRAP 100%` e `HS_DESC UPLOADED` antes de liberar o link `<56-chars>.onion`.
- **Purga dupla garantida de `./tor_data`:** remoção preventiva no startup antes de iniciar um novo daemon e remoção ativa no encerramento ou expiração da **Sala** (`DEL_ONION` + `SIGNAL SHUTDOWN` via ControlPort + remoção recursiva forçada de `./tor_data`), inclusive em handlers de `SIGINT` e `SIGTERM`.
- **Runtime honesto (`GET /api/runtime`):** retorna `{ runtimeMode, onionAddress?, torStatus? }`. Em instância **Modo Normal**, selecionar **Modo Tor** na entrada orienta transparentemente a execução do launcher local sem gerar `.onion` falso; em instância **Modo Tor** (ou acessada via `.onion`), a interface trava o modo em **Modo Tor** com o endereço `.onion` real preenchido automaticamente e **Chamada de Vídeo** bloqueada.
