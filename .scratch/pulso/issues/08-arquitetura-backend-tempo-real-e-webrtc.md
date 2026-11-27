# Definir arquitetura do backend em memória, WebSocket e sinalização WebRTC

Type: grilling
Status: resolved
Blocked by: 04, 06, 07

## Question

Com base nos tickets [Definir ciclo de vida da Sala, Contador de Inatividade e garantias de zero-rastro](./04-ciclo-de-vida-da-sala-inatividade-e-privacidade.md), [Escolher stack full-stack e modelo de distribuição para Modo Normal e Modo Tor](./06-escolha-da-stack-e-arquitetura-de-distribuicao.md) e [Definir protocolo de criptografia E2EE e mitigações anti-printscreen](./07-protocolo-e2ee-e-mitigacao-anti-screenshot.md), especificar o backend em RAM sem persistência em disco: protocolo WebSocket (criação/entrada 1:1, presença, "digitando…", relay opaco E2EE, sincronização do **Contador de Inatividade** e purga), sinalização WebRTC + estratégia STUN/TURN e fallback para texto, rate-limit sem logs identificáveis e contrato compartilhado com o frontend da Fase 1.

## Answer

Decisões consolidadas na especificação da Fase 2 ([spec.md](../../pulso-backend/spec.md)):

- **Servidor Fastify em RAM:** processo único Node.js + Fastify sem banco de dados nem escrita de estado em disco, servindo o pacote estático SPA, `GET /api/runtime`, `GET /healthz` e WebSocket `/ws` na mesma origem (com proxy `/ws` no Vite durante o desenvolvimento).
- **Transporte padrão e reconexão:** `WebSocketTransport` passa a ser o transporte padrão da aplicação (mantendo `BroadcastChannelTransport` apenas sob flag explícita de modo local/offline e `InMemoryTransport` nos testes unitários), com reconexão automática dentro da janela de graça de 30 segundos usando `sessionToken` efêmero mantido apenas em RAM (preservando chaves e contadores E2EE).
- **Autoridade de estado em RAM:** o servidor atua como fonte única de verdade do **Contador de Inatividade** (60 minutos deslizantes + teto absoluto de 24 horas), da cardinalidade estrita 1:1 (rejeitando terceiros com `room_full`) e da purga imediata ao encerrar ou expirar.
- **Sinalização WebRTC, STUN e TURN:**
  - No **Modo Normal**, ao ingressar na **Sala**, o servidor entrega a lista dinâmica de `iceServers`, tendo os servidores STUN públicos gratuitos do Google (`stun:stun.l.google.com:19302` e `stun:stun1.l.google.com:19302`) como padrão configurável via variáveis de ambiente, além de suporte opcional a TURN/coturn com credenciais estáticas ou credenciais efêmeras via `TURN_SECRET`.
  - O adaptador de mídia no navegador consome os `iceServers` recebidos do servidor e degrada graciosamente para troca de **Mensagens Efêmeras** em caso de falha ICE.
  - No **Modo Tor**, o servidor omite `iceServers` e descarta estritamente qualquer sinal de **Chamada de Vídeo** (`call_signal`) como defesa em profundidade contra vazamento de IP.
- **Zero-rastro e proteção anti-abuso:** access logs identificáveis desabilitados (zero IP, `User-Agent`, query string ou **Código da Sala**), rate-limiting e proteção anti-brute-force de **Código da Sala** 100% em RAM indexados por `HMAC-SHA256(ip, segredoRotativoEmRam)`, limite máximo de **64 KB** por frame WebSocket e teto configurável de **Salas** simultâneas em memória.
