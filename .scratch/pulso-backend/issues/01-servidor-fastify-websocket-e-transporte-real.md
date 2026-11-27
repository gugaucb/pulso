# 01: Tracer bullet: Servidor Fastify em RAM, WebSocketTransport padrão e Sala 1:1 entre navegadores distintos

**What to build:** Implementar o servidor backend mínimo em memória RAM com Node.js, TypeScript e Fastify (`@fastify/websocket` e `@fastify/static`) servindo a aplicação frontend e o endpoint WebSocket `/ws` na mesma origem (com proxy transparente no servidor de desenvolvimento Vite), substituindo o transporte padrão da interface por `WebSocketTransport` para que **Anfitrião** e **Convidado** em navegadores distintos entrem na mesma **Sala** 1:1 e troquem **Mensagens Efêmeras** E2EE sem vazar `senderName` em claro nos envelopes trafegados pelo relay.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] Servidor Fastify configurado servindo o bundle estático compilado com fallback SPA, endpoint neutro `GET /healthz` e endpoint WebSocket `/ws` na mesma porta, sem persistência em disco nem banco de dados.
- [x] Configuração de desenvolvimento do Vite faz proxy de `/ws` e `/api` para o servidor Fastify em execução local, com script de inicialização conjunta documentado.
- [x] Contrato de protocolo WebSocket versionado cobrindo criação/entrada na **Sala** (`create_room`, `join_room`), saída explícita, presença 1:1 (`room_joined`, `participant_joined`, `participant_left`), troca de chaves públicas ECDH (`key_exchange`), envio opaco de **Mensagens Efêmeras** cifradas (`encrypted_message`), indicador `"digitando…"` (`typing`) e rejeição explícita de terceiro entrante com `room_full` ou de código desconhecido com `room_not_found`.
- [x] Envelope cifrado trafegado pela rede omite o campo `senderName` em texto claro, enviando apenas os campos necessários para roteamento e decifragem (`version`, `roomCode`, `senderId`, `senderRole`, `seq`, `iv`, `ciphertext`, `sentAt`) e preservando integralmente o protocolo Web Crypto E2EE e o código visual **SAS** da Fase 1.
- [x] Novo adaptador `WebSocketTransport` implementado atrás da interface existente `RoomTransport` e ativado como transporte padrão da aplicação, mantendo `BroadcastChannelTransport` acessível via flag explícita de modo local/offline e `InMemoryTransport` preservado nos testes unitários de UI.
- [x] Testes de integração sobem uma instância real do servidor Fastify em `127.0.0.1:0` e conectam clientes `WebSocketTransport` reais comprovando criação da **Sala** pelo **Anfitrião**, ingresso do **Convidado** por **Código da Sala** e link com `#k`, acordo de chaves E2EE, troca bidirecional de **Mensagens Efêmeras** sem `senderName` em claro no fio, indicador `"digitando…"` e rejeição `room_full` para terceiro entrante.

## Comments

- Resolved on integration branch `feat/pulso-backend` (merged in `ce0c91d`, refined after code review in `10cb0bb`). Verified via `npm run build`, Vitest (`npm test`, 30/30 files, 149/149 tests), and Playwright E2E (`npm run test:e2e`, 11/11 tests).
