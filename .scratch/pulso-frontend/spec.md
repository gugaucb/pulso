# PULSO — Especificação do Frontend (Fase 1)

Status: ready-for-agent

## Problem Statement

Pessoas que precisam trocar informações sensíveis ou fazer uma conversa rápida de voz e vídeo hoje enfrentam ferramentas estilo Slack que exigem cadastro, e-mail, criação de espaços permanentes e deixam rastros em servidores por tempo indeterminado. Por outro lado, alternativas temporárias costumam sacrificar usabilidade, não oferecem transparência sobre quando o conteúdo será destruído, não entregam criptografia ponta a ponta verificável no navegador nem contemplam cenários de anonimato reforçado via rede Tor.

## Solution

O frontend do **PULSO** entrega uma experiência completa, responsiva e interativa de comunicação efêmera 1:1 sem cadastro, guiada pelas referências visuais anexadas (*"PULSO — Converse. Conecte. Quando quiser."*). Em menos de cinco segundos, um **Anfitrião** cria uma **Sala** e compartilha o **Código da Sala** (ou link com segredo fora-de-banda), e um **Convidado** ingressa diretamente em uma interface inspirada no Slack (barra lateral escura fixa + área principal de troca de **Mensagens Efêmeras** + compositor inferior).

No **Modo Normal**, qualquer **Participante** pode ativar uma **Chamada de Vídeo** opcional após pré-visualização local, alternando entre layout híbrido, Picture-in-Picture e foco em vídeo. No **Modo Tor**, a interface adapta-se explicitamente para comunicação exclusiva em texto cifrado, desabilitando áudio e vídeo. Toda **Mensagem Efêmera** é cifrada e decifrada exclusivamente no cliente, protegida por mitigações anti-printscreen e regida por um **Contador de Inatividade** regressivo visível que purga tudo ao zerar. A aplicação suporta `pt-br`, `en`, `es` e `zh-CN`, temas claro e escuro fiéis ao design de referência, e funciona desde a Fase 1 entre abas reais do navegador por meio de uma fronteira de transporte desacoplada pronta para o backend da Fase 2.

## User Stories

### Entrada, criação e acesso à Sala

1. Como **Anfitrião**, eu quero criar uma nova **Sala** com um clique na tela inicial sem informar e-mail ou criar senha, para que eu comece a conversar em menos de cinco segundos.
2. Como **Anfitrião**, eu quero escolher entre **Modo Normal** e **Modo Tor** antes de abrir a **Sala**, para que eu decida se a sessão será web padrão (com vídeo opcional) ou restrita a texto sobre endereço `.onion`.
3. Como **Anfitrião**, eu quero ver o **Código da Sala** recém-gerado em destaque logo após a criação com confirmação visual (*"Sua sala foi criada!"*), para que eu tenha certeza imediata de que a **Sala** está pronta para compartilhar.
4. Como **Anfitrião**, eu quero copiar apenas o **Código da Sala** em um clique com feedback visual instantâneo, para que eu possa colá-lo rapidamente em outro aplicativo.
5. Como **Anfitrião**, eu quero compartilhar o link completo da **Sala** contendo o **Código da Sala** e o segredo criptográfico no fragmento da URL, para que o **Convidado** entre direto com proteção automática contra interceptação no servidor.
6. Como **Convidado**, eu quero digitar ou colar um **Código da Sala** no campo principal de entrada com formatação e normalização automática em tempo real, para que eu não erre por hífens ou letras minúsculas.
7. Como **Convidado**, eu quero acessar diretamente um link compartilhado e entrar na **Sala** correspondente sem precisar redigitar o **Código da Sala**, para que a entrada seja imediata.
8. Como **Participante**, eu quero preencher opcionalmente um nome de exibição antes de entrar (ou usar o padrão anônimo no idioma ativo), para que eu escolha entre me identificar temporariamente ou permanecer anônimo.
9. Como **Convidado**, eu quero visualizar estados claros de carregamento durante a entrada e mensagens de erro compreensíveis caso o **Código da Sala** seja inválido, malformado ou pertença a uma **Sala** já encerrada, para que eu saiba imediatamente por que não conectei.
10. Como terceiro interessado tentando ingressar em uma **Sala** já ocupada por dois **Participantes**, eu quero receber um aviso claro de que a **Sala** atingiu o limite 1:1, para que a privacidade da conversa em curso seja preservada.

### Modo Normal vs. Modo Tor na interface

