# 01: Tracer bullet: Entrada, criação/acesso à Sala 1:1 e troca básica de Mensagens Efêmeras entre abas

**What to build:** Inicializar a aplicação frontend do PULSO (React, TypeScript, Vite, Tailwind CSS e ambiente de testes), aplicar a base do design system (logo de pulso índigo/roxo, fonte Inter, tema claro com barra lateral esquerda escura fixa) e implementar a fronteira `RoomTransport` com adaptador local via `BroadcastChannel` para que um **Anfitrião** crie uma **Sala** 1:1, compartilhe o **Código da Sala** ou link, um **Convidado** entre no mesmo navegador em outra aba e ambos troquem **Mensagens Efêmeras** em tempo real.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Projeto frontend configurado com React, TypeScript, Vite, Tailwind CSS, Vitest e Testing Library executando build e testes limpos.
- [ ] Tela de entrada centralizada com marca **PULSO**, título *"Entre ou crie uma sala"*, campo de **Código da Sala**, nome de exibição opcional (padrão anônimo quando omitido), botão primário *"Entrar na sala"*, divisor *"ou"* e botão secundário *"Criar nova sala"*.
- [ ] Criação de **Sala** gera **Código da Sala** de 8 caracteres em formato `XXXX-XXXX` sem caracteres ambíguos (`0`, `O`, `1`, `I`, `L`), exibe confirmação *"Sua sala foi criada!"*, botão *"Copiar código"* em 1 clique com feedback visual e botão *"Compartilhar"* com link direto da **Sala**.
- [ ] Entrada do **Convidado** aceita digitação/colagem com normalização automática para maiúsculas e validação em tempo real, além de entrada automática ao abrir o link compartilhado.
- [ ] Estados claros de carregamento e erro para **Código da Sala** inválido, **Sala** expirada/inexistente e rejeição limpa quando um terceiro tenta entrar em uma **Sala** 1:1 já ocupada por dois **Participantes**.
- [ ] Fronteira única `RoomTransport` desacoplada da UI, com implementação padrão de Fase 1 baseada em `BroadcastChannel` + estado em memória permitindo comunicação real entre duas abas.
- [ ] Tela principal da **Sala** exibe cabeçalho fixo, barra lateral esquerda escura com código atual, lista de **Mensagens Efêmeras** com avatares gerados por iniciais, timestamp relativo e destaque visual nas próprias mensagens, além do compositor para envio.
- [ ] Testes de integração montam a aplicação no topo com par de `RoomTransport` em memória e validam pelos papéis/rótulos visíveis o fluxo completo **Anfitrião** cria **Sala** → **Convidado** entra → troca bidirecional de **Mensagens Efêmeras** → bloqueio de terceiro entrante.
