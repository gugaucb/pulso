# PULSO — Especificação do Backend em RAM, WebSocket, WebRTC e Modo Tor (Fase 2)

Status: resolved

## Problem Statement

Na Fase 1, o frontend do **PULSO** entregou toda a experiência visual, criptografia ponta a ponta no navegador, **Contador de Inatividade**, i18n em quatro idiomas e interface de **Chamada de Vídeo**, porém operava apenas entre abas do mesmo navegador via `BroadcastChannel`. Ao abrir o link compartilhado em outro navegador ou em outro dispositivo — mesmo dentro da validade da **Sala** — o **Convidado** recebia *"Sala não encontrada ou já expirada"*, pois não havia um backend em memória para coordenar a **Sala** pela rede nem sinalizar **Chamada de Vídeo** atravessando NATs, tampouco um controlador real para publicar um endereço `.onion` no **Modo Tor**.

## Solution

A Fase 2 transforma o **PULSO** em uma aplicação full-stack real mantendo estritamente o contrato de zero-rastro: um servidor leve em RAM (Node.js + TypeScript + Fastify) passa a servir a aplicação web e coordenar as **Salas** 1:1 em tempo real via WebSocket na mesma origem. **Anfitrião** e **Convidado** passam a se conectar a partir de navegadores e dispositivos distintos mantendo a cifra ponta a ponta integralmente no navegador, com o servidor enxergando apenas envelopes cifrados opacos sem nome de exibição em claro. O servidor assume o papel de autoridade única do **Contador de Inatividade** (60 minutos deslizantes com teto máximo absoluto de 24 horas), garante reconexão silenciosa dentro de uma janela de graça de 30 segundos em quedas de rede e entrega configuração dinâmica de servidores STUN gratuitos do Google (e TURN opcional) para **Chamadas de Vídeo** reais no **Modo Normal**. Para o **Modo Tor**, um launcher local integrado acopla o servidor ao Tor Expert Bundle, cria um Onion Service v3 efêmero exclusivamente em RAM (`ADD_ONION` com descarte de chave privada) e garante a purga dupla de `./tor_data` ao iniciar e ao encerrar.

## User Stories

### Comunicação 1:1 entre navegadores e dispositivos distintos

1. Como **Anfitrião**, eu quero criar uma **Sala** e enviar o link compartilhado para alguém em outro navegador ou computador, para que o **Convidado** entre na mesma **Sala** imediatamente pela rede.
2. Como **Convidado**, eu quero digitar o **Código da Sala** ou abrir o link recebido em um navegador diferente do **Anfitrião**, para que eu ingresse na **Sala** em menos de cinco segundos e inicie o acordo de chaves E2EE.
3. Como **Participante**, eu quero que o carregamento de página única e a conexão em tempo real funcionem na mesma origem HTTP/WebSocket, para que não haja erros de CORS ou configuração manual de endereços em produção ou desenvolvimento.
4. Como terceiro interessado tentando entrar em uma **Sala** que já possui dois **Participantes** conectados, eu quero receber imediatamente o aviso de **Sala** cheia, para que a conversa privada 1:1 permaneça protegida.

### Ciclo de vida autoritativo, saída, reload e reconexão silenciosa

5. Como **Anfitrião**, eu quero que clicar em *"Sair da sala"* encerre e purgue imediatamente a **Sala** no servidor e no navegador do **Convidado**, para que eu tenha certeza de que a conversa terminou para ambos quando eu decido fechá-la.
6. Como **Convidado**, eu quero que minha saída explícita da **Sala** libere apenas a minha vaga sem destruir a **Sala** do **Anfitrião**, para que o **Anfitrião** possa receber um novo **Convidado** com um novo acordo de chaves E2EE caso deseje.
7. Como **Participante** sofrendo uma oscilação temporária de rede sem recarregar a aba, eu quero que a aplicação reconecte automaticamente dentro de uma janela de graça de 30 segundos preservando minhas chaves E2EE e o histórico volátil já visível na tela, para que a conversa não se perca por uma instabilidade breve.
8. Como **Participante**, eu quero que a reconexão utilize apenas uma credencial efêmera mantida na RAM da aba (nunca gravada em `localStorage`, `sessionStorage`, `IndexedDB` ou cookies), para que um recarregamento completo ou fechamento de aba limpe imediatamente a sessão sem recuperar conteúdo antigo.
9. Como **Participante**, eu quero que, se ambos os lados perderem conexão além da janela de graça de 30 segundos, o servidor purgue a **Sala** vazia da RAM automaticamente, para que nenhum estado órfão permaneça na memória do servidor.