11. Como **Anfitrião** em **Modo Tor**, eu quero ver instruções claras de preparação e compartilhamento do endereço `.onion` junto ao **Código da Sala**, para que eu saiba exatamente como convidar o outro **Participante** pelo Tor Browser.
12. Como **Participante** em **Modo Tor**, eu quero que o botão e os fluxos de **Chamada de Vídeo** apareçam explicitamente bloqueados com explicação de privacidade, para que eu tenha garantia visual de que nenhum tráfego de áudio ou vídeo ocorrerá fora do circuito Tor.
13. Como **Participante** em **Modo Tor**, eu quero ver um aviso discreto quando o nível de segurança do navegador puder restringir scripts sobre `.onion` HTTP, para que eu compreenda por que e como liberar a execução quando necessário.

### Interface principal da Sala (estilo Slack)

14. Como **Participante**, eu quero visualizar um cabeçalho fixo com o **Código da Sala** copiável, o status de conexão em tempo real e o indicador de presença (*"2 pessoas online"* ou *"Aguardando alguém…"*), para que eu tenha clareza constante do estado da **Sala**.
15. Como **Participante**, eu quero abrir um menu de opções (`⋯`) no cabeçalho com ações rápidas para copiar o link da **Sala**, abrir configurações de mídia/privacidade e sair da **Sala**, para que ações secundárias não poluam a tela principal.
16. Como **Participante** em desktop, eu quero visualizar uma barra lateral esquerda escura permanente com o logo **PULSO**, o **Código da Sala** atual copiável, a lista dos até dois **Participantes** (avatar, nome, status online e ícone de vídeo ativo), a seção *"Sobre a sala"* com o **Contador de Inatividade** e atalhos rápidos, para que eu tenha a hierarquia visual familiar do Slack.
17. Como **Anfitrião** aguardando o **Convidado**, eu quero ver um estado vazio amigável no centro da **Sala** convidando a compartilhar o **Código da Sala** e o link, para que eu não encare uma tela em branco confusa.
18. Como **Participante**, eu quero enviar **Mensagens Efêmeras** pelo compositor inferior usando `Enter` para enviar e `Shift+Enter` para quebrar linha, para que a digitação seja ágil no teclado.
19. Como **Participante**, eu quero inserir emojis por meio de um seletor acessível no compositor, para que eu me expresse rapidamente sem depender de atalhos do sistema operacional.
20. Como **Participante**, eu quero ver um botão de anexo no compositor com indicação clara de disponibilidade ou limite efêmero, para que a interface respeite o layout de referência sem prometer persistência inexistente.
21. Como **Participante**, eu quero que cada **Mensagem Efêmera** exiba avatar automático por iniciais, nome do **Participante**, timestamp relativo localizado (ex.: *"há 2 min"*) e bolha alinhada conforme autoria com destaque suave nas minhas próprias mensagens, para que a leitura da conversa seja instantânea.
22. Como **Participante**, eu quero ver um indicador discreto de *"digitando…"* com animação de reticências abaixo das mensagens quando o outro **Participante** estiver escrevendo, para que a conversa pareça viva em tempo real.
23. Como **Participante**, eu quero que a lista role automaticamente para a nova **Mensagem Efêmera** quando eu estiver no fim da conversa, mas mantenha minha posição de leitura e exiba um botão flutuante *"Ir para a última mensagem"* quando eu rolar para cima, para que novas mensagens não me façam perder o trecho que estou lendo.

### Chamada de Vídeo opcional (Modo Normal)

24. Como **Participante** no **Modo Normal**, eu quero clicar no ícone de câmera (desligado por padrão) para abrir um modal rápido de permissão e pré-visualização local da minha câmera e microfone antes de transmitir, para que eu valide enquadramento e dispositivos sem surpresas.
25. Como **Participante**, eu quero que a ativação da **Chamada de Vídeo** mude a **Sala** para o layout híbrido principal com o vídeo remoto em destaque acima da área compacta de **Mensagens Efêmeras**, minha pré-visualização em miniatura no canto superior direito, a pílula *"Você com câmera ligada"* e controles flutuantes (microfone, câmera, compartilhar tela, encerrar chamada e alternar layout), para que eu converse por vídeo e texto simultaneamente.
26. Como **Participante**, eu quero alternar o layout da **Chamada de Vídeo** entre modo híbrido principal, modo Picture-in-Picture (vídeo pequeno flutuante sobre a lista completa de **Mensagens Efêmeras**) e modo Foco em Vídeo (vídeo expandido com texto recolhido em aba lateral), para que eu priorize texto ou vídeo conforme o momento.
27. Como **Participante**, eu quero receber aviso claro na interface se o outro **Participante** desligar a câmera, silenciar ou sair da **Chamada de Vídeo**, para que eu entenda imediatamente o que mudou na chamada.
28. Como **Participante**, eu quero que, em caso de negação de permissão de mídia ou falha na **Chamada de Vídeo**, a **Sala** exiba um erro amigável e mantenha a troca de **Mensagens Efêmeras** funcionando normalmente, para que a conversa nunca seja interrompida por um problema de hardware ou rede.

