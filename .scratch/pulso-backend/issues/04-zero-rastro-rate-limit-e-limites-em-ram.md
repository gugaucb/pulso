# 04: Garantia de zero-rastro, ausência de logs identificáveis e rate-limiting em RAM

**What to build:** Blindar o servidor Fastify com garantias auditáveis de zero-rastro e proteção contra abuso totalmente em memória RAM: desabilitar qualquer log HTTP ou de erro contendo dados identificáveis, aplicar limitação de taxa e proteção contra força bruta de **Código da Sala** indexadas exclusivamente por hash HMAC com chave secreta rotativa em RAM, e impor limites rígidos de tamanho de pacote e capacidade de **Salas** com mensagens localizadas na UI.

**Blocked by:** 02: Ciclo de vida 1:1, reconexão silenciosa de 30s e Contador de Inatividade autoritativo no servidor

**Status:** ready-for-agent

- [ ] Registro de logs HTTP desabilitado e logger do servidor configurado para nunca emitir endereços IP, cabeçalhos `User-Agent`, strings de consulta, **Códigos da Sala**, nomes de exibição ou conteúdo de mensagens em stdout ou stderr (emitindo apenas avisos operacionais neutros sem identificadores).
- [ ] Módulo de proteção em memória RAM gera um segredo efêmero de 256 bits na inicialização (rotacionado periodicamente em intervalos configuráveis) e deriva chaves anônimas via `HMAC-SHA256(ip, segredoRotativoEmRam)` sem jamais armazenar ou registrar endereços IP em claro.
- [ ] Controle de taxa por origem em RAM limita abertura de conexões WebSocket, criação excessiva de **Salas** e tentativas repetidas falhas de entrada por **Código da Sala** (mitigando enumeração/força bruta), devolvendo erro explícito controlado.
- [ ] Servidor impõe limite máximo estrito de **64 KB** por frame WebSocket recebido e teto configurável de **Salas** simultâneas ativas em RAM, encerrando ou rejeitando excedentes de forma limpa e previsível.
- [ ] Interface web traduz e exibe mensagens compreensíveis nos quatro idiomas (`pt-br`, `en`, `es`, `zh-CN`) quando uma solicitação for bloqueada por limite de taxa, tamanho de pacote ou capacidade do servidor.
- [ ] Testes automatizados exercitam rajadas de tentativas inválidas de **Código da Sala**, excesso de criação de **Salas**, frames acima de 64 KB e excesso de capacidade, e auditam a saída capturada de stdout/stderr durante fluxos completos confirmando ausência de IP, `User-Agent`, **Código da Sala** ou mensagens.