### Contador de Inatividade autoritativo e teto absoluto

10. Como **Participante**, eu quero que o **Contador de Inatividade** de 60 minutos seja controlado e sincronizado autoritativamente pelo servidor a cada **Mensagem Efêmera**, entrada de **Participante** ou heartbeat de **Chamada de Vídeo**, para que os dois navegadores exibam o mesmo tempo restante até a autodestruição.
11. Como operador do sistema, eu quero que nenhuma **Sala** permaneça ativa por mais de 24 horas corridas mesmo havendo atividade contínua, para que a memória RAM do servidor seja liberada de forma previsível contra sessões indefinidas.
12. Como **Participante**, eu quero que os avisos próximos do zeramento do **Contador de Inatividade** permaneçam exclusivamente visuais (âmbar abaixo de 5 minutos e vermelho abaixo de 1 minuto), sem alertas sonoros inesperados, para preservar discrição no ambiente ao redor.
13. Como **Participante**, eu quero que, quando o servidor decretar o vencimento do **Contador de Inatividade** ou do teto de 24 horas, a **Sala** seja purgada imediatamente da RAM do servidor e ambos os navegadores transitem para a tela de expiração limpando mensagens e chaves locais.

### Criptografia E2EE com minimização de metadados

14. Como **Participante**, eu quero que os envelopes cifrados trafegados pelo servidor WebSocket carreguem apenas o payload autenticado e os metadados mínimos de roteamento, sem expor meu nome de exibição em texto claro em cada **Mensagem Efêmera**, para reduzir metadados observáveis no relay.
15. Como **Participante**, eu quero continuar utilizando o segredo `#k` no fragmento da URL e o código visual SAS derivado localmente no navegador via Web Crypto API, para detectar qualquer tentativa de interceptação mesmo sem confiar no servidor de relay.

### Chamada de Vídeo real com STUN/TURN e bloqueio server-side no Modo Tor

16. Como **Participante** no **Modo Normal**, eu quero que a **Chamada de Vídeo** entre dispositivos em redes diferentes utilize os servidores STUN públicos gratuitos do Google por padrão (e suporte servidores TURN opcionais configurados no ambiente), para que áudio, vídeo e compartilhamento de tela atravessem NATs comuns sem configuração manual.
17. Como **Participante** em rede restritiva onde a negociação WebRTC falhar mesmo após a troca de candidatos ICE, eu quero ver uma notificação clara de falha de conexão de mídia mantendo a troca de **Mensagens Efêmeras** funcionando normalmente, para que a conversa escrita não seja interrompida.
18. Como **Participante** em **Modo Tor**, eu quero que o servidor nunca envie configuração de servidores ICE e rejeite qualquer sinal de **Chamada de Vídeo** caso algum cliente alterado tente enviá-lo, para garantir em profundidade que nenhum endereço IP vaze por tráfego WebRTC.

### Zero-rastro, proteção anti-abuso e privacidade operacional

19. Como operador focado em privacidade, eu quero que o servidor desabilite access logs contendo endereço IP, `User-Agent`, query string, **Código da Sala** ou conteúdo das trocas, para que nenhum log identificável exista nem sequer em stdout ou stderr.
20. Como operador do servidor, eu quero que o controle de taxa e o bloqueio contra força bruta de **Código da Sala** operem integralmente em RAM indexados por hash HMAC com chave secreta rotativa efêmera, para mitigar abusos sem jamais armazenar endereços IP em claro.
21. Como operador do servidor, eu quero limites rígidos de tamanho máximo por mensagem trafegada (64 KB) e teto configurável de **Salas** simultâneas em RAM, para evitar exaustão de memória em uso público.

### Modo Tor com Onion Service v3 real e UX honesta

