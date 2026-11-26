# 07: Suíte E2E full-stack entre navegadores isolados e validação final da Fase 2

**What to build:** Atualizar e expandir a suíte ponta a ponta Playwright para executar contra o servidor Fastify real servindo o build de produção compilado, conectando dois contextos de navegador completamente isolados (**Anfitrião** e **Convidado**) via WebSocket real em **Modo Normal** e **Modo Tor** (com `TorController` controlado) e comprovando criptografia de ponta a ponta na rede, reconexão de 30s, expiração autoritativa, **Chamada de Vídeo**, responsividade mobile e garantia absoluta de zero-rastro em storages e logs do servidor.

**Blocked by:** 04: Garantia de zero-rastro, ausência de logs identificáveis e rate-limiting em RAM, 06: Launcher local do Modo Tor, endpoint /api/runtime e UX honesta entre Modo Normal e Modo Tor

**Status:** ready-for-agent

- [ ] Suíte Playwright sobe o servidor Fastify real compilado contra o bundle estático de produção e conecta dois `BrowserContext` isolados (que não compartilham `BroadcastChannel` nem storages) em desktop e viewport mobile.
- [ ] Cenário E2E de **Modo Normal** valida criação da **Sala** pelo **Anfitrião**, entrada do **Convidado** pelo link completo com `#k`, troca bidirecional de **Mensagens Efêmeras** E2EE, conferência de código visual **SAS** idêntico e rejeição de terceiro entrante com aviso de **Sala** cheia.
- [ ] Inspeção direta dos frames WebSocket trafegados pelo navegador durante o teste E2E confirma ausência de texto em claro das mensagens e ausência de `senderName` nos envelopes cifrados.
- [ ] Cenários E2E validam desconexão temporária de rede e reconexão silenciosa dentro da janela de 30 segundos, saída explícita do **Convidado** mantendo a **Sala** aberta para novo ingresso, saída do **Anfitrião** encerrando a **Sala** para ambos e autodestruição sincronizada quando o servidor atinge o fim do **Contador de Inatividade**.
- [ ] Cenário E2E de mídia valida **Chamada de Vídeo** com dispositivos simulados pelo navegador no **Modo Normal** e valida o runtime **Modo Tor** (com `TorController` controlado) confirmando endereço `.onion` exibido sem vídeo habilitado e bloqueio server-side efetivo.
- [ ] Verificação final em cada cenário confirma `localStorage`, `sessionStorage` e `IndexedDB` completamente vazios nos dois navegadores e valida nos registros capturados do servidor Fastify ausência total de endereços IP, `User-Agent`, query strings, **Códigos da Sala** ou payloads.
