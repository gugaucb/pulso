# 03: Sinalização WebRTC real com STUN Google padrão, suporte a TURN e bloqueio server-side no Modo Tor

**What to build:** Habilitar **Chamada de Vídeo** real entre dispositivos em redes diferentes no **Modo Normal** entregando configuração dinâmica de servidores ICE pelo servidor (com os servidores STUN públicos gratuitos do Google como padrão e suporte opcional a TURN/coturn por variáveis de ambiente), enquanto o servidor bloqueia em profundidade qualquer sinalização de áudio/vídeo quando a **Sala** operar em **Modo Tor**.

**Blocked by:** 01: Tracer bullet: Servidor Fastify em RAM, WebSocketTransport padrão e Sala 1:1 entre navegadores distintos

**Status:** ready-for-agent

- [ ] No **Modo Normal**, o evento `room_joined` entregue pelo servidor inclui a lista dinâmica de `iceServers`, trazendo os servidores STUN públicos gratuitos do Google (`stun:stun.l.google.com:19302` e `stun:stun1.l.google.com:19302`) habilitados por padrão quando nenhuma configuração customizada for informada.
- [ ] Variáveis de ambiente no backend permitem sobrescrever servidores STUN e configurar servidores TURN/coturn opcionais, tanto com credenciais estáticas (`TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL`) quanto com geração de credenciais temporárias baseadas em segredo compartilhado (`TURN_SECRET` via HMAC-SHA1 com validade limitada à sessão).
- [ ] Adaptador de mídia do navegador (`BrowserMediaPort`) atualizado na fronteira `MediaPort` para aceitar dinamicamente os `iceServers` recebidos da sessão ao inicializar `RTCPeerConnection`, mantendo degradação graciosa para troca de **Mensagens Efêmeras** com alerta `connection_failed` quando a negociação ICE falhar.
- [ ] Relay WebSocket encaminha corretamente sinais de **Chamada de Vídeo** (`offer`, `answer`, `ice`, `media_state`, `hangup`) entre os dois **Participantes** de uma **Sala** em **Modo Normal** e reflete heartbeats de chamada ativa no **Contador de Inatividade**.
- [ ] Em **Salas** de **Modo Tor**, o servidor sempre omite `iceServers` no ingresso e rejeita/descarta estritamente qualquer comando `call_signal` recebido (emitindo erro controlado sem repassar à outra ponta), reforçando no backend o bloqueio visual da interface.
- [ ] Testes unitários e de integração verificam entrega dos servidores STUN padrão do Google, geração correta de credenciais temporárias TURN com `TURN_SECRET`, encaminhamento de `call_signal` no **Modo Normal**, aplicação dos `iceServers` na construção da conexão WebRTC e bloqueio estrito server-side no **Modo Tor**.
