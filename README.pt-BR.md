<div align="center">

<img src="./docs/design/pulso-logo.jpg" alt="PULSO" width="120" />

# PULSO

**Comunicação efêmera 1:1 com criptografia de ponta a ponta — sem cadastro, sem banco de dados e zero-rastro.**

[![Licença: MIT](https://img.shields.io/badge/Licen%C3%A7a-MIT-5B3DF5.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![E2EE](https://img.shields.io/badge/E2EE-ECDH%20P--256%20%2B%20AES--256--GCM-0EA5E9)](#segurança-privacidade-e-modelo-de-ameaça)
[![Tor](https://img.shields.io/badge/Tor-Onion%20v3%20%2B%20lyrebird-7D4698?logo=torproject&logoColor=white)](./docs/tor-mode.md)
[![Idiomas](https://img.shields.io/badge/Idiomas-EN%20%7C%20PT--BR%20%7C%20ES%20%7C%20%E4%B8%AD%E6%96%87-1E293B)](#idiomas)

<p id="idiomas">
  <a href="./README.md">English</a> ·
  <strong>Português (BR)</strong> ·
  <a href="./README.es.md">Español</a> ·
  <a href="./README.zh-CN.md">简体中文</a>
</p>

</div>

---

O **PULSO** é uma aplicação de código aberto para comunicação efêmera 1:1 em situações que exigem privacidade. Dois **Participantes** (**Anfitrião** e **Convidado**) se encontram em uma **Sala** isolada mantida apenas em RAM e identificada por um **Código da Sala** (`XXXX-XXXX`), com criptografia ponta a ponta nativa do navegador, **Chamada de Vídeo** opcional no **Modo Normal** ou **Modo Tor** restrito a texto e publicado diretamente em um serviço `.onion` v3 efêmero.

---

## Recursos Principais

- **Sem cadastro e sem persistência:** sem criação de perfil, sem banco de dados e sem gravação em disco. Cada **Sala** existe exclusivamente em RAM e se autodestrói ao zerar o **Contador de Inatividade** ou quando o **Anfitrião** sai.
- **Criptografia ponta a ponta no navegador + verificação SAS:** negociação de chaves entre navegadores via `ECDH P-256` e `AES-256-GCM` (Web Crypto API), reforçada por segredo no fragmento `#k=` da URL (jamais enviado ao servidor) e verificação visual por código SAS.
- **Dois modos de operação:**
  - **Modo Normal:** troca de **Mensagem Efêmera** em texto com **Chamada de Vídeo** opcional par a par via WebRTC (áudio, câmera, compartilhamento de tela e alternância de layout) com STUN/TURN configurável.
  - **Modo Tor:** publica a **Sala** diretamente como um serviço Onion v3 em RAM (`ADD_ONION NEW:ED25519-V3 Flags=DiscardPK`) usando daemon C-Tor e `lyrebird` (`Snowflake`, `obfs4`, `webtunnel`, `meek_lite`). A **Chamada de Vídeo** é bloqueada no **Modo Tor** para evitar vazamento de IP via WebRTC.
- **Proteções antivigilância:** cortina automática de desfoque ao perder foco, bloqueio de impressão, marca d'água opcional na **Sala**, anonimização de IP em RAM com HMAC-SHA256 rotativo (zero registro de endereços em claro) e política zero *phone-home*.
- **Multilíngue e com temas:** interface em `Português (Brasil)`, `English`, `Español` e `简体中文`, nos modos claro e escuro.

---

## Distribuições Oficiais

Escolha a distribuição adequada à sua rede e ao seu modelo de ameaça:

| Distribuição | Para quem é | Como funciona | Guia |
| :--- | :--- | :--- | :--- |
| **PULSO Tor** | **Anfitrião** sob censura ou vigilância | Aplicativo desktop **Tauri v2** + sidecar Node.js SEA com `tor` e `lyrebird` embutidos (bridges e purga em `os.tmpdir()`), abrindo a **Sala** no navegador padrão | [Guia rápido do Anfitrião](./docs/guides/pt-br/host-quickstart.md) · [Verificação e Bridges](./docs/guides/pt-br/verification-offline-bridges.md) |
| **PULSO Local / Túnel** | **Anfitrião** atrás de CGNAT ou firewall doméstico | Mesma base desktop **Tauri v2** no **Modo Normal** com túnel reverso opt-in via `cloudflared` (`https://` + `wss://`), selo de transparência e **Chamada de Vídeo** *best-effort* | [Guia rápido do Anfitrião](./docs/guides/pt-br/host-quickstart.md) |
| **PULSO Servidor** | **Operador** em VPS ou PaaS | Imagem `distroless` endurecida multiarquitetura (`linux/amd64`, `linux/arm64`), `docker-compose.yml` (mínimo ou Caddy TLS zero-registro + `coturn`) e modelos em 1 clique | [Guia do Operador](./docs/guides/pt-br/operator-server.md) |

> Índice completo de documentação nos 4 idiomas: [docs/guides/README.md](./docs/guides/README.md).

---

## Como Iniciar e Utilizar

### 1. Anfitrião no Desktop (Sem Terminal)

1. Baixe o **PULSO Tor** ou o **PULSO Local / Túnel** para macOS (`.dmg`), Windows (`.exe` / `.zip` portátil) ou Linux (`.AppImage` / `.deb`) em [GitHub Releases](https://github.com/gugaucb/pulso/releases).
2. Confira `SHA256SUMS` e `SHA256SUMS.asc` (ou siga os 3 passos de abertura da v1 para Gatekeeper / SmartScreen) no [Guia rápido do Anfitrião](./docs/guides/pt-br/host-quickstart.md) e em [Verificação criptográfica, pendrive offline e bridges](./docs/guides/pt-br/verification-offline-bridges.md).
3. Inicie o aplicativo:
   - **PULSO Tor:** escolha *Conexão direta*, *Snowflake embutido* ou cole bridges privadas (mantidas apenas em RAM e em `os.tmpdir()`), aguarde o endereço `.onion` e clique para abrir a **Sala** no navegador padrão.
   - **PULSO Local / Túnel:** clique em **Iniciar Instância com Túnel** (ativação opt-in) para gerar o link público `https://*.trycloudflare.com` e abrir a **Sala** no navegador.
4. Ao encerrar, clique em **Encerrar e purgar rastro** na janela ou na bandeja do sistema para finalizar todos os processos filhos e apagar os arquivos temporários.

### 2. Operador — Auto-Hospedagem (Docker e Modelos 1-Clique)

Copie o modelo de configuração e suba o perfil mínimo (atrás de um proxy reverso existente) ou o perfil completo (**Caddy** com TLS automático zero-registro + servidor TURN **`coturn`** endurecido):

```bash
cp deploy/.env.example deploy/.env
# Edite deploy/.env (defina PULSO_DOMAIN e gere TURN_SECRET com `openssl rand -hex 32`)

# Perfil mínimo (escuta apenas em 127.0.0.1:3001)
docker compose -f deploy/docker-compose.yml up -d

# Perfil completo (PULSO + Caddy TLS + coturn TURN)
docker compose -f deploy/docker-compose.yml --profile full up -d
```

Modelos oficiais de implantação em 1 clique disponíveis no repositório:
- **Coolify:** [`deploy/coolify/docker-compose.yml`](./deploy/coolify/docker-compose.yml)
- **Portainer.io:** [`deploy/portainer/templates.json`](./deploy/portainer/templates.json)
- **Render:** [`render.yaml`](./render.yaml)
- **Fly.io:** [`fly.toml`](./fly.toml)

Consulte o [Guia do Operador](./docs/guides/pt-br/operator-server.md) para abertura de portas (`80/tcp`, `443/tcp+udp`, `3478/tcp+udp`, `49160-49300/udp`), `TRUST_PROXY` e configuração de TURN externo em PaaS HTTP.

### 3. Desenvolvimento Local a partir do Código-Fonte

**Pré-requisitos:**
- **Node.js `22+`** e **npm**
- *(Opcional, apenas para compilar a casca nativa Tauri)* **Rust** (`1.83+`) e dependências de sistema do Tauri

**Instalar e executar no Modo Normal (desenvolvimento):**

```bash
git clone https://github.com/gugaucb/pulso.git
cd pulso
npm install
npm run dev
```

O comando `npm run dev` sobe o servidor Fastify + WebSocket em `http://127.0.0.1:3001` e o Vite em `http://localhost:5173` (fazendo proxy de `/ws`, `/api` e `/healthz`).

**Executar o Modo Tor localmente a partir do código-fonte:**

```bash
npm run build
node scripts/fetch-tor-bundle.mjs
npm run start:tor
```

> Já possui o binário `tor` instalado no sistema? Informe o caminho diretamente: `PULSO_TOR_BIN=/caminho/para/tor npm run start:tor`. Mais detalhes em [docs/tor-mode.md](./docs/tor-mode.md).

**Principais comandos de compilação e verificação:**

| Comando | Finalidade |
| :--- | :--- |
| `npm run build` | Checa tipos TypeScript, gera a SPA (`dist/`) e empacota o servidor (`dist/server/`) |
| `npm run build:desktop-ui` | Compila a interface compacta do painel desktop (`dist-desktop/`) |
| `npm run build:sidecar` | Gera o executável sidecar em Node.js SEA (`scripts/build-sidecar.mjs`) |
| `npm start` | Inicia o servidor de produção no **Modo Normal** (`node dist/server/index.js`) |
| `npm test` | Executa a suíte de testes unitários e de integração com Vitest |
| `npm run test:e2e` | Executa os testes ponta a ponta no navegador com Playwright |

### 4. Como Utilizar uma Sala

1. **Criar uma Sala:** abra a interface web (ou deixe o app desktop abrir `127.0.0.1`), informe opcionalmente um nome de exibição temporário, selecione **Modo Normal** ou **Modo Tor** (travado automaticamente quando iniciado pelo **PULSO Tor**) e clique em **Criar Sala**.
2. **Convidar o Convidado:** compartilhe o **Código da Sala** (`XXXX-XXXX`), o link completo (`/?room=XXXX-XXXX#k=...` — mantendo `#k=` fora do servidor) ou o endereço `.onion` (no **Modo Tor**, aberto pelo **Convidado** no Tor Browser).
3. **Verificar a criptografia:** abra a verificação SAS e confirme o código curto com o outro **Participante** por uma via externa confiável.
4. **Conversar e purgar:** troquem **Mensagens Efêmeras** cifradas ponta a ponta (e iniciem uma **Chamada de Vídeo** no **Modo Normal** após pré-visualização). A atividade na conversa ou a renovação manual atualiza o **Contador de Inatividade**; ao sair, clicar em **Encerrar e purgar rastro** ou zerar o contador, toda a **Sala** é removida da RAM e os arquivos temporários são apagados.

---

## Segurança, Privacidade e Modelo de Ameaça

- **Conteúdo cifrado ponta a ponta:** as **Mensagens Efêmeras** são cifradas no navegador (`Web Crypto API`); o servidor apenas encaminha envelopes cifrados e impõe o limite estrito de 1:1 (dois **Participantes**).
- **Zero armazenamento permanente e sem rastreamento de IP:** o registro de requisições do `Fastify` é desativado, o `SecurityManager` aplica HMAC-SHA256 com segredo rotativo em RAM para limitação de taxa, e o **Modo Tor** grava `torrc` e cookie apenas em um diretório `0700` sob `os.tmpdir()` (`pulso-tor-*`), removido ao encerrar e ao iniciar.
- **Transparência de intermediário no túnel:** no **PULSO Local / Túnel**, ambos os **Participantes** visualizam um aviso explícito informando que a Cloudflare observa metadados e endereços IP do túnel reverso, enquanto as **Mensagens Efêmeras** continuam cifradas ponta a ponta.
- **Zero *phone-home*:** nenhuma distribuição desktop consulta servidores de atualização em segundo plano (o **PULSO Tor** não faz nenhuma requisição na clearnet; o **PULSO Local / Túnel** verifica novas versões apenas sob clique manual).

---

## Arquitetura e Tecnologias

```text
.
├── src/                  # SPA React 19, E2EE Web Crypto, MediaPort WebRTC, painel desktop
├── server/               # Servidor Fastify 5 + @fastify/websocket, RoomStore, TorController, CloudflaredAdapter, sidecar
├── shared/               # Contratos de protocolo compartilhados, sanitização de runtime e Código da Sala
├── src-tauri/            # Casca desktop Tauri v2 (bandeja, encerramento de árvore de processos, perfis tor/local)
├── deploy/               # Docker Compose (mínimo e completo Caddy/coturn), Caddyfile, modelos Coolify e Portainer
├── scripts/              # fetch-tor-bundle, fetch-cloudflared, build-sidecar (Node SEA), release e espelhos
├── docs/                 # Arquitetura do Modo Tor (tor-mode.md) e guias multilíngues (pt-br, en, es, zh-CN)
├── Dockerfile            # Imagem multi-stage distroless nonroot (UID 65532)
├── render.yaml           # Modelo 1-clique para Render
└── fly.toml              # Configuração 1-clique para Fly.io
```

**Tecnologias principais:** TypeScript · React 19 · Vite 6 · Tailwind CSS 4 · Fastify 5 · `@fastify/websocket` · Web Crypto API · WebRTC · C-Tor + `lyrebird` · `cloudflared` · Tauri v2 · Node.js 22 LTS SEA · Docker Distroless · Caddy · `coturn` · Vitest · Playwright.

---

## Referência de Configuração

Todas as variáveis são opcionais no uso local (veja [`deploy/.env.example`](./deploy/.env.example) para um modelo pronto para copiar):

| Variável | Padrão | Finalidade |
| :--- | :--- | :--- |
| `PORT` / `HOST` | `3001` / `0.0.0.0` | Porta e interface de escuta HTTP/WebSocket (`127.0.0.1` no desktop/**Modo Tor**) |
| `TRUST_PROXY` | `false` | Ative (`true`, `1` ou saltos) atrás do Caddy/proxy reverso para isolar limites por **Participante** |
| `STUN_URLS` | Google STUN | URLs STUN separadas por vírgula (`""` desativa STUN) |
| `TURN_URLS` | *(vazio)* | URLs TURN/TURNS separadas por vírgula para **Chamada de Vídeo** atrás de NAT simétrico |
| `TURN_SECRET` / `TURN_TTL_SECONDS` | *(vazio)* / `3600` | Segredo HMAC-SHA1 compartilhado com `coturn` (`use-auth-secret`) para credenciais efêmeras |
| `PULSO_INACTIVITY_MS` | `3600000` (1h) | Duração do **Contador de Inatividade** até a purga automática da **Sala** |
| `PULSO_GRACE_WINDOW_MS` | `30000` (30s) | Janela de reconexão em quedas transitórias |
| `PULSO_MAX_ROOMS` | `1000` | Limite máximo de **Salas** simultâneas em RAM na **Instância** |
| `PULSO_TOR_BIN` | *(automático)* | Caminho explícito para o executável `tor` (prioritário sobre `.tor-bin/` e `PATH`) |
| `PULSO_CLOUDFLARED_BIN` | *(automático)* | Caminho explícito para o executável `cloudflared` |

---

## Como Contribuir

Contribuições são muito bem-vindas!

1. Faça um fork de [gugaucb/pulso](https://github.com/gugaucb/pulso) e crie uma branch para sua melhoria.
2. Siga o vocabulário canônico de [GLOSSARY.md](./GLOSSARY.md) ao alterar textos da interface ou documentação.
3. Inclua ou atualize testes e valide antes de abrir o pull request:
   ```bash
   npm run build && npm test
   ```

## Segurança

Por favor, **não** abra issues públicas para relatar vulnerabilidades de segurança. Envie relatos de forma privada via [GitHub Security Advisories](https://github.com/gugaucb/pulso/security/advisories) para que possamos investigar e corrigir antes da divulgação.

## Licença

Distribuído sob a [Licença MIT](./LICENSE).
