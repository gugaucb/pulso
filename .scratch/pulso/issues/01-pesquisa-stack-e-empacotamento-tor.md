# Pesquisa de stack full-stack e empacotamento zero-config do daemon Tor

Type: research
Status: resolved

## Question

Comparar com fontes primárias as melhores combinações de stack (frontend React/TypeScript + backend Node.js/Fastify, Next.js, Go ou Rust) e empacotamento local zero-config para o daemon Tor (Tauri sidecar vs. Electron vs. CLI/binário local com Tor Expert Bundle ou Arti): gerenciamento de `torrc` transitório e ControlPort (Onion Service v3), leitura do `hostname` `.onion`, purga garantida de `./tor_data`, suporte a proteção nativa anti-captura de tela (`setContentProtection` / Tauri content protection), suporte a macOS/Windows/Linux e ergonomia para construir primeiro a Fase 1 (Frontend completo e interativo) com transporte desacoplado.

## Answer

- **Stack Full-Stack recomendada:** **React + TypeScript + Vite (SPA)** na Fase 1 (com interface de transporte desacoplada) e **Node.js + Fastify (`@fastify/websocket` + `@fastify/static`)** na Fase 2 para o Modo Normal em RAM. **Next.js** é desaconselhado porque `output: 'export'` é incompatível com custom servers e WebSockets persistentes exigem custom server fora do modelo padrão/serverless.
- **Daemon Tor (Onion Service v3):** Usar o **Tor Expert Bundle (C-Tor)** em vez do **Arti**, pois o C-Tor oferece binários oficiais multiplataforma, `ControlPort` com `SAFECOOKIE` e `ADD_ONION NEW:ED25519-V3 Flags=DiscardPK` (que cria o `.onion` v3 sem gravar chave privada em disco) além de eventos `BOOTSTRAP`/`HS_DESC`; o Arti não implementa o `ControlPort` legado e mantém o `ArtiEphemeralKeystore` como experimental.
- **Empacotamento Zero-Config e Anti-Captura:** **Tauri v2** (`externalBin` + `Window::set_content_protected` + `RunEvent::Exit`/Job Objects) gera pacotes muito menores (~3–15 MB + Tor) e atende bem o **Modo Tor** (somente texto, evitando a fragilidade do WebRTC no `WebKitGTK` em Linux), enquanto **Electron** (`extraResources` + `BrowserWindow.setContentProtection`) garante WebRTC idêntico no Linux ao custo de ~80–150+ MB extras. Em ambos, a proteção anti-captura nativa funciona em Windows e macOS (com ressalvas para APIs modernas como `ScreenCaptureKit`), mas **não é suportada no Linux**; `pkg` está depreciado e o Windows exige `SIGNAL SHUTDOWN` via ControlPort + Job Objects + purga defensiva de `./tor_data` no boot e no encerramento.

Relatório completo: [01-stack-e-empacotamento-tor.md](../research/01-stack-e-empacotamento-tor.md).