### Criptografia E2EE, Contador de Inatividade e Anti-Printscreen

29. Como **Participante**, eu quero ver um indicador de proteção ponta a ponta na **Sala** e poder abrir o código visual de verificação mútua (SAS) para comparar com o outro **Participante**, para que possamos confirmar ausência de intermediários mesmo ao entrar apenas com o **Código da Sala**.
30. Como **Participante**, eu quero visualizar o **Contador de Inatividade** regressivo sempre visível na barra lateral e em área discreta no mobile, reiniciando automaticamente a cada nova atividade e destacando-se visualmente nos minutos finais antes de zerar, para que eu nunca seja pego de surpresa pela autodestruição da **Sala**.
31. Como **Participante**, eu quero que, ao zerar o **Contador de Inatividade** ou ao encerrar a **Sala**, todas as **Mensagens Efêmeras** e chaves locais sejam imediatamente eliminadas da memória da interface com tela de encerramento clara, para que nenhum conteúdo permaneça legível na tela após a expiração.
32. Como **Participante**, eu quero que a **Sala** solicite uma confirmação leve ao clicar em *"Sair da sala"* e limpe todos os dados locais da sessão ao confirmar, para que eu não saia por acidente nem deixe vestígios no navegador.
33. Como **Participante**, eu quero que a área de **Mensagens Efêmeras** seja automaticamente ocultada por desfoque quando a janela perder foco ou a aba for trocada, seja bloqueada na impressão e dificulte seleção casual e menu de contexto (com opção de marca d'água sutil na sessão), para que olhares curiosos ou capturas casuais sejam mitigados.
34. Como **Participante**, eu quero ler nas configurações de privacidade um aviso honesto explicando que as proteções anti-printscreen no navegador são dissuasivas e não impedem capturas pelo sistema operacional ou câmera externa, para que eu tome decisões conscientes de segurança.

### Tema, Acessibilidade, Responsividade, i18n e Simulação Fase 1

35. Como **Participante**, eu quero alternar entre o tema claro (fundo claro com barra lateral escura, conforme prancha principal) e o tema escuro nativo completo sem sair da **Sala**, para que a leitura seja confortável em qualquer ambiente.
36. Como **Participante** em smartphone, eu quero acessar uma interface adaptada com cabeçalho compacto, barra lateral convertida em gaveta deslizante (*drawer*), compositor ajustado à largura da tela e **Chamada de Vídeo** em tela cheia, para que o **PULSO** funcione com fluidez tanto no desktop quanto no mobile.
37. Como **Participante** que depende de leitor de tela ou teclado, eu quero navegar por todos os controles com foco visível, contraste mínimo AA e rótulos ARIA adequados (incluindo anúncios discretos de status e contador), para que a aplicação seja acessível.
38. Como **Participante** falante de português, inglês, espanhol ou chinês simplificado, eu quero que a interface detecte meu idioma inicial e me permita alternar entre `pt-br`, `en`, `es` e `zh-CN` na tela de entrada e no menu da **Sala**, traduzindo textos, timestamps relativos, formato do **Contador de Inatividade** e nome padrão anônimo sem persistir rastros da conversa.
39. Como avaliador ou desenvolvedor usando a Fase 1 sem backend externo, eu quero abrir duas abas do mesmo navegador — uma como **Anfitrião** e outra como **Convidado** — e trocar **Mensagens Efêmeras** cifradas, indicadores de *"digitando…"*, presença, **Contador de Inatividade** e fluxo de **Chamada de Vídeo** em tempo real entre elas, para que todo o produto possa ser validado interativamente desde já.

## Implementation Decisions

### Arquitetura em duas fases e fronteiras de módulo

- **Aplicação SPA desacoplada:** O frontend será construído como uma Single Page Application em React, TypeScript, Vite e Tailwind CSS, compilando para um pacote estático único consumível futuramente tanto pelo servidor Node/Fastify (**Modo Normal**) quanto pelo launcher local (**Modo Tor**) na Fase 2.
- **Fronteira única de rede (`RoomTransport`):** Toda comunicação com o exterior da **Sala** passa por uma única interface de transporte desacoplada, responsável por comandos (`createRoom`, `joinRoom`, `leaveRoom`, `sendEncryptedMessage`, `setTyping`, `sendCallSignal`, `notifyActivity`) e assinatura de eventos (presença 1:1, estado da conexão, pacotes cifrados recebidos, indicador de digitação, sinais de chamada, sincronização/expiração do **Contador de Inatividade** e erro de **Sala** cheia ou inexistente).
  - Na Fase 1, a implementação ativa padrão utiliza `BroadcastChannel` + estado volátil em memória compartilhado entre abas da mesma origem, permitindo testes reais **Anfitrião ↔ Convidado** entre duas abas (além de modo de demonstração assistida opcional quando testado em aba única).
  - Na Fase 2, o mesmo contrato será implementado por WebSocket sem qualquer alteração nos componentes visuais ou na camada criptográfica.
- **Fronteira única de mídia (`MediaPort`):** Toda interação com hardware e sessão de áudio/vídeo passa por uma única porta de mídia que encapsula listagem de dispositivos, captura de pré-visualização local, toggles de câmera e microfone, compartilhamento de tela e gerenciamento do fluxo de **Chamada de Vídeo**. Quando a **Sala** estiver em **Modo Tor**, a camada de aplicação impõe bloqueio estrito antes mesmo de acionar `MediaPort`.

### Design System e Identidade Visual (`PULSO`)

- **Identidade da marca:** Exibe o ícone de onda de pulso em gradiente índigo-para-roxo e o wordmark **PULSO**, acompanhado do subtítulo/slogan *"Converse. Conecte. Quando quiser."* (localizado em i18n) na tela de entrada e na área de estilo/sobre.
- **Sistema tipográfico:** Fonte principal `Inter` com suporte completo a pesos regular, médio, semibold e bold; pilha de fallback CJK nativa apropriada quando o idioma ativo for `zh-CN`; fonte monoespaçada tabular para o **Código da Sala**, **Contador de Inatividade** e código SAS.
- **Tokens semânticos de cor (Tema Claro e Tema Escuro):**
  - Marca primária: roxo/índigo vibrante (`#5B3DF5` / `#6344F5`) para botões primários, pílula *"Ir para a última mensagem"*, avatar próprio e acentos ativos, com estados hover/active acessíveis.
  - Acentos complementares: lavanda suave para bolhas do próprio **Participante** no tema claro (`#EEF0FF`) e roxo escuro translúcido no tema escuro (`#2D2856`), azul-ciano discreto para acentos secundários, verde (`#22C55E`) para presença online e indicador *"Você com câmera ligada"*, âmbar (`#F59E0B`) para alerta de **Contador de Inatividade** próximo ao fim, e vermelho (`#EF4444`) para encerrar chamada ou estado crítico de expiração.
  - Superfícies: barra lateral esquerda permanentemente escura (`#141522` / `#1B1D2C`) mesmo no tema claro (fiel às telas 2 e 4 das imagens de referência); área principal clara (`#F8F9FC` / `#FFFFFF` / `#F1F3F8` para bolhas recebidas) no tema claro e slate escuro (`#1A1C2A` / `#232638` para bolhas recebidas) no tema escuro. Contraste mínimo WCAG AA em todos os pares texto/superfície.
- **Arquitetura responsiva:**
  - **Desktop (`>= 768px`):** grade de duas colunas (barra lateral esquerda fixa + painel principal de conversa/chamada). Na **Chamada de Vídeo** modo híbrido principal, o palco de vídeo fica fixo no topo da coluna principal com miniatura PiP do vídeo local no canto superior direito, badge de câmera ligada no canto superior esquerdo e barra flutuante centralizada com 5 botões (microfone, câmera, compartilhar tela, encerrar chamada em vermelho e alternar layout), mantendo a lista de **Mensagens Efêmeras** e o compositor abaixo.
  - **Mobile (`< 768px`):** tela de entrada em coluna única centralizada; na **Sala**, cabeçalho compacto com botão de voltar/menu para abrir a barra lateral como *drawer* deslizante, código e contagem online condensados, ícone de câmera e menu `⋯`; na **Chamada de Vídeo**, opção padrão em tela cheia com acesso rápido ao painel de texto.

### Módulo Criptográfico E2EE no Cliente

- **Algoritmos e compatibilidade:** Implementação 100% executada no cliente usando `Web Crypto API` nativa (`ECDH P-256` + `HKDF-SHA256` + `AES-256-GCM`), garantindo funcionamento universal em navegadores modernos e no Tor Browser (inclusive sem depender de WebAssembly).
- **Prevenção de MITM sem cadastro:**
  - Ao criar a **Sala**, o cliente gera um segredo aleatório de 256 bits embutido apenas no fragmento `#k=...` da URL de compartilhamento (que nunca é enviado em requisições HTTP ao servidor).
  - Quando ambos os **Participantes** estão presentes, realizam acordo de chaves ECDH efêmero via `RoomTransport`, combinando o segredo derivado com o `#k` (quando presente) por meio de `HKDF-SHA256` para produzir chaves simétricas direcionais separadas (**Anfitrião → Convidado** e **Convidado → Anfitrião**) e uma Short Authentication String (SAS) visual de verificação mútua exibida na **Sala**.
- **Integridade e anti-replay:** Cada **Mensagem Efêmera** cifrada utiliza nonce/IV determinístico de 96 bits (32 bits de direção + 64 bits de contador monotônico) com dados autenticados (AAD) vinculando código e sequência; o receptor valida monotonicidade e descarta envelopes fora de ordem/repetidos.
- **Volatilidade de chaves:** Todas as chaves criptográficas permanecem apenas em referências de memória RAM da sessão React ativa; ao sair ou expirar a **Sala**, as referências são limpas e o estado criptográfico é reinicializado.

### Ciclo de Vida da Sala, Código da Sala e Contador de Inatividade

- **Formato do Código da Sala:** 8 caracteres alfanuméricos agrupados como `XXXX-XXXX` usando alfabeto maiúsculo sem caracteres visualmente ambíguos (`0`, `O`, `1`, `I`, `L` removidos). A entrada aceita colagem com ou sem hífen, converte para maiúsculas e valida em tempo real antes de acionar o transporte.
- **Cardinalidade 1:1:** O motor de **Sala** mantém exatamente dois papéis possíveis (**Anfitrião** e **Convidado**); qualquer tentativa adicional recebe estado de **Sala** ocupada sem vazar mensagens ou metadados da conversa.
- **Contador de Inatividade deslizante:** Inicia com contagem padrão de 60 minutos (exibida como *"Expira em 1h"* e em contagem regressiva `MM:SS` quando abaixo de 1 hora), reiniciando sempre que uma **Mensagem Efêmera** é enviada/recebida ou enquanto houver **Chamada de Vídeo** ativa. Quando restarem menos de 5 minutos, o contador entra em estado visual de alerta (âmbar) e abaixo de 1 minuto em estado crítico (vermelho) com banner discreto e opção de renovar atividade enviando uma mensagem ou confirmação de presença. Ao atingir `00:00`, a **Sala** transita imediatamente para estado expirado, remove todas as **Mensagens Efêmeras** da árvore de estado e do DOM, destrói chaves e encerra o transporte.

### Mitigação Anti-Printscreen e Política Zero-Rastro

- **Camada dissuasiva na UI:** O container da conversa monitora eventos `blur`/`focus` da janela e `visibilitychange` do documento para aplicar imediatamente desfoque e cortina opaca quando a janela perde foco ou fica oculta (configurável pelo **Participante** nas configurações de privacidade, ativado por padrão quando em uso sensível), aplica regras `@media print` ocultando toda a conversa, desabilita seleção de texto e menu de contexto nas bolhas de **Mensagem Efêmera**, e oferece camada opcional de marca d'água SVG dinâmica contendo o **Código da Sala** e carimbo temporal.
- **Transparência sobre limites técnicos:** O modal de configurações inclui explicação explícita informando que navegadores não impedem capturas nativas do sistema operacional ou fotos externas da tela.
- **Zero armazenamento persistente:** Nenhuma **Mensagem Efêmera**, **Código da Sala**, histórico ou chave de sessão é gravada em `localStorage`, `sessionStorage`, `IndexedDB` ou cookies.

### Internacionalização (i18n)

- **Idiomas suportados:** `pt-br` (fallback padrão), `en`, `es` e `zh-CN`.
- **Detecção e troca em runtime:** Detecta o idioma inicial pelo navegador (`navigator.languages`), permite troca imediata na tela de entrada e no menu da **Sala** (mantendo a escolha apenas na memória da sessão ativa para respeitar o princípio zero-rastro), adapta `document.documentElement.lang`, formata timestamps relativos (`Intl.RelativeTimeFormat`) e o **Contador de Inatividade**, e fornece rótulos padrão localizados para **Participante** sem nome preenchido (ex.: *"Visitante"* / *"Guest"* / *"Invitado"* / *"访客"*).

## Testing Decisions

- **Princípio orientador:** Os testes devem validar exclusivamente o comportamento observável da aplicação pela interface do usuário (consultando por papéis ARIA, rótulos traduzidos e texto visível na tela), sem depender de detalhes internos como nomes de hooks, estrutura de reducers/stores ou mocks de componentes filhos.
- **Estratégia de costuras e testes:**
  - **Integração de ponta a ponta da UI (Vitest + Testing Library):** Montar o componente raiz da aplicação injetando um par conectado de `RoomTransport` em memória, um `MediaPort` fake e relógios falsos controlados. Exercitar fluxos completos entre **Anfitrião** e **Convidado** usando a `Web Crypto API` real no ambiente de teste: criação e entrada por **Código da Sala**, rejeição de terceiro entrante, troca e decifragem de **Mensagens Efêmeras**, verificação do código SAS, digitação e botão *"Ir para a última mensagem"*, fluxo de **Chamada de Vídeo** (preview, layouts híbrido/PiP/foco, fallback de erro e bloqueio no **Modo Tor**), reação aos eventos de desfoque anti-printscreen, troca de tema claro/escuro e troca entre `pt-br`, `en`, `es` e `zh-CN`, além do avanço de timers até a expiração e purga completa do **Contador de Inatividade**.
  - **Unidade focada em invariantes críticas:** Testar diretamente apenas funções puras com regras críticas de segurança/domínio — normalização e validação do **Código da Sala**, derivação/cifragem/decifragem E2EE, rejeição de nonce repetido ou tag adulterada e garantia de não gravação em storages do navegador.
  - **E2E real em navegador (Playwright):** Abrir duas abas/contextos reais comunicando-se via implementação `BroadcastChannel` da Fase 1 em viewports desktop e mobile, validando renderização, responsividade (drawer mobile), envio real de mensagens cifradas entre abas, preview de mídia simulada pelo navegador e expiração/limpeza.
- **Prior art:** Este é um repositório greenfield sem suíte de testes pré-existente; esta especificação define a convenção inicial de testes do projeto.

## Out of Scope

- Implementação do backend em memória (Fastify/WebSocket), sinalização remota WebRTC, servidores STUN/TURN e deploy em produção (Fase 2).
- Daemon Tor embutido (`torrc`, ControlPort, geração real de Onion Service v3, purga de `./tor_data`) e empacotamento desktop (Tauri/Electron) com proteção nativa de captura de tela do sistema operacional (Fase 2).
- Cadastro de contas, login, autenticação persistente, recuperação de sessão ou histórico em banco de dados.
- Salas com mais de dois **Participantes** ou múltiplas **Salas** abertas simultaneamente na mesma instância.
- **Chamada de Vídeo** ou áudio sobre o **Modo Tor**.
- Persistência em disco ou armazenamento local (`localStorage`/`IndexedDB`) de mensagens, códigos ou metadados de **Sala**.

## Further Notes

- Referências visuais permanentes: [pulso-logo.jpg](../../docs/design/pulso-logo.jpg) e [pulso-reference-board.jpg](../../docs/design/pulso-reference-board.jpg).
- Glossário de domínio canônico: [GLOSSARY.md](../../GLOSSARY.md).
- Pesquisas técnicas que fundamentam as decisões desta especificação:
  - [01-stack-e-empacotamento-tor.md](../pulso/research/01-stack-e-empacotamento-tor.md)
  - [02-criptografia-e2ee-e-anti-screenshot.md](../pulso/research/02-criptografia-e2ee-e-anti-screenshot.md)
- Relação com o mapa do Wayfinder: esta especificação fecha o escopo de UX, design system e arquitetura do frontend (Fase 1) originado em [Fechar design system, fluxos de tela e microinterações do frontend PULSO](../pulso/issues/03-design-system-e-ux-das-telas-do-frontend.md) e rastreado em [map.md](../pulso/map.md). Os tickets restantes da Fase 2 (stack/distribuição, backend tempo real, protocolo E2EE servidor-cliente e Modo Tor) continuam abertos no mapa.
