# 05: Contador de Inatividade regressivo, alertas de expiração e autodestruição com purga

**What to build:** Implementar o **Contador de Inatividade** regressivo visível na **Sala** com reinício automático por atividade, alertas visuais progressivos próximos ao zeramento e autodestruição imediata da **Sala** com purga total das **Mensagens Efêmeras** e das chaves criptográficas quando o tempo se esgotar.

**Blocked by:** 03: Criptografia E2EE no cliente, link com #k e verificação visual SAS, 04: Experiência completa da Sala estilo Slack (presença, "digitando…", scroll inteligente, emojis e saída segura)

**Status:** ready-for-agent

- [ ] **Contador de Inatividade** exibido na seção *"Sobre a sala"* da barra lateral (e em local visível no mobile) iniciando com 60 minutos (*"Expira em 1h"* e formato regressivo tabular `MM:SS` quando abaixo de uma hora).
- [ ] Envio ou recebimento de **Mensagem Efêmera**, confirmação manual de presença ou atividade em **Chamada de Vídeo** reiniciam o **Contador de Inatividade** de forma sincronizada entre os **Participantes**.
- [ ] Alertas visuais progressivos quando o tempo se aproxima do fim: destaque em âmbar abaixo de 5 minutos e destaque crítico em vermelho abaixo de 1 minuto com aviso claro e botão rápido para estender/renovar atividade.
- [ ] Ao atingir `00:00`, a **Sala** é destruída imediatamente: todas as **Mensagens Efêmeras** são removidas da árvore de estado e do DOM, chaves E2EE são descartadas da memória, o `RoomTransport` é encerrado e ambos os **Participantes** visualizam uma tela clara informando a expiração e purga definitiva.
- [ ] Testes de integração com relógios falsos controlados verificam a regressão exata do contador, o reinício por atividade, os estados visuais de alerta (< 5 min e < 1 min) e a purga irreversível do conteúdo da tela e da memória ao zerar.
