# Pesquisa: Stack Full-Stack e Empacotamento Zero-Config do Daemon Tor para o PULSO

> **Ticket:** [01-pesquisa-stack-e-empacotamento-tor.md](../issues/01-pesquisa-stack-e-empacotamento-tor.md)
> **Escopo:** Comparação baseada em fontes primárias das combinações de stack para entrega em duas fases (Fase 1 SPA interativa desacoplada → Fase 2 backend mínimo em RAM) e das opções de empacotamento local zero-config para Onion Service v3, purga de `./tor_data` e proteção nativa anti-captura de tela.

---

## Recomendação Executiva

1. **Stack Full-Stack:** **React + TypeScript + Vite (SPA)** no frontend, com camada de transporte e sinalização desacoplada por interface na Fase 1, pareado na Fase 2 com **Node.js + Fastify + `@fastify/websocket` + `@fastify/static`** (ou Hono com `@hono/node-server` + `ws`).
   - O `dist/` estático gerado pelo Vite funciona de forma idêntica no **Modo Normal** (servido pelo Fastify em servidor stateless) e no **Modo Tor** (servido localmente em `127.0.0.1` via backend embutido ou empacotamento desktop).
   - **Next.js** deve ser descartado para este caso de uso: App Router com `output: 'export'` proíbe rotas de servidor/API e custom servers, enquanto custom servers com WebSocket impedem deploy estático/serverless e adicionam complexidade de SSR sem benefício para um chat 100% E2EE client-side sem persistência.
2. **Daemon Tor (Onion Service v3):** **Tor Expert Bundle (C-Tor)** controlado via **ControlPort (`ControlPort auto` + `SAFECOOKIE`)** usando **`ADD_ONION NEW:ED25519-V3 Flags=DiscardPK`** e eventos **`STATUS_CLIENT` / `HS_DESC`**, com `DataDirectory` isolado em `./tor_data` e purga garantida no encerramento e no boot seguinte.
   - **Arti (Rust)** já suporta Onion Service v3 (`tor-hsservice` / `TorClient::launch_onion_service`), mas ainda não implementa o protocolo clássico `ControlPort` e mantém `ArtiEphemeralKeystore` como feature **experimental**, além de ter histórico mais curto de hardening/PoW em produção frente ao C-Tor.
3. **Empacotamento Local Zero-Config do Modo Tor:**
   - **Se a prioridade for proteção nativa de janela anti-captura de tela no Anfitrião (Windows/macOS) com binário enxuto:** **Tauri v2** (`externalBin` para o Tor Expert Bundle, `Window::set_content_protected(true)`, `RunEvent::Exit` + process group / Job Object no `tauri-plugin-shell`). Como o **Modo Tor** desabilita Chamada de Vídeo por decisão de escopo, a fragilidade histórica de WebRTC no `WebKitGTK` (Linux) não afeta o Modo Tor; ainda assim, se o mesmo pacote desktop for usado no Modo Normal com vídeo no Linux, **Electron** (`BrowserWindow.setContentProtection` + `extraResources` + Chromium uniforme) oferece WebRTC idêntico nas três plataformas ao custo de ~80–150+ MB extras de runtime.
   - **Se o Anfitrião puder usar o navegador padrão em `http://127.0.0.1:<porta>` (sem proteção nativa de janela SO, apenas mitigação web):** um **binário único em Go** (`embed.FS` do `dist/` Vite + `net/http` + `coder/websocket` + gerenciador ControlPort do Tor Expert Bundle) entrega o menor atrito de distribuição cross-platform, sem runtime Node.js externo e sem limitações de assets/addons do Node.js SEA.

---

## Parte 1: Comparação de Stack Full-Stack (Fase 1 → Fase 2)

