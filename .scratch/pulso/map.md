# PULSO — Mapa Wayfinder

Labels: wayfinder:map

## Destination

Especificação técnica e de UX completa e sem ambiguidades para o **PULSO** (aplicação full-stack real de chat efêmero 1:1 com E2EE no cliente, **Chamada de Vídeo** opcional no **Modo Normal**, **Modo Tor** opcional via Onion Service v3 zero-config somente texto, i18n em `pt-br`, `en`, `es` e `zh-CN`, **Contador de Inatividade** com purga sem rastros e mitigações anti-printscreen), pronta para implementação em duas fases: Fase 1 (Frontend completo e interativo fiel às referências visuais) e Fase 2 (Backend real mínimo em memória + E2EE + sinalização WebRTC + daemon Tor embutido).

## Notes

- Domínio definido em [GLOSSARY.md](../../GLOSSARY.md) (consultar sempre e manter termos canônicos).
- Skills padrão para sessões neste mapa: `grilling`, `domain-modeling`, `research`, `prototype`.
- Referências visuais permanentes: [pulso-logo.jpg](../../docs/design/pulso-logo.jpg) (ícone pulso roxo/índigo) e [pulso-reference-board.jpg](../../docs/design/pulso-reference-board.jpg) (prancha completa com Entrada, Chat estilo Slack, Videoconferência 1:1, Modo Escuro, Mobile, Destaques e Paleta/Inter).
- Decisões de escopo já firmadas na abertura do mapa:
  - Marca **PULSO**; idiomas via i18n: `pt-br`, `en`, `es`, `zh-CN`.
  - **Sala** estritamente 1:1 (máximo 2 **Participantes**).
  - Entrega planejada em duas fases: **Fase 1** = Frontend completo e interativo (arquitetura desacoplada pronta para o backend); **Fase 2** = Backend real com mínimo de informação em RAM e eliminação sem rastros + E2EE + WebRTC + **Modo Tor**.
  - **Modo Tor** publica Onion Service v3 zero-config localmente pelo **Anfitrião**, purga `./tor_data` ao encerrar e **desabilita Chamada de Vídeo** (apenas texto E2EE).
  - Proteção anti-printscreen: mitigação de melhor esforço no navegador (+ proteção nativa de janela caso o empacotamento local seja desktop).
  - Stack aberta: escolher a melhor para atender os requisitos.
  - Tracker local em Markdown (sem repositório Git inicializado ainda; artefatos de pesquisa ficam em `.scratch/pulso/research/`).

## Decisions so far

