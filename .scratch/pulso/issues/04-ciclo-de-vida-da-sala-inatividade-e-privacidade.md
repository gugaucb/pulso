# Definir ciclo de vida da Sala, Contador de Inatividade e garantias de zero-rastro

Type: grilling
Status: resolved

## Question

Definir regras exatas do ciclo de vida efêmero da **Sala**: duração padrão do **Contador de Inatividade** (e se é configurável pelo **Anfitrião**), quais eventos reiniciam o contador, se existe tempo máximo absoluto, avisos visuais/sonoros próximos do zeramento, comportamento em saída/reload/queda temporária, comportamento quando um 3º tenta entrar numa **Sala** 1:1 cheia, e contrato de zero-rastro (dados mínimos mantidos apenas em RAM no servidor, exclusão imediata na memória e no cliente, política de zero logs de IP/conteúdo).

## Answer

Decisões consolidadas na especificação da Fase 2 ([spec.md](../../pulso-backend/spec.md)):

- **Contador de Inatividade:** duração deslizante fixa de **60 minutos** (sem seletor na interface para preservar a limpeza visual), reiniciada autoritativamente pelo servidor a cada **Mensagem Efêmera**, entrada de **Participante** ou heartbeat durante **Chamada de Vídeo**.
- **Teto máximo absoluto:** limite rígido de **24 horas** de vida contínua da **Sala** no servidor, mesmo com atividade contínua, impedindo retenção indefinida em RAM.
- **Avisos próximos do zeramento:** exclusivamente visuais (`< 5 min` em estado âmbar e `< 1 min` em estado crítico vermelho), sem alertas sonoros inesperados.
- **Saída, reload e queda temporária:**
  - Saída explícita do **Anfitrião** encerra e purga a **Sala** imediatamente para ambos os **Participantes**.
  - Saída explícita do **Convidado** mantém a **Sala** aberta para o **Anfitrião** (um novo **Convidado** ingressa realizando novo acordo de chaves E2EE).
  - Queda abrupta de conexão mantém a vaga do **Participante** por uma janela de graça de **30 segundos** com reconexão silenciosa via `sessionToken` mantido apenas na RAM da aba (sem `localStorage`/`sessionStorage`); expirada a janela sem retorno, a vaga é liberada ou a **Sala** vazia é purgada.
  - Recarregamento completo da aba limpa o estado local por design, sem recuperação de histórico.
- **Cardinalidade 1:1:** tentativa de ingresso de um terceiro **Participante** retorna erro explícito de **Sala** cheia (`room_full`) sem expor mensagens ou metadados da conversa.
- **Contrato de zero-rastro:** estado mínimo mantido exclusivamente em RAM no servidor, purga imediata em memória no servidor e nos navegadores ao encerrar/expirar, zero gravação em disco ou storages persistentes do navegador, e zero access logs identificáveis (sem IP, `User-Agent`, query string ou **Código da Sala**).
