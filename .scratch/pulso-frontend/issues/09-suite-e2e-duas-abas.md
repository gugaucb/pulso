# 09: Suíte E2E de duas abas reais (desktop e mobile) e validação final da Fase 1

**What to build:** Configurar e executar a suíte de testes ponta a ponta (Playwright) contra o bundle compilado da aplicação com duas abas reais se comunicando via `BroadcastChannel`, validando todos os fluxos de usuário da Fase 1 em desktop e mobile além da garantia de zero rastros persistidos no navegador.

**Blocked by:** 05: Contador de Inatividade regressivo, alertas de expiração e autodestruição com purga, 07: Modo Tor na interface e bloqueio estrito de áudio/vídeo, 08: Mitigação anti-printscreen, painel de privacidade e responsividade mobile completa

**Status:** ready-for-agent

- [ ] Playwright configurado para subir a aplicação compilada e abrir duas abas/contextos reais representando **Anfitrião** e **Convidado**.
- [ ] Fluxo E2E desktop completo: **Anfitrião** cria **Sala** e copia link com `#k`, **Convidado** entra pelo link/código, ambos trocam **Mensagens Efêmeras** cifradas em tempo real com indicador *"digitando…"* e conferem o código visual **SAS** idêntico.
- [ ] Fluxo E2E verifica troca de idioma (`pt-br`, `en`, `es`, `zh-CN`), alternância entre tema claro e tema escuro, preview/controles de **Chamada de Vídeo** no **Modo Normal** (com dispositivos simulados do navegador) e bloqueio estrito da câmera no **Modo Tor**.
- [ ] Fluxo E2E valida cortina anti-printscreen ao perder foco e autodestruição completa ao zerar o **Contador de Inatividade**, removendo todo conteúdo visível.
- [ ] Fluxo E2E em viewport mobile (`390x844`) valida entrada, cabeçalho compacto, abertura/fechamento do *drawer* lateral e envio de **Mensagens Efêmeras**.
- [ ] Asserção explícita no fim dos cenários confirma que `localStorage`, `sessionStorage` e `IndexedDB` permanecem vazios sem códigos, mensagens ou chaves residuais.
