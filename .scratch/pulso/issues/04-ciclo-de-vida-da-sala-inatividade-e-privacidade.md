# Definir ciclo de vida da Sala, Contador de Inatividade e garantias de zero-rastro

Type: grilling
Status: open

## Question

Definir regras exatas do ciclo de vida efêmero da **Sala**: duração padrão do **Contador de Inatividade** (e se é configurável pelo **Anfitrião**), quais eventos reiniciam o contador, se existe tempo máximo absoluto, avisos visuais/sonoros próximos do zeramento, comportamento em saída/reload/queda temporária, comportamento quando um 3º tenta entrar numa **Sala** 1:1 cheia, e contrato de zero-rastro (dados mínimos mantidos apenas em RAM no servidor, exclusão imediata na memória e no cliente, política de zero logs de IP/conteúdo).
