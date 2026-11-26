# Fechar design system, fluxos de tela e microinterações do frontend PULSO

Type: grilling
Status: resolved

## Question

Fechar a especificação de UI/UX da Fase 1 a partir de [pulso-reference-board.jpg](../../../docs/design/pulso-reference-board.jpg) e [pulso-logo.jpg](../../../docs/design/pulso-logo.jpg): tokens de cor (claro/escuro), tipografia Inter, formato do **Código da Sala** (tamanho, alfabeto sem ambiguidades, cópia/compartilhamento), tela de entrada (seletor **Modo Normal** vs. **Modo Tor**, seletor de idioma, nome de exibição opcional), chat estilo Slack (empty state, anexos opcionais, emoji, "digitando…", "Ir para a última mensagem", badge E2EE, exibição do **Contador de Inatividade**), fluxo de **Chamada de Vídeo** (preview/permissão, modos de layout vídeo no topo/lado a lado/PiP/Foco, fallback gracioso, estado bloqueado no **Modo Tor**), mobile responsivo e camada de simulação local (ex.: `BroadcastChannel` entre abas + simulador) para a Fase 1 funcionar interativamente antes do backend real.

## Answer

Especificação completa do frontend (Fase 1) consolidada e publicada em [spec.md](../../pulso-frontend/spec.md) com label `Status: ready-for-agent`.

Principais decisões registradas na spec:
- Design system fiel às referências visuais em [pulso-reference-board.jpg](../../../docs/design/pulso-reference-board.jpg) e [pulso-logo.jpg](../../../docs/design/pulso-logo.jpg), com temas claro (sidebar escura fixa + área principal clara) e escuro nativo, fonte `Inter` (+ fallback CJK) e responsividade desktop/mobile.
- Arquitetura SPA em React + TypeScript + Vite + Tailwind CSS com duas costuras principais de teste e desacoplamento: `RoomTransport` (implementado na Fase 1 via `BroadcastChannel` entre abas e pronto para WebSocket/Onion Service na Fase 2) e `MediaPort` (MediaDevices/WebRTC, bloqueado no **Modo Tor**).
- Criptografia E2EE no cliente (`Web Crypto API` `ECDH P-256` + `HKDF-SHA256` + `AES-256-GCM` com IV determinístico 96-bit, `#k` no fragmento da URL e verificação visual SAS), **Contador de Inatividade** regressivo de 60 minutos com purga imediata da memória, mitigações anti-printscreen no navegador e i18n em `pt-br`, `en`, `es` e `zh-CN`.
