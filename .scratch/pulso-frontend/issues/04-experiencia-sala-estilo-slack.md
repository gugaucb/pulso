# 04: Experiência completa da Sala estilo Slack (presença, "digitando…", scroll inteligente, emojis e saída segura)

**What to build:** Completar todas as interações e o acabamento visual da tela principal da **Sala** fiel ao estilo Slack das referências anexadas: presença em tempo real na barra lateral, estado vazio amigável, indicador de *"digitando…"*, rolagem inteligente com botão de retorno, animações sutis de mensagem, compositor completo com atalhos/emojis/anexos efêmeros e saída com confirmação e limpeza imediata.

**Blocked by:** 01: Tracer bullet: Entrada, criação/acesso à Sala 1:1 e troca básica de Mensagens Efêmeras entre abas, 02: Internacionalização (pt-br, en, es, zh-CN) e tema escuro nativo

**Status:** resolved

- [x] Cabeçalho fixo exibe **Código da Sala** copiável, indicador discreto de status da conexão, contagem de presença atualizada em tempo real (*"2 pessoas online"* / *"Aguardando alguém…"*) e menu `⋯` com ações de copiar link, abrir configurações e sair da **Sala**.
- [x] Barra lateral esquerda exibe bloco *"Sala atual"*, lista dos até dois **Participantes** com avatar, nome, bolinha de status online/offline e ícone de vídeo ativo, além da seção de atalhos rápidos (*"Copiar link"*, *"Configurações"*, *"Sair da sala"*).
- [x] Estado vazio amigável exibido enquanto o **Anfitrião** aguarda o **Convidado**, convidando a compartilhar o **Código da Sala** ou link.
- [x] Indicador discreto *"digitando…"* com animação de reticências aparece abaixo das **Mensagens Efêmeras** quando o outro **Participante** digita e desaparece ao enviar ou parar de digitar.
- [x] Rolagem automática acompanha novas **Mensagens Efêmeras** quando o **Participante** está no fim da lista; ao rolar para cima, mantém a posição de leitura e exibe o botão flutuante *"Ir para a última mensagem"* que rola suavemente até o fim ao clicar.
- [x] **Mensagens Efêmeras** chegam com animação sutil de aparecimento e mantêm distinção visual clara entre autoria própria e do outro **Participante**.
- [x] Compositor inferior multilinha envia com `Enter`, insere quebra de linha com `Shift+Enter`, oferece seletor acessível de emojis e inclui botão de anexo com indicação clara da política efêmera sem persistência em disco.
- [x] Ação *"Sair da sala"* exige confirmação leve e, ao confirmar, desconecta do transporte, limpa estado, mensagens e chaves locais e retorna à tela de entrada.
- [x] Testes de integração cobrem presença em tempo real, estado vazio, indicador de digitação, comportamento de auto-scroll + botão *"Ir para a última mensagem"*, atalhos do compositor, inserção de emoji e limpeza na saída.

## Comments

- Resolved on integration branch `feat/pulso-frontend` (merged in `44707a9`, refined in `ba5fcb8`). Verified via `npx tsc --noEmit`, Vitest (`npm test`), `vite build`, and Playwright E2E (`npm run test:e2e`).