### Requisitos do PULSO que guiam a escolha
- **Fase 1:** Frontend completo, responsivo, i18n (`pt-br`, `en`, `es`, `zh-CN`), Web Crypto API (`crypto.subtle`), WebRTC (`RTCPeerConnection` / `getUserMedia`) e transporte desacoplado (pronto para conectar ao backend real sem refatorar a UI).
- **Fase 2:** Backend mínimo em RAM (HTTP estático + WebSocket para mensagens cifradas e sinalização WebRTC + controle do contador de inatividade/expiração em memória), sem banco de dados.
- **Contexto Seguro:** Tanto `SubtleCrypto` quanto `navigator.mediaDevices.getUserMedia` exigem **Secure Context** (`https://`, `http://localhost`, `http://127.0.0.1` — e, no Tor Browser, `.onion` tratado como origem potencialmente confiável) conforme a especificação W3C Secure Contexts ([W3C Secure Contexts](https://w3c.github.io/webappsec-secure-contexts/), [MDN Secure Contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts), [MDN SubtleCrypto](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto), [MDN RTCPeerConnection](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection)).

### Análise das combinações

#### 1. React + Vite (TypeScript SPA) + Node.js (Fastify + `@fastify/websocket` ou Hono + `ws`)
- **Frontend (Fase 1):** O Vite compila o app React/TS diretamente para um diretório `dist/` puramente estático (`HTML/CSS/JS`) com assets versionados por hash e fallback SPA simples ([Vite Build Guide](https://vite.dev/guide/build), [Vite Static Assets](https://vite.dev/guide/assets), [React](https://react.dev/)). Na Fase 1, todo o ciclo de criptografia E2EE (Web Crypto API) e a máquina de estados da Sala rodam no navegador atrás de uma abstração de transporte (`RoomTransport`), permitindo testar localmente (inclusive entre abas via `BroadcastChannel`/mock em memória) sem backend.
- **Backend Fastify (Fase 2):** O plugin oficial `@fastify/websocket` envolve a biblioteca `ws` diretamente nas rotas do Fastify, preservando hooks de ciclo de vida pré-upgrade (`onRequest`, `preValidation`, `preHandler`) para validar tokens/identificadores de sala antes do upgrade WebSocket ([Fastify Ecosystem](https://fastify.dev/ecosystem/), [fastify-websocket](https://github.com/fastify/fastify-websocket), [ws](https://github.com/websockets/ws)). Com `@fastify/static`, o mesmo processo Node serve o `dist/` do Vite e o endpoint `/ws` na mesma porta/origem — essencial tanto para deploy simples no Modo Normal quanto para expor **uma única porta HTTP/WS** atrás do Onion Service no Modo Tor ([fastify-static](https://github.com/fastify/fastify-static)).
- **Alternativa Hono + `@hono/node-server` + `ws`:** Em Node.js, `@hono/node-ws` foi depreciado e o suporte a WebSocket passou para `upgradeWebSocket` em `@hono/node-server` combinado com `WebSocketServer({ noServer: true })` de `ws` ([Hono Node.js](https://hono.dev/docs/getting-started/nodejs), [Hono WebSocket Helper](https://hono.dev/docs/helpers/websocket)). É viável e leve, porém exige configurar o `WebSocketServer` manualmente fora do roteador, enquanto no Fastify `@fastify/websocket` já encapsula o ciclo HTTP+WS nativamente.

#### 2. Next.js (App Router)
- **Conflito arquitetural com WebSockets + Static Export:** A documentação oficial do Next.js estabelece que `output: 'export'` gera apenas arquivos estáticos em `/out` e **não suporta** funcionalidades que exigem servidor Node.js, incluindo Route Handlers dinâmicos e Custom Servers ([Next.js Static Exports](https://nextjs.org/docs/app/guides/static-exports)).
- **Limitação de WebSockets no servidor padrão:** Next.js não possui suporte embutido a servidor WebSocket persistente no `next start` / deploys serverless; exigir WebSocket no mesmo processo obriga criar um **Custom Server** Node.js (`http.createServer` + `ws`), o que desabilita otimizações de plataforma/serverless e exige manter um servidor Node dedicado de qualquer forma ([Next.js Custom Server](https://nextjs.org/docs/app/guides/custom-server)).
- **Overhead sem ganho para o PULSO:** O PULSO é uma aplicação 1:1 efêmera, sem contas, sem SEO de conteúdo privado e com E2EE no cliente. SSR/RSC e hidratação apenas aumentam a superfície de complexidade (e exigem marcar componentes criptográficos/WebRTC com `'use client'`) sem oferecer vantagens sobre uma SPA Vite.

#### 3. React + Vite (SPA) + Backend Go (`net/http` + `coder/websocket`) ou Rust (`axum`)
- **Go (`net/http` + `github.com/coder/websocket` + `embed.FS`):** Permite embutir o `dist/` gerado pelo Vite diretamente no binário final via diretiva `//go:embed` (`embed.FS`), servir a SPA com `http.FileServer(http.FS(...))` e aceitar conexões WebSocket no mesmo `ServeMux` via `websocket.Accept(w, r, opts)` integrado a `context.Context` ([Go `embed`](https://pkg.go.dev/embed), [Go `net/http`](https://pkg.go.dev/net/http), [coder/websocket](https://pkg.go.dev/github.com/coder/websocket)).
- **Rust (`axum` + `axum::extract::ws::WebSocketUpgrade`):** Oferece extrator nativo `WebSocketUpgrade` (feature `ws` do `axum`) com limites configuráveis (`max_message_size`) e consumo baixo de RAM ([axum::extract::ws](https://docs.rs/axum/latest/axum/extract/ws/index.html)).
- **Trade-off vs. Node.js/Fastify:** Em produtividade de Fase 2 para o Modo Normal, Node.js/TypeScript compartilha tipos e esquemas de mensagens/sinalização com o frontend React/TS. Já Go (ou Rust dentro do Tauri) brilha especificamente quando o objetivo é **distribuir o executável local zero-config** com a SPA embutida e sem depender de runtime Node instalado.

### Matriz Comparativa — Stack Full-Stack

| Critério | React + Vite (SPA) + Fastify (`@fastify/websocket`) | Next.js (App Router + Custom Server) | React + Vite (SPA) + Go (`net/http` + `coder/websocket`) | React + Vite (SPA) + Rust (`axum`) |
| :--- | :--- | :--- | :--- | :--- |
| **Aderência à Fase 1 (SPA pura e desacoplada)** | **Excelente** (`dist/` estático puro, zero acoplamento SSR) | **Baixa/Média** (`output: 'export'` conflita com custom server) | **Excelente** (mesmo `dist/` Vite servido por `embed.FS`) | **Excelente** (mesmo `dist/` Vite servido por binário Rust) |
| **WebSocket + Sinalização WebRTC na mesma porta** | **Nativo** via `@fastify/websocket` (`ws`) + `@fastify/static` | **Requer Custom Server** manual (incompatível com serverless/export) | **Nativo** (`net/http` + `coder/websocket` + `embed.FS`) | **Nativo** (`axum::extract::ws` + `tower-http`) |
| **Compartilhamento de tipos TS Front ↔ Back** | **Sim** (monorepo TS único) | **Sim** (mas acoplado ao ciclo Next) | **Não** (precisa contrato JSON/schema compartilhado) | **Não** (precisa contrato JSON/schema compartilhado) |
| **Consumo mínimo de RAM no servidor** | Baixo (~30–60 MB Node) | Alto (~80–150+ MB Next server) | **Muito baixo** (~10–25 MB) | **Mínimo** (~5–15 MB) |
| **Reaproveitamento no Modo Tor local** | Alto (mesmo backend TS empacotado, ou trocado por wrapper local) | **Ruim** (pesado e complexo para empacotar localmente) | **Excelente** (binário único cross-compile + `embed.FS`) | **Excelente** (integra direto no backend Rust do Tauri v2) |

---

## Parte 2: Empacotamento Local Zero-Config do Daemon Tor (Onion Service v3)

### 1. Tor Expert Bundle (C-Tor) vs. Arti (Implementação Rust oficial)

| Aspecto | Tor Expert Bundle (C-Tor) | Arti (Rust — `tpo/core/arti`) |
| :--- | :--- | :--- |
| **Status de Onion Service v3 (servidor)** | **Maduro e padrão de produção** (v3 Ed25519 + PoW Equi-X anti-DoS desde Tor 0.4.8+). | **Suportado (`tor_hsservice` / `TorClient::launch_onion_service`, Arti 1.2.0+ e série 2.x até 2.8.0)**, com Vanguards (1.2.2+), restricted discovery (1.7.0+) e Unix sockets/CGO experimental (2.5.1+), porém ainda em evolução contínua e com avisos de atualização de segurança frequentes ([Arti 1.2.0](https://blog.torproject.org/arti_1_2_0_released/), [Arti 2.5.1](https://blog.torproject.org/arti_2_5_1_released/), [Arti 2.8.0](https://blog.torproject.org/arti_2_8_0_released/), [tor_hsservice docs](https://tpo.pages.torproject.net/core/rust/tor_hsservice/)). |
| **Protocolo de controle externo** | **`ControlPort` + `SAFECOOKIE` + `ADD_ONION`** documentado em `control-spec` ([Tor Control Spec](https://spec.torproject.org/control-spec/index.html)). | **Não implementa o `ControlPort` legado**; usa `arti.toml`, embedding em Rust (`arti-client`) ou sistema RPC próprio em evolução ([Arti Docs](https://tpo.pages.torproject.net/core/arti/), [TorClient docs](https://tpo.pages.torproject.net/core/rust/arti_client/struct.TorClient.html)). |
| **Chaves efêmeras 100% em RAM** | **Estável:** `ADD_ONION NEW:ED25519-V3 Flags=DiscardPK` não grava chave privada em disco. | `ArtiEphemeralKeystore` (feature `ephemeral-keystore`) é explicitamente marcado como **experimental** e instável entre versões; o keystore padrão (`ArtiNativeKeystore`) grava em disco e aplica checagens estritas `fs-mistrust` (sensíveis a ACLs no Windows) ([Arti Docs](https://tpo.pages.torproject.net/core/arti/)). |
| **Distribuição oficial multiplataforma** | **Sim:** Tor Expert Bundle oficial para Windows (`x86_64`, `i686`), macOS (`aarch64`, `x86_64`) e Linux (`x86_64`, `aarch64`) com binário `tor`, transportes plugáveis, GeoIP e assinaturas `.asc` ([Tor Download](https://www.torproject.org/download/tor/)). | Exige compilar/embutir o binário `arti` ou linkar `arti-client` no build Rust para cada target. |

**Conclusão Tor vs. Arti:** O **Tor Expert Bundle (C-Tor)** é a escolha mais confiável hoje para o PULSO, pois oferece binários oficiais assinados para todas as plataformas-alvo, `ADD_ONION` efêmero estável sem escrita de chave privada em disco e telemetria determinística via ControlPort.

---

### 2. Gerenciamento prático do Tor Expert Bundle (Zero-Config + Efêmero)

#### A. `torrc` transitório e flags de isolamento
Segundo o manual oficial do Tor (`tor(1)` / `torrc(5)`), o processo filho pode ser iniciado apontando para um `torrc` gerado dinamicamente em tempo de execução (ou flags CLI) com diretório de dados isolado ([Tor Manual](https://2019.www.torproject.org/docs/tor-manual.html.en)):
```text
DataDirectory ./tor_data
SocksPort 0
ControlPort auto
ControlPortWriteToFile ./tor_data/control.port
CookieAuthentication 1
CookieAuthFile ./tor_data/control_auth_cookie
AvoidDiskWrites 1
```
- `SocksPort 0` desativa o proxy SOCKS local quando o Anfitrião atua apenas como servidor `.onion`, evitando conflito com instâncias do Tor Browser na mesma máquina.
- `ControlPort auto` + `ControlPortWriteToFile` evita colisões de porta local (`9051` ocupada) ([Tor Control Spec](https://spec.torproject.org/control-spec/index.html)).
- `CookieAuthentication 1` + `CookieAuthFile` protege o ControlPort por leitura local do cookie; o controlador deve autenticar preferencialmente via **`SAFECOOKIE`** (challenge-response HMAC-SHA256) ([Tor Control Spec](https://spec.torproject.org/control-spec/index.html)).

#### B. Criação do Onion Service v3: `ADD_ONION` (recomendado) vs. `HiddenServiceDir`
- **Via `ADD_ONION` (ControlPort §3.27 — recomendado):**
  Após autenticar no ControlPort, o controlador envia:
  `ADD_ONION NEW:ED25519-V3 Flags=DiscardPK Port=80,127.0.0.1:<porta_local>` ([Tor Control Spec](https://spec.torproject.org/control-spec/index.html)).
  - Tor responde `250-ServiceID=<56-chars>` (o endereço é `<ServiceID>.onion`).
  - **Vantagem crítica de privacidade:** Com `Flags=DiscardPK`, a chave privada Ed25519 do Onion Service permanece apenas na RAM do daemon Tor em execução e nunca é gravada no disco nem devolvida ao controlador; quando o daemon termina (ou recebe `DEL_ONION <ServiceID>`), a identidade `.onion` desaparece irreversivelmente.
- **Via `HiddenServiceDir` (alternativa em `torrc`):**
  Configurar `HiddenServiceDir ./tor_data/hs` + `HiddenServiceVersion 3` + `HiddenServicePort 80 127.0.0.1:<porta_local>` faz o Tor gravar `hostname`, `hs_ed25519_public_key` e `hs_ed25519_secret_key` no disco ([Tor Manual](https://2019.www.torproject.org/docs/tor-manual.html.en), [Tor v3 Rend Spec](https://spec.torproject.org/rend-spec/index.html)). Funciona sem implementar cliente ControlPort completo (basta aguardar o arquivo `hostname`), mas **exige purga rigorosa** porque grava o segredo `.onion` no filesystem.

#### C. Monitoramento de prontidão (`BOOTSTRAP` e `HS_DESC`)
Antes de liberar o link `.onion` para o Anfitrião compartilhar com o Convidado:
1. Subscrever eventos via `SETEVENTS STATUS_CLIENT HS_DESC` ou consultar `GETINFO status/bootstrap-phase` até `PROGRESS=100` (`BOOTSTRAP` concluído) ([Tor Control Spec](https://spec.torproject.org/control-spec/index.html)).
2. Aguardar eventos assíncronos `650 HS_DESC UPLOADED ...` para confirmar que o descritor v3 foi publicado nos HSDirs — reduzindo falhas de "Onionsite Not Found" caso o Convidado tente abrir imediatamente ([Tor Control Spec](https://spec.torproject.org/control-spec/index.html)).

#### D. Purga garantida de `./tor_data` e Shutdown Limpo
- **POSIX (macOS / Linux):** Enviar `SIGNAL SHUTDOWN` pelo ControlPort (ou `SIGTERM` ao processo `tor`), aguardar saída (`exit`), e remover recursivamente `./tor_data` (`fs.rm(..., { recursive: true, force: true })` / `std::fs::remove_dir_all`).
- **Armadilha crítica no Windows:** Segundo a documentação oficial do Node.js `child_process`, POSIX signals **não existem no Windows**: chamar `child.kill('SIGTERM')` invoca `TerminateProcess` de forma abrupta e não aciona handlers de `SIGTERM` ([Node.js child_process](https://nodejs.org/api/child_process.html)). Além disso, processos filhos podem virar órfãos em crashes.
  - **Mitigação obrigatória:**
    1. Preferir `SIGNAL SHUTDOWN` via socket TCP do ControlPort antes de encerrar o processo, pois funciona identicamente em Windows, macOS e Linux.
    2. Em Tauri v2, usar `tauri-plugin-shell` com agrupamento de processos (`set_process_group(true)` / Windows **Job Object** com `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`) e hook `RunEvent::Exit` / `RunEvent::ExitRequested` para garantir morte da árvore de processos mesmo se o app principal cair ([Tauri RunEvent](https://docs.rs/tauri/latest/tauri/enum.RunEvent.html), [Tauri Sidecar](https://v2.tauri.app/develop/sidecar/)). Em Node/Electron, usar `app.on('before-quit', ...)` e fechar o ControlPort/processo filho ([Electron app](https://www.electronjs.org/docs/latest/api/app)).
    3. **Purga defensiva no boot:** Além de apagar `./tor_data` no shutdown normal e no timeout da Sala, sempre apagar qualquer `./tor_data` residual **ao iniciar** o launcher antes de subir um novo daemon Tor (protege contra `SIGKILL`, BSOD ou queda de energia).

---

## Parte 3: Proteção Nativa Anti-Captura de Tela e WebViews por Plataforma

| Plataforma | Electron (`win.setContentProtection(true)`) | Tauri v2 (`Window::set_content_protected(true)` / `contentProtected: true`) | CLI / Binário Local + Navegador |
| :--- | :--- | :--- | :--- |
| **Windows** | **Suportado:** usa `SetWindowDisplayAffinity` (`WDA_EXCLUDEFROMCAPTURE` no Win10 2004+, ou `WDA_MONITOR` em versões antigas) ([Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)). | **Suportado:** via `tao`, usa `SetWindowDisplayAffinity` com comportamento equivalente ([tao Window](https://docs.rs/tao/latest/tao/window/struct.Window.html), [Tauri Window JS API](https://v2.tauri.app/reference/javascript/api/namespacewindow/)). | **Não disponível** (apenas mitigações web best-effort). |
| **macOS** | **Suportado com ressalva:** define `NSWindowSharingNone`; ferramentas modernas baseadas em `ScreenCaptureKit` ainda podem capturar em certos cenários ([Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)). | **Suportado com ressalva:** define restrição de compartilhamento em `NSWindow` via `tao` (sujeito às mesmas restrições de APIs modernas do macOS) ([tao Window](https://docs.rs/tao/latest/tao/window/struct.Window.html)). | **Não disponível**. |
| **Linux (X11 / Wayland)** | **Não suportado** (sem efeito no X11 e Wayland) ([Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)). | **Não suportado / não confiável** devido à arquitetura dos compositores X11/Wayland ([Tauri Window JS API](https://v2.tauri.app/reference/javascript/api/namespacewindow/), [tao Window](https://docs.rs/tao/latest/tao/window/struct.Window.html)). | **Não disponível**. |

> **Observação importante para o PULSO:** No Electron, `setContentProtection` entra em vigor na próxima composição da área de trabalho e deve ser aplicado a **cada janela** criada ([Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)). No Tauri v2, habilitar pelo frontend requer declarar a permissão `core:window:allow-set-content-protected` em `capabilities` ([Tauri Capabilities](https://v2.tauri.app/security/capabilities/), [Tauri Config](https://v2.tauri.app/reference/config/)).

---

## Parte 4: Comparação das Opções de Empacotamento Local Zero-Config

#### Opção A: Tauri v2 (`externalBin` sidecar)
- **Mecanismo:** Empacota os binários do Tor Expert Bundle em `src-tauri/binaries/tor-<target-triple>` via `bundle.externalBin` ([Tauri Sidecar](https://v2.tauri.app/develop/sidecar/)). O backend Rust do Tauri sobe o servidor HTTP/WS local (ex.: `axum` em `127.0.0.1:0` ou porta livre), inicia o sidecar `tor`, conecta no ControlPort e aplica `set_content_protected(true)` na janela.
- **Tamanho do pacote:** Binário base mínimo ~3–15 MB (usa `WKWebView` no macOS, `WebView2` no Windows e `WebKitGTK` no Linux) + arquivos do Tor Expert Bundle ([Tauri Sidecar](https://v2.tauri.app/develop/sidecar/)).
- **Pegadinha crítica de WebRTC no Linux:** Enquanto macOS (`WKWebView`) e Windows (`WebView2`/Chromium) suportam WebRTC nativamente, o `WebKitGTK` no Linux implementa WebRTC via **GStreamer** (`webrtcbin`) e depende de flags (`enable-webrtc`) e plugins GStreamer/PipeWire instalados na distro do usuário ([WebKitGTK Settings](https://webkitgtk.org/reference/webkit2gtk/stable/class.Settings.html), [wry #85](https://github.com/tauri-apps/wry/issues/85), [Tauri #8426](https://github.com/tauri-apps/tauri/discussions/8426)). **Impacto no PULSO:** como o **Modo Tor não usa WebRTC** (apenas texto E2EE), o Tauri v2 funciona de forma sólida se o app desktop for dedicado ao Modo Tor (ou chat texto); já se o usuário usar o app Tauri no Linux para **Chamada de Vídeo** no Modo Normal, pode enfrentar incompatibilidades por distro.

#### Opção B: Electron (`extraResources` + `child_process`)
- **Mecanismo:** Inclui o Tor Expert Bundle fora do `app.asar` via `extraResource` (acessível em produção via `process.resourcesPath`) e inicia o daemon via `child_process.spawn` no Main Process ([Electron Forge Config](https://www.electronforge.io/config/configuration), [Electron process.resourcesPath](https://www.electronjs.org/docs/latest/api/process)). O mesmo Main Process pode rodar o Fastify em `127.0.0.1` e gerenciar `BrowserWindow.setContentProtection(true)`.
- **Tamanho do pacote:** ~80–150+ MB só para Chromium + Node.js, somados ao Tor Expert Bundle.
- **Vantagem:** Runtime Chromium idêntico em macOS, Windows e Linux — **garante** comportamento uniforme de `SubtleCrypto`, `RTCPeerConnection` e `getUserMedia` nas três plataformas, além de aproveitar o mesmo backend Fastify/Node da Fase 2.

#### Opção C: CLI / Binário Local Único (Go vs. Node.js SEA vs. `pkg`)
- **`vercel/pkg`:** **Descartado** — o repositório oficial foi **depreciado e arquivado** na v5.8.1 ([vercel/pkg](https://github.com/vercel/pkg)).
- **Node.js SEA (Single Executable Applications):** Recurso nativo do Node.js, porém a documentação oficial documenta restrições práticas importantes: addons nativos (`.node`) não carregam do VFS sem extração em disco, `sea.getRawAsset()` não é gravável e há armadilhas de build por plataforma (ex.: ELF em containers Linux arm64) além do binário herdar todo o runtime Node/V8 ([Node.js SEA](https://nodejs.org/api/single-executable-applications.html)).
- **Binário Go (`embed.FS` + `net/http` + `coder/websocket` + Tor Expert Bundle):** Compila para um único executável nativo pequeno, embute o `dist/` do Vite sem dependências de runtime, extrai/executa o Tor Expert Bundle em diretório temporário isolado e abre `http://127.0.0.1:<porta>` no navegador do usuário (que é Secure Context pela W3C spec). **Limitação:** não oferece proteção nativa de janela (`setContentProtection`), pois a UI roda no navegador comum.

### Matriz Comparativa — Empacotamento Zero-Config do Modo Tor

| Critério | Tauri v2 + Tor Expert Bundle | Electron + Tor Expert Bundle | Binário CLI Go + Tor Expert Bundle | Node.js SEA + Tor Expert Bundle |
| :--- | :--- | :--- | :--- | :--- |
| **Proteção nativa anti-captura** | **Sim** (Win / macOS) | **Sim** (Win / macOS) | **Não** (navegador) | **Não** (navegador) |
| **Tamanho estimado do distribuidor (app base + Tor)** | **Muito leve** (~3–15 MB + Tor) | **Pesado** (~80–150+ MB + Tor) | **Leve** (~10–20 MB + Tor) | **Médio/Pesado** (~50–90+ MB + Tor) |
| **Consistência Web Crypto + WebRTC (Win/macOS/Linux)** | **Atenção no Linux** (`WebKitGTK` GStreamer para WebRTC; **OK para Modo Tor só texto**) | **Total** (Chromium único nas 3 plataformas) | **Total** (usa navegador moderno do usuário em `127.0.0.1`) | **Total** (usa navegador moderno do usuário em `127.0.0.1`) |
| **Reaproveitamento do backend Node/Fastify** | **Não** (usa Rust no host ou sidecar extra) | **Total** (Main Process Node.js) | **Parcial** (reimplementa servidor HTTP/WS mínimo em Go) | **Total** (com fricção de build SEA) |
| **Controle de shutdown & purga de `./tor_data`** | **Forte** (`RunEvent::Exit` + `tauri-plugin-shell` Job Objects) | **Bom** (`before-quit` + socket ControlPort `SIGNAL SHUTDOWN`) | **Bom** (`signal.Notify` + ControlPort + cleanup) | **Bom** (`SIGINT`/`SIGTERM` + ressalva Windows `TerminateProcess`) |

---

## Recomendação Final de Arquitetura para o PULSO

1. **Frontend (Fase 1):** Construir em **React + TypeScript + Vite (SPA)** com i18n (`pt-br`, `en`, `es`, `zh-CN`), Web Crypto API, WebRTC e uma camada `TransportAdapter` desacoplada. O build `dist/` será o artefato único consumido por todos os modos.
2. **Backend (Fase 2 — Modo Normal):** **Node.js + Fastify + `@fastify/websocket` + `@fastify/static`**, mantendo estado mínimo das salas apenas em memória RAM e servindo o `dist/` do Vite na mesma origem.
3. **Empacotamento Local Zero-Config (Fase 2 — Modo Tor do Anfitrião):**
   - Utilizar **Tor Expert Bundle (C-Tor)** com `ControlPort auto`, `CookieAuthentication 1` (`SAFECOOKIE`), `SocksPort 0`, **`ADD_ONION NEW:ED25519-V3 Flags=DiscardPK`** (sem chave privada `.onion` em disco), leitura de `BOOTSTRAP`/`HS_DESC UPLOADED` e purga garantida de `./tor_data` no shutdown (via `SIGNAL SHUTDOWN` + remoção recursiva) e preventivamente no startup.
   - Para a casca local do Anfitrião:
     - **Recomendado se o pacote local for dedicado a desktop protegido (Windows/macOS) com Modo Tor somente texto:** **Tauri v2** (`externalBin` para o `tor` + `axum` local em Rust ou IPC + `set_content_protected(true)` + `tauri-plugin-shell` com Job Objects).
     - **Alternativa caso o mesmo app desktop precise rodar Modo Normal com Chamada de Vídeo WebRTC confiável também em Linux, ou priorize 100% de reuso do backend Fastify:** **Electron** (`extraResources` + `setContentProtection(true)`).
     - *(Se proteção nativa de janela no desktop for dispensada em favor de CLI zero-config pura, usar um launcher nativo em Go com `embed.FS` do `dist/` Vite em vez de Node SEA/`pkg`.)*
