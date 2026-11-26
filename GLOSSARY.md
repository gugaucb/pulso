# PULSO

Comunicação efêmera 1:1 estilo Slack, sem cadastro, acessível por código alfanumérico, com texto cifrado ponta a ponta, chamada de vídeo opcional e suporte opcional à rede Tor.

## Language

**Sala**:
Espaço temporário e privado de comunicação 1:1 (máximo dois **Participantes**), identificado exclusivamente por um **Código da Sala**, sem cadastro nem conta permanente.
_Avoid_: Canal, grupo, chat, thread, workspace

**Código da Sala**:
Identificador alfanumérico curto e legível (ex.: `X9K2-P7M4`) que serve como único ingresso para entrar em uma **Sala**.
_Avoid_: Token, senha, chave de acesso, ID da sala

**Participante**:
Uma das duas pessoas presentes em uma **Sala**, sem obrigação de cadastro e opcionalmente identificada por um nome de exibição temporário.
_Avoid_: Usuário, conta, membro, cliente

**Anfitrião**:
O **Participante** que cria a **Sala** e compartilha o **Código da Sala** (ou o endereço `.onion` no **Modo Tor**) com o **Convidado**.
_Avoid_: Criador, dono, admin, host

**Convidado**:
O segundo **Participante** que ingressa em uma **Sala** existente a partir do **Código da Sala** ou link compartilhado pelo **Anfitrião**.
_Avoid_: Entrante, receptor, peer

**Modo Normal**:
Modo padrão de operação da **Sala**, acessível pela web comum e com suporte a **Mensagem Efêmera** e **Chamada de Vídeo**.
_Avoid_: Modo padrão, modo web, modo público

**Modo Tor**:
Modo opcional e anônimo de operação da **Sala**, publicado diretamente pelo **Anfitrião** em um endereço `.onion` e restrito a texto (**Mensagem Efêmera**), sem **Chamada de Vídeo**.
_Avoid_: Modo anônimo, modo onion, modo escuro

**Mensagem Efêmera**:
Mensagem trocada dentro de uma **Sala**, cifrada de ponta a ponta entre os **Participantes** e descartada definitivamente quando a **Sala** expira ou é encerrada.
_Avoid_: Mensagem, histórico, post, log

**Chamada de Vídeo**:
Sessão opcional de áudio e vídeo em tempo real dentro de uma **Sala** no **Modo Normal**, iniciada apenas após permissão e pré-visualização local do **Participante**.
_Avoid_: Reunião, videoconferência, call, live

**Contador de Inatividade**:
Relógio regressivo visível na **Sala** que indica o tempo restante sem atividade até a autodestruição da **Sala** e a purga imediata de todas as **Mensagens Efêmeras**.
_Avoid_: TTL, timeout, cronômetro, expiração