22. Como **Anfitrião** desejando anonimato reforçado, eu quero iniciar o launcher local do **Modo Tor** com um único comando e obter automaticamente um endereço `.onion` v3 funcional publicado pelo daemon Tor embutido/local, sem precisar editar arquivos de configuração manualmente.
23. Como **Anfitrião** no **Modo Tor**, eu quero acompanhar o progresso de inicialização da rede Tor e publicação do descritor do serviço até que o endereço `.onion` esteja pronto para compartilhamento, para evitar enviar ao **Convidado** um link ainda inalcançável no Tor Browser.
24. Como **Anfitrião** no **Modo Tor**, eu quero que a chave privada do endereço `.onion` permaneça exclusivamente na RAM do daemon Tor (sem persistir chave privada em disco) e que o diretório transitório `./tor_data` seja purgado tanto no boot quanto ao encerrar a sessão, para não deixar vestígios no sistema de arquivos mesmo após interrupção abrupta anterior.
25. Como **Anfitrião** acessando uma instância web em **Modo Normal**, eu quero receber orientação clara caso selecione **Modo Tor** na tela de entrada — sem exibição de endereço `.onion` fictício — explicando como executar o launcher local, para nunca ser induzido a acreditar que está protegido pelo Tor sem estar.
26. Como **Convidado** abrindo o link `.onion` compartilhado pelo **Anfitrião** no Tor Browser, eu quero ingressar diretamente na **Sala** em **Modo Tor** real com **Chamada de Vídeo** bloqueada e orientações compatíveis com os níveis de segurança do Tor Browser, para conversar exclusivamente em texto E2EE sobre o circuito `.onion`.

### Internacionalização e validação ponta a ponta

27. Como **Participante** em qualquer um dos quatro idiomas suportados (`pt-br`, `en`, `es`, `zh-CN`), eu quero que os novos estados de reconexão de rede, rejeições de limite de taxa/payload e orientações/estados do **Modo Tor** apareçam traduzidos no idioma ativo sem persistir minha escolha fora da memória da sessão.
28. Como mantenedor do projeto, eu quero uma suíte E2E em navegadores reais isolados conectados ao servidor em RAM servindo o build de produção, comprovando que mensagens cifradas e chamadas funcionam entre contextos distintos sem deixar rastros em storages nem logs identificáveis no servidor.

## Implementation Decisions

### Stack e arquitetura do servidor em RAM

- **Plataforma compartilhada no mesmo repositório:** O backend será implementado em **Node.js + TypeScript + Fastify** utilizando `@fastify/websocket` e `@fastify/static`, compartilhando definições de contrato e tipos com a SPA React + TypeScript + Vite já existente.
- **Mesma origem HTTP + WebSocket:** O processo Fastify serve o bundle estático compilado do frontend (com fallback de rota SPA), o endpoint de descoberta de runtime (`GET /api/runtime`), o endpoint neutro de saúde (`GET /healthz`) e o endpoint WebSocket (`/ws`) na mesma porta. Em desenvolvimento local, o servidor Vite realiza proxy transparente de `/ws` e `/api` para o backend Fastify.
- **Armazenamento exclusivo em RAM:** Todas as **Salas**, associações de **Participantes**, credenciais efêmeras de reconexão e contadores de proteção residem apenas em estruturas em memória no processo Node.js. Anexos efêmeros cifrados permanecem fora de escopo na Fase 2.

### Contrato de protocolo WebSocket e fronteira `RoomTransport`

- **WebSocket como transporte padrão:** O frontend passa a instanciar por padrão um adaptador `WebSocketTransport` implementando a interface existente `RoomTransport`, mantendo a interface da Fase 1 preservada na UI e na camada E2EE. O adaptador local `BroadcastChannelTransport` permanece disponível apenas mediante flag explícita de execução offline/local, e `InMemoryTransport` continua usado na suíte unitária/integração de UI.
- **Protocolo versionado em JSON:** A comunicação em `/ws` utiliza mensagens tipadas com versão explícita de protocolo para comandos (`create_room`, `join_room`, `reconnect_room`, `leave_room`, `encrypted_message`, `key_exchange`, `typing`, `call_signal`, `notify_activity`) e eventos (`room_joined`, `participant_joined`, `participant_left`, `encrypted_message`, `key_exchange`, `typing`, `call_signal`, `activity_reset`, `room_expired`, `room_error`).
- **Minimização de metadados nos envelopes E2EE:** O protocolo E2EE nativo da `Web Crypto API` (`ECDH P-256` não-extraível + `HKDF-SHA256` com `#k` + `AES-256-GCM` com IV determinístico de 96 bits + AAD + SAS) é mantido sem WebAssembly. Nos envelopes cifrados trafegados pela rede via WebSocket, o campo em claro `senderName` é removido da transmissão pelo relay; o nome de exibição temporário continua presente apenas no anúncio efêmero de presença ao entrar na **Sala**, e os remetentes são associados na UI pelo `senderId`/`senderRole` já autenticados na sessão.

