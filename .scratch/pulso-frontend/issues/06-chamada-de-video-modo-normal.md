# 06: Fluxo completo de Chamada de Vídeo no Modo Normal (preview, layouts e fallback)

**What to build:** Introduzir a fronteira `MediaPort` e entregar o fluxo completo de **Chamada de Vídeo** opcional dentro da **Sala** no **Modo Normal**, desde o modal de permissão com pré-visualização local até os controles flutuantes, alternância entre três modos de layout (híbrido principal, Picture-in-Picture e Foco em Vídeo), avisos de estado remoto e fallback gracioso para texto.

**Blocked by:** 01: Tracer bullet: Entrada, criação/acesso à Sala 1:1 e troca básica de Mensagens Efêmeras entre abas, 02: Internacionalização (pt-br, en, es, zh-CN) e tema escuro nativo

**Status:** ready-for-agent

- [ ] Fronteira única `MediaPort` isolando permissões, enumeração de câmeras/microfones, pré-visualização local, compartilhamento de tela e sessão de áudio/vídeo, acompanhada de implementação real para navegador e fake determinístico para testes.
- [ ] Botão de câmera no cabeçalho (estado desligado por padrão) abre modal rápido solicitando permissão e exibindo pré-visualização local da câmera, indicador de áudio e seletores de dispositivo antes de iniciar a transmissão.
- [ ] Ao aceitar, a **Sala** assume o layout híbrido principal: vídeo remoto em destaque na parte superior, pré-visualização local em miniatura no canto superior direito, pílula verde *"Você com câmera ligada"* no canto superior esquerdo, controles flutuantes centralizados (microfone, câmera, compartilhar tela, encerrar chamada em vermelho e alternar layout) e lista de **Mensagens Efêmeras** + compositor preservados abaixo.
- [ ] Alternância fluida entre os três modos de visualização: layout híbrido principal, modo Picture-in-Picture (vídeo pequeno flutuante sobre a área completa de texto) e modo Foco em Vídeo (vídeo expandido com painel de texto recolhido em aba lateral).
- [ ] Lista de **Participantes** na barra lateral exibe indicador de vídeo ativo, e avisos claros na interface informam quando o outro **Participante** desliga a câmera, silencia o microfone ou encerra a **Chamada de Vídeo**.
- [ ] Em negação de permissão de câmera/microfone ou falha de mídia/conexão, exibe mensagem clara de fallback e mantém a troca de **Mensagens Efêmeras** funcionando sem interrupção.
- [ ] Testes de integração usando `MediaPort` fake validam abertura do preview, ativação da chamada, alternância dos três layouts, toggles de mídia/encerramento, notificações remotas e fallback gracioso em erro/negação.
