# Definir estratégia de i18n para pt-br, en, es e zh-CN

Type: grilling
Status: resolved

## Question

Definir a estratégia de internacionalização para `pt-br`, `en`, `es` e `zh-CN`: detecção automática + seletor manual (tela de entrada e menu da sala), formatação localizada de timestamps relativos e **Contador de Inatividade**, fallback tipográfico para `zh-CN` junto à fonte Inter, política de persistência da escolha de idioma compatível com privacidade/zero-rastro, e rótulos padrão de **Participante** anônimo por idioma.

## Answer

Estratégia integralmente definida e implementada na Fase 1 ([pulso-frontend/spec.md](../../pulso-frontend/spec.md)) e estendida para os fluxos de rede e **Modo Tor** na Fase 2 ([pulso-backend/spec.md](../../pulso-backend/spec.md)):

- **Idiomas suportados:** `pt-br` (padrão), `en`, `es` e `zh-CN`.
- **Detecção e troca em tempo real:** detecção automática inicial via `navigator.languages` combinada a seletor manual acessível tanto na tela de entrada quanto no menu da **Sala**, atualizando `document.documentElement.lang` dinamicamente.
- **Política zero-rastro de idioma:** escolha mantida exclusivamente na memória RAM da sessão ativa (zero gravação em `localStorage`, `sessionStorage`, `IndexedDB` ou cookies).
- **Formatação e tipografia:** timestamps relativos via `Intl.RelativeTimeFormat`, formato localizado do **Contador de Inatividade**, fallback tipográfico CJK nativo pareado à fonte `Inter` quando `zh-CN` estiver ativo, e rótulos padrão localizados para **Participante** anônimo.
- **Extensão na Fase 2:** ampliação dos quatro catálogos para cobrir estados de conexão/reconexão WebSocket, erros de limite de taxa/payload e orientações/status do launcher local do **Modo Tor**.
