# Definir arquitetura do backend em memória, WebSocket e sinalização WebRTC

Type: grilling
Status: open
Blocked by: 04, 06, 07

## Question

Com base nos tickets [Definir ciclo de vida da Sala, Contador de Inatividade e garantias de zero-rastro](./04-ciclo-de-vida-da-sala-inatividade-e-privacidade.md), [Escolher stack full-stack e modelo de distribuição para Modo Normal e Modo Tor](./06-escolha-da-stack-e-arquitetura-de-distribuicao.md) e [Definir protocolo de criptografia E2EE e mitigações anti-printscreen](./07-protocolo-e2ee-e-mitigacao-anti-screenshot.md), especificar o backend em RAM sem persistência em disco: protocolo WebSocket (criação/entrada 1:1, presença, "digitando…", relay opaco E2EE, sincronização do **Contador de Inatividade** e purga), sinalização WebRTC + estratégia STUN/TURN e fallback para texto, rate-limit sem logs identificáveis e contrato compartilhado com o frontend da Fase 1.
