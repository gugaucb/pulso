# 05: Controlador do daemon Tor (SAFECOOKIE + ADD_ONION v3) e purga dupla garantida de ./tor_data

**What to build:** Construir a fronteira testável `TorController` que gerencia o ciclo de vida zero-config do Tor Expert Bundle localmente: localiza o binário `tor`, limpa preventivamente resíduos no boot, inicia o daemon isolado em `./tor_data`, autentica via `SAFECOOKIE`, provisiona um Onion Service v3 efêmero exclusivamente em RAM (`ADD_ONION` com descarte da chave privada), monitora prontidão (`BOOTSTRAP` e `HS_DESC UPLOADED`) e garante purga física completa de `./tor_data` ao encerrar.

**Blocked by:** 01: Tracer bullet: Servidor Fastify em RAM, WebSocketTransport padrão e Sala 1:1 entre navegadores distintos

**Status:** resolved

- [x] Resolução automática do binário `tor` seguindo a precedência `PULSO_TOR_BIN` (variável de ambiente) → binário local no diretório de ferramentas do projeto → `tor` no `PATH`, emitindo erro diagnóstico acionável caso não esteja disponível.
- [x] Documentação e script auxiliar opcional para obtenção e verificação de integridade do Tor Expert Bundle oficial para ambiente local do **Anfitrião**.
- [x] No startup do controlador, qualquer diretório `./tor_data` residual de execuções anteriores é removido recursivamente antes de gerar configuração transitória isolada (`SocksPort 0`, `ControlPort auto`, `ControlPortWriteToFile`, `CookieAuthentication 1`, `AvoidDiskWrites 1`, `DataDirectory ./tor_data`) e iniciar o processo filho `tor`.
- [x] Cliente do protocolo ControlPort implementa autenticação `SAFECOOKIE` (challenge-response HMAC-SHA256 com leitura do cookie local) e envia `ADD_ONION NEW:ED25519-V3 Flags=DiscardPK Port=80,127.0.0.1:<porta_local>`, garantindo que a chave privada `.onion` nunca seja escrita no disco.
- [x] Controlador assina eventos do daemon para acompanhar progresso até `BOOTSTRAP` em `PROGRESS=100` e aguardar `HS_DESC UPLOADED` antes de sinalizar estado pronto com o endereço `<56-chars>.onion`.
- [x] Desligamento limpo envia `DEL_ONION` e `SIGNAL SHUTDOWN` pelo ControlPort (funcionando de forma uniforme em macOS, Linux e Windows), aguarda encerramento do processo filho e executa remoção recursiva forçada de `./tor_data`, garantindo ausência de vestígios no sistema de arquivos mesmo em falha de inicialização.
- [x] Testes automatizados contra servidor TCP ControlPort simulado e diretório temporário real validam precedência do binário, leitura de porta/cookie, handshake `SAFECOOKIE`, sequência `ADD_ONION` → `BOOTSTRAP` → `HS_DESC UPLOADED`, emissão de `DEL_ONION`/`SIGNAL SHUTDOWN` e eliminação física dupla de `./tor_data`.

## Comments

- Resolved on integration branch `feat/pulso-backend` (merged in `271b030`, refined after code review in `10cb0bb`). Verified via `npm run build`, Vitest (`npm test`, 30/30 files, 149/149 tests), and Playwright E2E (`npm run test:e2e`, 11/11 tests).
