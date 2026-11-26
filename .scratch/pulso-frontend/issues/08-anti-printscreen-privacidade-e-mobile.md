# 08: Mitigação anti-printscreen, painel de privacidade e responsividade mobile completa

**What to build:** Entregar as proteções dissuasivas anti-printscreen na **Sala** junto ao painel de configurações de privacidade transparente, fechar a experiência mobile responsiva fiel às referências (cabeçalho compacto, barra lateral em *drawer* e **Chamada de Vídeo** em tela cheia) e concluir a auditoria de acessibilidade por teclado e leitores de tela.

**Blocked by:** 04: Experiência completa da Sala estilo Slack (presença, "digitando…", scroll inteligente, emojis e saída segura), 06: Fluxo completo de Chamada de Vídeo no Modo Normal (preview, layouts e fallback)

**Status:** resolved

- [x] Proteção automática de tela aplica desfoque imediato e cortina protetora sobre a área de **Mensagens Efêmeras** ao detectar `window.blur` ou `document.visibilitychange` (`hidden`), restaurando ao retomar o foco (configurável nas preferências da sessão).
- [x] Regras `@media print` ocultam todas as **Mensagens Efêmeras**, código e participantes ao tentar imprimir ou gerar PDF; área de mensagens bloqueia seleção casual (`user-select: none`) e menu de contexto nativo.
- [x] Camada opcional de marca d'água SVG dinâmica (`pointer-events: none`) sobrepõe sutilmente **Código da Sala** e horário atual quando ativada nas configurações de privacidade.
- [x] Modal/painel de configurações de mídia e privacidade reúne os controles da cortina de foco, marca d'água e um aviso transparente explicando que navegadores não conseguem bloquear capturas do sistema operacional nem câmeras externas.
- [x] Layout mobile responsivo fiel à prancha de referência: entrada com largura confortável e alvos de toque amplos, cabeçalho compacto na **Sala** com botão para abrir a barra lateral em *drawer* deslizante (fechável com `Escape` e clique fora), compositor ajustado a safe-areas e **Chamada de Vídeo** em tela cheia com acesso rápido ao texto.
- [x] Navegação completa por teclado (ordem de tabulação lógica, foco visível, `Escape` fechando modais/drawers), rótulos ARIA completos e anúncios discretos para mudanças de estado importantes.
- [x] Testes de integração disparam eventos reais de DOM (`blur`, `visibilitychange`, `contextmenu`) para confirmar ativação/remoção da cortina protetora e validam abertura, foco e fechamento por teclado do *drawer* mobile e do painel de privacidade.

## Comments

- Resolved on integration branch `feat/pulso-frontend` (merged in `962f4cc`, refined in `ba5fcb8`). Verified via `npx tsc --noEmit`, Vitest (`npm test`), `vite build`, and Playwright E2E (`npm run test:e2e`).
