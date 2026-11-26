# 02: Ciclo de vida 1:1, reconexão silenciosa de 30s e Contador de Inatividade autoritativo no servidor

**What to build:** Tornar o servidor Fastify em RAM a autoridade única do **Contador de Inatividade** (60 minutos deslizantes com teto máximo absoluto de 24 horas) e das regras do ciclo de vida 1:1, diferenciando saída explícita do **Anfitrião**, saída explícita do **Convidado** e quedas abruptas de conexão com reconexão silenciosa em janela de graça de 30 segundos mantendo chaves e histórico apenas na RAM da aba.

**Blocked by:** 01: Tracer bullet: Servidor Fastify em RAM, WebSocketTransport padrão e Sala 1:1 entre navegadores distintos

**Status:** ready-for-agent

- [ ] Servidor gerencia com relógio injetável o **Contador de Inatividade** deslizante de 60 minutos e o teto rígido de 24 horas corridas desde a criação da **Sala**, recalculando e difundindo `activity_reset` a cada **Mensagem Efêmera** aceita, ingresso de **Participante** ou sinal explícito de atividade (`notify_activity`).
- [ ] Ao zerar o **Contador de Inatividade** ou atingir o teto absoluto de 24 horas, o servidor emite `room_expired` para os **Participantes** conectados, encerra os sockets e purga imediatamente toda a **Sala** da memória RAM; ambos os navegadores limpam mensagens e chaves locais exibindo a tela de expiração com avisos exclusivamente visuais.
- [ ] Saída explícita do **Anfitrião** (`leave_room`) encerra e purga imediatamente a **Sala** no servidor e notifica o **Convidado** caso esteja conectado; saída explícita do **Convidado** libera apenas sua vaga e notifica `participant_left`, mantendo a **Sala** aberta para um novo **Convidado** realizar novo handshake ECDH limpo com o **Anfitrião**.
- [ ] Servidor emite uma credencial efêmera `sessionToken` ao criar ou ingressar na **Sala**, mantida exclusivamente em memória RAM na instância ativa de `WebSocketTransport` (zero escrita em `localStorage`, `sessionStorage`, `IndexedDB` ou cookies).
- [ ] Em queda abrupta do WebSocket sem saída explícita, o servidor preserva a vaga do **Participante** por uma janela de graça de 30 segundos (purgando a vaga ou a **Sala** vazia se o prazo expirar); nesse intervalo, `WebSocketTransport` reconecta automaticamente com comando `reconnect_room` usando `roomCode` e `sessionToken`, mantendo chaves E2EE, contadores sequenciais e mensagens já em tela sem recarregar a página.
- [ ] Quatro catálogos de i18n (`pt-br`, `en`, `es`, `zh-CN`) atualizados para exibir feedback claro de reconexão em andamento e motivos de encerramento da **Sala** sem alterar a persistência zero-rastro do idioma.
- [ ] Testes de integração contra servidor real com relógio controlado validam saída do **Anfitrião** vs. saída do **Convidado**, entrada de segundo **Convidado** após saída do primeiro, reconexão bem-sucedida dentro de 30 segundos, expiração da janela de graça após 30 segundos, expiração do **Contador de Inatividade** de 60 minutos e purga forçada ao atingir 24 horas.
