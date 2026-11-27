# Escolher stack full-stack e modelo de distribuição para Modo Normal e Modo Tor

Type: grilling
Status: resolved
Blocked by: 01

## Question

Com base na [Pesquisa de stack full-stack e empacotamento zero-config do daemon Tor](./01-pesquisa-stack-e-empacotamento-tor.md), definir a stack oficial do frontend (Fase 1) e do backend (Fase 2), estrutura do projeto para desenvolver o frontend desacoplado primeiro e formato de empacotamento local zero-config do **Modo Tor**.

## Answer

Decisões consolidadas na especificação da Fase 2 ([spec.md](../../pulso-backend/spec.md)):

- **Frontend (Fase 1, concluído):** SPA desacoplada em **React + TypeScript + Vite + Tailwind CSS**, isolada pelas fronteiras `RoomTransport` e `MediaPort`.
- **Backend em RAM (Fase 2 — Modo Normal):** **Node.js + TypeScript + Fastify** (`@fastify/websocket` + `@fastify/static`) no mesmo repositório, compartilhando contratos de protocolo com o frontend e servindo o pacote estático compilado e o endpoint WebSocket `/ws` na mesma origem.
- **Empacotamento/execução zero-config (Fase 2 — Modo Tor):** **Launcher local em Node/CLI integrado ao Fastify + Tor Expert Bundle** abrindo em `127.0.0.1:<porta>` no navegador padrão do **Anfitrião**, mantendo zero fricção de build multiplataforma e testabilidade em CI. A arquitetura permanece desacoplada para eventual empacotamento desktop (Electron/Tauri) numa fase futura caso proteção nativa de janela do sistema operacional se torne prioridade.
- **Escopo de anexos:** anexos efêmeros cifrados permanecem fora da Fase 2.