- [Pesquisa de stack full-stack e empacotamento zero-config do daemon Tor](./issues/01-pesquisa-stack-e-empacotamento-tor.md): React + Vite (SPA) com transporte desacoplado e Fastify (`@fastify/websocket`) no **Modo Normal**, combinados ao Tor Expert Bundle (`ADD_ONION` efêmero via ControlPort + purga de `./tor_data`) empacotado em Tauri v2 (ou Electron caso vídeo WebRTC em app desktop Linux seja requisito).
- [Pesquisa de primitivas E2EE no navegador e mitigações contra captura de tela](./issues/02-pesquisa-criptografia-e2ee-e-anti-screenshot.md): E2EE via `ECDH P-256` (ou `@noble/curves` `X25519` sem WASM) + `HKDF-SHA256` + `AES-256-GCM` com nonce determinístico 96-bit (direção + contador), anti-MITM via fragmento `#key` (RFC 3986) + SAS visual, e anti-printscreen limitado a dissuasão no navegador e proteção nativa parcial no desktop (Windows `SetWindowDisplayAffinity`; legado no macOS; sem suporte no Linux).
- [Fechar design system, fluxos de tela e microinterações do frontend PULSO](./issues/03-design-system-e-ux-das-telas-do-frontend.md): Especificação completa da Fase 1 publicada em [pulso-frontend/spec.md](../pulso-frontend/spec.md) (`resolved`), definindo design system claro/escuro fiel à marca PULSO, fluxos 1:1 com E2EE no navegador, **Chamada de Vídeo** (bloqueada no **Modo Tor**), **Contador de Inatividade**, i18n (`pt-br`/`en`/`es`/`zh-CN`) e costuras `RoomTransport` + `MediaPort`.
- [Definir ciclo de vida da Sala, Contador de Inatividade e garantias de zero-rastro](./issues/04-ciclo-de-vida-da-sala-inatividade-e-privacidade.md): **Contador de Inatividade** fixo em 60m deslizantes com teto máximo absoluto de 24h no servidor e avisos exclusivamente visuais; saída do **Anfitrião** purga a **Sala**, saída do **Convidado** mantém a **Sala** aberta, queda de rede concede 30s de graça em RAM e reload limpa o estado local sem recuperação.
- [Definir estratégia de i18n para pt-br, en, es e zh-CN](./issues/05-estrategia-i18n-e-localizacao.md): Estratégia de 4 idiomas (`pt-br`, `en`, `es`, `zh-CN`) implementada na Fase 1 apenas em RAM e estendida na Fase 2 para estados WebSocket, limites e **Modo Tor**.
- [Escolher stack full-stack e modelo de distribuição para Modo Normal e Modo Tor](./issues/06-escolha-da-stack-e-arquitetura-de-distribuicao.md): Backend em Node.js + TypeScript + Fastify (`@fastify/websocket` + `@fastify/static`) servindo o pacote estático + `/ws` na mesma origem, com **Modo Tor** via launcher local integrado ao Tor Expert Bundle (sem anexos efêmeros na Fase 2).
- [Definir protocolo de criptografia E2EE e mitigações anti-screenshot](./issues/07-protocolo-e2ee-e-mitigacao-anti-screenshot.md): Mantida `Web Crypto API` nativa (`ECDH P-256` + `HKDF-SHA256` com `#k` + `AES-256-GCM` + SAS) sem WASM, remoção de `senderName` em claro dos envelopes trafegados no relay e manutenção do pacote dissuasivo web anti-printscreen.
- [Definir arquitetura do backend em memória, WebSocket e sinalização WebRTC](./issues/08-arquitetura-backend-tempo-real-e-webrtc.md): `WebSocketTransport` padrão com reconexão em RAM de 30s, servidor autoritativo em memória sem logs identificáveis, rate-limit via `HMAC-SHA256` com segredo rotativo em RAM, limite de 64 KB por frame, STUN padrão do Google + suporte a TURN/coturn e bloqueio server-side de vídeo no **Modo Tor**.
- [Definir arquitetura do Modo Tor (Onion Service v3 zero-config e purga em disco)](./issues/09-arquitetura-modo-tor-onion-service.md): Fronteira `TorController` usando `ADD_ONION NEW:ED25519-V3 Flags=DiscardPK`, `SAFECOOKIE`, espera por `BOOTSTRAP 100%` + `HS_DESC UPLOADED`, endpoint `GET /api/runtime` honesto (sem `.onion` falso em **Modo Normal**) e purga dupla garantida de `./tor_data`.
- [Prototipar fluxos críticos de UI do PULSO para validação visual](./issues/10-prototipo-validacao-visual-e-interacoes.md): Encerrado como superado pela implementação completa da Fase 1 ([pulso-frontend/spec.md](../pulso-frontend/spec.md)).
- **Especificação e tickets da Fase 2:** Publicados em [pulso-backend/spec.md](../pulso-backend/spec.md) (`ready-for-agent`) e fatiados em 7 tickets `ready-for-agent` sob [pulso-backend/issues/](../pulso-backend/issues/).

## Not yet specified

- Anexos efêmeros cifrados (limites de tamanho e envio cifrado em chunks sem persistência em disco).
- Infraestrutura de deploy em produção do **Modo Normal** (hospedagem stateless e provisionamento gerenciado de servidor TURN/coturn).
- Eventual empacotamento desktop (Electron/Tauri v2) numa fase futura caso proteção nativa de captura de tela em nível de janela do sistema operacional seja priorizada.

## Out of scope

- Cadastro de usuários, login, e-mail, autenticação persistente ou perfis permanentes.
- Salas com mais de 2 participantes (grupos, canais públicos ou múltiplas salas simultâneas).
- Persistência de histórico de mensagens em banco de dados ou recuperação após expiração/encerramento da **Sala**.
- **Chamada de Vídeo** ou áudio sobre o **Modo Tor** (restrito exclusivamente a texto E2EE).