### Ciclo de vida autoritativo da Sala e janela de graça

- **Autoridade temporal no servidor:** Ao criar uma **Sala**, o servidor registra o instante de criação (`createdAt`), fixa a expiração deslizante inicial em **60 minutos** (`expiresAt`) e fixa o teto absoluto rígido de **24 horas** (`hardExpiresAt`). Qualquer atividade legítima (**Mensagem Efêmera** aceita, ingresso de **Convidado** ou sinal explícito de atividade/heartbeat durante **Chamada de Vídeo**) recalcula `expiresAt = min(agora + 60m, hardExpiresAt)` e difunde `activity_reset` para os dois **Participantes**.
- **Saída explícita vs. queda de conexão:**
  - Quando o **Anfitrião** envia saída explícita (`leave_room`), a **Sala** é imediatamente encerrada e purgada da RAM, notificando o **Convidado** (caso presente) antes de fechar os sockets.
  - Quando o **Convidado** envia saída explícita, apenas sua vaga é liberada e o **Anfitrião** recebe `participant_left`, mantendo a **Sala** aberta para aceitar um novo **Convidado** (que iniciará novo acordo de chaves ECDH e resetará a sessão E2EE).
  - Ao ingressar ou criar uma **Sala**, o servidor devolve um `sessionToken` efêmero mantido exclusivamente na memória RAM da instância `WebSocketTransport` daquela aba. Em fechamento inesperado do socket (queda de rede), o servidor mantém a vaga reservada por **30 segundos** antes de disparar saída por desconexão (ou purgar a **Sala** inteira se ambos ficarem ausentes além da janela). Dentro desses 30 segundos, `WebSocketTransport` reconecta silenciosamente via `reconnect_room` apresentando `roomCode` + `sessionToken`, retomando a conversa com as chaves e contadores E2EE intactos. Recarregamento da página destrói a RAM do navegador e o `sessionToken`, respeitando a regra de zero recuperação de histórico.

### Sinalização WebRTC, servidores STUN/TURN e bloqueio no Modo Tor

- **Descoberta dinâmica de ICE no Modo Normal:** No evento `room_joined` em **Modo Normal**, o servidor fornece ao navegador a lista `iceServers` configurada para aquela instância. Por padrão sem configuração adicional, a lista inclui os servidores STUN públicos gratuitos do Google (`stun:stun.l.google.com:19302` e `stun:stun1.l.google.com:19302`), permitindo travessia básica de NAT imediatamente. Variáveis de ambiente permitem sobrescrever a lista de STUN e acoplar servidores TURN/coturn com credenciais estáticas (`TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL`) ou geração de credenciais temporárias baseadas em segredo compartilhado (`TURN_SECRET`, HMAC-SHA1 padrão coturn/REST).
- **Consumo na fronteira `MediaPort`:** `BrowserMediaPort` passa a aceitar e aplicar dinamicamente os `iceServers` entregues pela sessão ao construir `RTCPeerConnection`. Se a conexão peer-to-peer falhar, o estado de mídia reporta `connection_failed` na interface mantendo o transporte textual intacto.
- **Bloqueio estrito em Modo Tor:** Em **Salas** criadas com modo `tor`, o servidor **sempre omite `iceServers`** na resposta de entrada e **rejeita/descarta qualquer mensagem `call_signal`** recebida, complementando o bloqueio da interface no navegador.

### Política de zero-rastro, proteção anti-abuso e mitigação anti-printscreen

