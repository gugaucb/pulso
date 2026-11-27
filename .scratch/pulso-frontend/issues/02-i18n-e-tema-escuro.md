# 02: Internacionalização (pt-br, en, es, zh-CN) e tema escuro nativo

**What to build:** Dotar toda a aplicação de suporte completo aos quatro idiomas (`pt-br`, `en`, `es` e `zh-CN`) e do tema escuro nativo fiel às referências visuais, permitindo que o **Participante** alterne idioma e tema em tempo real tanto na tela de entrada quanto dentro da **Sala** sem gravar preferências em armazenamento persistente do navegador.

**Blocked by:** 01: Tracer bullet: Entrada, criação/acesso à Sala 1:1 e troca básica de Mensagens Efêmeras entre abas

**Status:** resolved

- [x] Catálogos completos e consistentes de tradução para `pt-br` (padrão), `en`, `es` e `zh-CN` cobrindo toda a interface existente e os rótulos padrão de **Participante** anônimo por idioma.
- [x] Detecção automática inicial do idioma a partir das preferências do navegador e atualização de `document.documentElement.lang` ao trocar de idioma.
- [x] Seletor de idioma acessível disponível na tela de entrada e no menu da **Sala**, mantendo a escolha apenas na memória da sessão ativa (zero gravação em `localStorage`, `sessionStorage`, `IndexedDB` ou cookies).
- [x] Formatação localizada de timestamps relativos via `Intl.RelativeTimeFormat` e aplicação de pilha de fallback tipográfico CJK apropriada junto à fonte `Inter` quando `zh-CN` estiver ativo.
- [x] Tema escuro nativo fiel à referência visual (superfícies slate escuras, bolhas próprias em acento roxo translúcido, alto contraste) com alternador acessível entre tema claro e tema escuro em tempo real e contraste mínimo WCAG AA em ambos os temas.
- [x] Testes de integração verificam a troca dinâmica entre os quatro idiomas (textos, timestamps e nome anônimo padrão) e a alternância entre tema claro e tema escuro sem uso de storages persistentes.

## Comments

- Resolved on integration branch `feat/pulso-frontend` (merged in `d267023`, refined in `ba5fcb8`). Verified via `npx tsc --noEmit`, Vitest (`npm test`), `vite build`, and Playwright E2E (`npm run test:e2e`).
