# 06: Launcher local do Modo Tor, endpoint /api/runtime e UX honesta entre Modo Normal e Modo Tor

**What to build:** Conectar o servidor Fastify ao `TorController` através de um launcher local dedicado ao **Modo Tor** (`start:tor`), expor o endpoint `GET /api/runtime` para que a interface web reflita honestamente o modo real da instância — eliminando a geração de endereços `.onion` simulados quando rodando em **Modo Normal** e travando automaticamente a experiência em **Modo Tor** real com endereço `.onion` válido e vídeo bloqueado quando executada pelo launcher ou acessada via `.onion`.

**Blocked by:** 02: Ciclo de vida 1:1, reconexão silenciosa de 30s e Contador de Inatividade autoritativo no servidor, 03: Sinalização WebRTC real com STUN Google padrão, suporte a TURN e bloqueio server-side no Modo Tor, 05: Controlador do daemon Tor (SAFECOOKIE + ADD_ONION v3) e purga dupla garantida de ./tor_data

**Status:** resolved

- [x] Backend expõe `GET /api/runtime` retornando `{ runtimeMode: 'normal' | 'tor', onionAddress?: string, torStatus?: 'bootstrapping' | 'ready' | 'error' }` em conformidade com o modo ativo do servidor, sem expor identificadores de **Sala** ou **Participantes**.
- [x] Launcher local (`start:tor`) inicia o servidor Fastify restrito à interface `127.0.0.1` acoplado ao `TorController`, exibe no terminal a URL local para o **Anfitrião** (`http://127.0.0.1:<porta>`) e acompanha `torStatus` até o endereço `.onion` estar publicado, executando shutdown limpo e purga de `./tor_data` ao encerrar/expirar ou receber `SIGINT`/`SIGTERM`.
- [x] Na inicialização, a SPA consulta `GET /api/runtime`: em instância `normal`, selecionar **Modo Tor** na tela de entrada apresenta orientação clara e traduzida nos quatro idiomas explicando que o **Modo Tor** requer executar o launcher local (em vez de fabricar um `.onion` fictício); em instância `tor` (ou quando acessada por domínio `.onion`), a entrada trava a criação em **Modo Tor**, exibe status de preparação/prontidão do `.onion`, preenche automaticamente o endereço `.onion` real nos links compartilhados e bloqueia todos os fluxos de **Chamada de Vídeo**.
- [x] Link compartilhado pelo **Anfitrião** no **Modo Tor** compõe corretamente o endereço `http://<56-chars>.onion/?room=<codigo>&mode=tor#k=<segredo>`, mantendo o aviso compatível com os níveis de segurança (*Standard* / *Safer* / *Safest*) do Tor Browser.
- [x] Testes de integração cobrem consulta a `/api/runtime` nos dois modos, fluxo completo da UI em runtime `normal` (aviso honesto sem `.onion` falso) e em runtime `tor` (travamento em **Modo Tor**, transição de `bootstrapping` para `ready`, preenchimento do `.onion` real e bloqueio de vídeo), além do tratamento limpo quando o binário `tor` não está presente.

## Comments

- Resolved on integration branch `feat/pulso-backend` (merged in `1f00b63`, refined after code review in `10cb0bb` to wire automatic `TorController` shutdown and `./tor_data` purge on Host close or room expiry). Verified via `npm run build`, Vitest (`npm test`, 30/30 files, 149/149 tests), and Playwright E2E (`npm run test:e2e`, 11/11 tests).
