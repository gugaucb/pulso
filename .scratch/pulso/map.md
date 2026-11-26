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
- [Fechar design system, fluxos de tela e microinterações do frontend PULSO](./issues/03-design-system-e-ux-das-telas-do-frontend.md): Especificação completa da Fase 1 publicada em [pulso-frontend/spec.md](../pulso-frontend/spec.md) (`ready-for-agent`), definindo design system claro/escuro fiel à marca PULSO, fluxos 1:1 com E2EE no cliente, **Chamada de Vídeo** (bloqueada no **Modo Tor**), **Contador de Inatividade**, i18n (`pt-br`/`en`/`es`/`zh-CN`) e costuras `RoomTransport` + `MediaPort`.

## Not yet specified

- Especificação consolidada final (`spec.md`) e fatiamento em tickets de implementação (Fase 1 e Fase 2) via `/to-spec` e `/to-tickets`.
- Estratégia de testes automatizados e auditoria de privacidade/zero-rastro (testes criptográficos E2EE, testes de expiração/purga de memória e `./tor_data`, testes E2E de duas sessões e responsividade).
- Infraestrutura de deploy do **Modo Normal** (hospedagem stateless, servidor TURN) e pipeline de build/distribuição do executável local do **Modo Tor** (macOS/Windows/Linux).
- Anexos efêmeros cifrados (se entram no v1, limites de tamanho e envio cifrado em chunks sem persistência em disco).

## Out of scope

- Cadastro de usuários, login, e-mail, autenticação persistente ou perfis permanentes.
- Salas com mais de 2 participantes (grupos, canais públicos ou múltiplas salas simultâneas).
- Persistência de histórico de mensagens em banco de dados ou recuperação após expiração/encerramento da **Sala**.
- **Chamada de Vídeo** ou áudio sobre o **Modo Tor** (restrito exclusivamente a texto E2EE).