- **Zero logs identificáveis:** O logger HTTP e de erro do Fastify é configurado para nunca registrar acessos HTTP por requisição nem exibir endereços IP, cabeçalhos `User-Agent`, strings de consulta, **Códigos da Sala**, nomes de exibição ou payloads em stdout/stderr. Apenas eventos neutros de ciclo de vida do processo (inicialização de porta, término limpo) podem ser emitidos.
- **Rate-limit e proteção em RAM:** Cada processo gera na inicialização um segredo aleatório efêmero de 256 bits em RAM (rotacionado periodicamente em intervalos regulares). O identificador de origem para controle de taxa de conexões WebSocket, criação de **Salas** e tentativas inválidas de `join_room` (anti-força bruta de **Código da Sala**) é derivado via `HMAC-SHA256(ip, segredoRotativoEmRam)`, sem retenção do IP original.
- **Limites de payload e capacidade:** O servidor impõe limite máximo estrito de **64 KB** por frame WebSocket recebido e teto configurável de **Salas** simultâneas ativas em memória, retornando erro controlado quando excedido.
- **Mitigação anti-printscreen:** Permanece integralmente o pacote dissuasivo no navegador implementado na Fase 1 (`visibilitychange`/`blur`, `@media print`, `user-select: none`, supressão de `contextmenu`, marca d'água dinâmica e aviso transparente sobre as limitações do navegador). Proteção nativa de janela em nível de sistema operacional fica adiada para eventual empacotamento desktop futuro.

### Modo Tor: controlador do daemon, launcher local e runtime honesto

- **Contrato de runtime (`GET /api/runtime`):** O backend expõe `GET /api/runtime` retornando `{ runtimeMode: 'normal' | 'tor', onionAddress?: string, torStatus?: 'bootstrapping' | 'ready' | 'error' }`. A SPA consulta esse endpoint na inicialização:
  - Quando `runtimeMode === 'normal'`, o **Modo Tor** na tela de entrada informa de maneira honesta e localizada que exige execução local pelo **Anfitrião**, exibindo o comando do launcher local em vez de gerar um endereço `.onion` simulado.
  - Quando `runtimeMode === 'tor'` (ou quando acessada por domínio `.onion`), a interface trava a sessão em **Modo Tor**, preenche automaticamente o endereço `.onion` real emitido pelo servidor/URL e bloqueia todos os controles de **Chamada de Vídeo**.
- **Launcher local zero-config e `TorController`:** Um comando dedicado (`start:tor`) inicia o servidor Fastify restrito à interface loopback (`127.0.0.1`) acoplado à fronteira `TorController`. O controlador resolve o binário `tor` seguindo a precedência `PULSO_TOR_BIN` → binário local no diretório de ferramentas do projeto → `tor` no `PATH` (com script auxiliar documentado para obter/verificar o Tor Expert Bundle oficial quando ausente).
- **Provisionamento efêmero via ControlPort:** Ao iniciar, `TorController` remove preventivamente qualquer diretório residual `./tor_data`, gera configuração transitória isolada (`SocksPort 0`, `ControlPort auto`, `ControlPortWriteToFile`, `CookieAuthentication 1`, `AvoidDiskWrites 1`, `DataDirectory ./tor_data`), inicia o processo filho `tor`, autentica no ControlPort via mecanismo `SAFECOOKIE` (challenge-response HMAC-SHA256) e envia `ADD_ONION NEW:ED25519-V3 Flags=DiscardPK Port=80,127.0.0.1:<porta_local>`, garantindo que a chave privada Ed25519 do serviço `.onion` exista somente na RAM do daemon Tor. O endereço `<56-chars>.onion` só é marcado como pronto (`torStatus: 'ready'`) após o controlador confirmar `BOOTSTRAP` em `PROGRESS=100` e recebimento do evento `HS_DESC UPLOADED`.
- **Purga dupla garantida em encerramento:** Ao encerrar a **Sala**, expirar o contador ou receber sinais `SIGINT`/`SIGTERM`, o launcher envia `DEL_ONION` e `SIGNAL SHUTDOWN` pelo socket ControlPort (garantindo desligamento limpo inclusive no Windows), aguarda o término do daemon e executa remoção recursiva forçada de `./tor_data`. Caso o binário `tor` não seja encontrado ou falhe ao inicializar, o launcher reporta erro explícito acionando purga imediata sem deixar arquivos residuais.

## Testing Decisions

- **Princípio de testes:** Validar sempre comportamento observável pelas fronteiras públicas (`RoomTransport`, protocolo HTTP/WebSocket, `MediaPort`, `E2eeSession` e `TorController`), sem acoplar testes a estruturas internas privadas ou detalhes de implementação do Fastify.
- **Costuras e estratégia de verificação:**
  - **Backend HTTP + WebSocket em RAM (testes de integração reais):** Subir instâncias reais do servidor Fastify escutando em porta efêmera local (`127.0.0.1:0`) com relógio injetável e conectar múltiplos `WebSocketTransport` reais (ou clientes WebSocket) para exercitar criação/entrada, rejeição de 3º entrante, troca de chaves e mensagens sem `senderName` no wire, saída do **Anfitrião** vs. **Convidado**, reconexão silenciosa dentro da janela de 30s e expiração após 30s, vencimento dos 60 minutos deslizantes e do teto absoluto de 24h, limites de 64 KB/rate-limit, entrega de `iceServers` (STUN Google padrão e TURN/coturn com `TURN_SECRET`) e bloqueio server-side de `call_signal` no **Modo Tor**.
  - **Auditoria automatizada de logs:** Capturar stdout/stderr gerados durante uma sessão completa de criação, troca de mensagens e erros no servidor para afirmar que nenhum IP, `User-Agent`, query string ou **Código da Sala** aparece nos registros.
  - **Controlador Tor (`TorController`):** Como única nova costura externa da Fase 2 (para evitar dependência de rede Tor real em CI), testar `TorController` contra um servidor TCP ControlPort simulado em loopback e um diretório temporário real `./tor_data`, validando resolução de binário, leitura de porta e cookie, handshake `SAFECOOKIE`, emissão de `ADD_ONION NEW:ED25519-V3 Flags=DiscardPK`, espera por `BOOTSTRAP` + `HS_DESC UPLOADED`, envio de `DEL_ONION` + `SIGNAL SHUTDOWN` e eliminação física completa do diretório `./tor_data` tanto no boot preventivo quanto no desligamento.
  - **UI + Fluxos multi-navegador E2E (Playwright):** Executar contra o servidor Fastify real servindo o build compilado do frontend usando dois contextos de navegador completamente isolados (**Anfitrião** e **Convidado**), validando comunicação real E2EE entre contextos distintos, inspeção de frames WebSocket garantindo ausência de plaintext e de `senderName`, conferência **SAS**, reconexão de 30s, expiração autoritativa, **Chamada de Vídeo** no **Modo Normal**, runtime **Modo Tor** (com `TorController` controlado) com bloqueio de vídeo, responsividade mobile e storages completamente vazios ao final.
- **Prior art:** A Fase 1 estabeleceu os testes de UI orientados a papéis e comportamento observável montando a árvore completa atrás de `RoomTransport` e `MediaPort`, além da suíte Playwright com dois contextos. A Fase 2 preserva integralmente essa suíte e a estende com testes de contrato contra o servidor real em `127.0.0.1:0`.

## Out of Scope

- Empacotamento desktop (Electron ou Tauri v2) e proteção nativa de captura de tela em nível de janela do sistema operacional.
- Anexos efêmeros cifrados (envio de arquivos/imagens na conversa).
- Automação de infraestrutura em nuvem, HTTPS/TLS reverso, domínio público ou provisionamento de servidor TURN/coturn gerenciado (o sistema entrega suporte pronto por variáveis de ambiente e STUN público padrão do Google).
- Download automático não-supervisionado obrigatório em build (o projeto fornece apenas script auxiliar documentado opcional para obter/verificar o Tor Expert Bundle).
- Cadastro de contas, autenticação permanente, banco de dados ou histórico persistido após expiração/encerramento da **Sala**.
- Salas com mais de dois **Participantes** ou execução de áudio/vídeo sobre **Modo Tor**.

## Further Notes

- Especificação anterior do frontend (Fase 1): [pulso-frontend/spec.md](../pulso-frontend/spec.md).
- Glossário canônico de domínio: [GLOSSARY.md](../../GLOSSARY.md).
- Mapa Wayfinder e histórico de decisões: [map.md](../pulso/map.md).
- Pesquisas primárias que embasam esta especificação:
  - [01-stack-e-empacotamento-tor.md](../pulso/research/01-stack-e-empacotamento-tor.md)
  - [02-criptografia-e2ee-e-anti-screenshot.md](../pulso/research/02-criptografia-e2ee-e-anti-screenshot.md)
