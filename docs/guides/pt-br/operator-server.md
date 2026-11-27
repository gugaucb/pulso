# Guia do Operador — PULSO Servidor

[Português (BR)](./operator-server.md) · [English](../en/operator-server.md) · [Español](../es/operator-server.md) · [简体中文](../zh-CN/operator-server.md)

Este guia orienta o **Operador** na publicação e manutenção de uma **Instância** do **PULSO Servidor** (**Modo Normal**) em servidor próprio (VPS) ou em plataformas PaaS em 1 clique.

A imagem oficial `ghcr.io/gugaucb/pulso` (multi-arquitetura `linux/amd64` e `linux/arm64`) usa `gcr.io/distroless/nodejs22-debian12:nonroot` (UID `65532`), sistema de arquivos somente leitura (`read_only: true`), descarte de capacidades (`cap_drop: [ALL]`) e verificação nativa em `GET /healthz`.

---

## 1. Perfil mínimo vs. Perfil completo (`--profile full`)

O arquivo [`deploy/docker-compose.yml`](../../../deploy/docker-compose.yml) oferece dois modos de operação:

| Característica | Perfil mínimo (padrão) | Perfil completo (`--profile full`) |
| :--- | :--- | :--- |
| **Comando** | `docker compose up -d` | `docker compose --profile full up -d` |
| **Serviços** | Apenas `pulso` em `127.0.0.1:3001` | `pulso` + **Caddy** (TLS automático zero-registro) + **`coturn`** (`use-auth-secret`) |
| **Quando usar** | Quando já existe Nginx/Caddy/Traefik na frente do servidor | Para subir uma VPS completa do zero com HTTPS, `wss://` e **Chamada de Vídeo** atrás de NAT |
| **`TRUST_PROXY`** | `true` se houver proxy reverso na frente; `false` se direto | `true` obrigatório (Caddy encaminha `X-Forwarded-For` para isolar rate-limit em RAM por **Participante**) |

---

## 2. Subindo com `--profile full` em uma VPS (Caddy + `coturn`)

### Passo 1 — Liberar as portas no firewall da VPS

Libere exatamente estas portas antes de iniciar:

- **`80/tcp`**: desafio HTTP Let's Encrypt e redirecionamento para HTTPS (Caddy).
- **`443/tcp` e `443/udp`**: HTTPS, `wss://` e HTTP/3 (Caddy).
- **`3478/tcp` e `3478/udp`**: STUN/TURN do `coturn`.
- **`49160–49300/udp`**: faixa enxuta de mídia relay do `coturn` para **Chamada de Vídeo**.

### Passo 2 — Configurar o arquivo `.env`

Copie [`deploy/.env.example`](../../../deploy/.env.example) para `deploy/.env` e ajuste as variáveis essenciais:

```bash
cd deploy
cp .env.example .env
# Gere um segredo forte para TURN_SECRET:
openssl rand -hex 32
```

Variáveis principais em `deploy/.env`:

- `PULSO_DOMAIN`: domínio FQDN apontando para o IP da VPS (usado pelo Caddy para emitir certificado Let's Encrypt e como realm do `coturn`).
- `TRUST_PROXY=true`: garante que o `SecurityManager` isole o limite de taxa em RAM por **Participante** atrás do Caddy, sem gravar IPs em disco.
- `TURN_SECRET`: segredo compartilhado entre o backend (`server/iceConfig.ts`) e o `coturn` (`--use-auth-secret --static-auth-secret`).
- `TURN_URLS`: por exemplo, `turn:pulso.exemplo.com:3478?transport=udp,turn:pulso.exemplo.com:3478?transport=tcp`.
- `DETECT_EXTERNAL_IP=yes` e `DETECT_RELAY_IP=yes`: indispensáveis quando a VPS opera atrás de NAT 1:1 (AWS EC2, Oracle Cloud, Hetzner NAT, etc.) para que o `coturn` anuncie o IP público correto.
- `STUN_URLS`: lista de servidores STUN (ou vazio `""` para desativar).
- `PULSO_INACTIVITY_MS` (`3600000` = 1h), `PULSO_GRACE_WINDOW_MS` (`30000` = 30s) e `PULSO_MAX_ROOMS` (`1000`): controle do **Contador de Inatividade**, janela de reconexão e capacidade máxima de **Salas** em RAM.

### Passo 3 — Iniciar e validar

```bash
docker compose --profile full up -d
```

- O [`deploy/Caddyfile`](../../../deploy/Caddyfile) descarta registros de acesso (`output discard`), aplica cabeçalhos de privacidade (`Referrer-Policy: no-referrer`, HSTS, `-Server`) e faz proxy de HTTP e `wss://` para `pulso:3001`.
- O `coturn` roda em `network_mode: host` (evitando gargalo de UDP no `docker-proxy`), bloqueia IPs internos/privados/IMDS via `--denied-peer-ip` (anti-SSRF) e desativa escrita de registros em disco.

---

## 3. Modelos oficiais em 1 clique

| Plataforma | Arquivo no repositório | Rede e TURN | Observação importante |
| :--- | :--- | :--- | :--- |
| **Coolify** | [`deploy/coolify/docker-compose.yml`](../../../deploy/coolify/docker-compose.yml) | Inclui `coturn` integrado (`network_mode: host`) | Libere `3478/tcp+udp` e `49160–49300/udp` no firewall da VPS; o proxy do Coolify cuida do HTTPS/`wss://`. |
| **Portainer.io** | [`deploy/portainer/templates.json`](../../../deploy/portainer/templates.json) e [`deploy/portainer/docker-compose.yml`](../../../deploy/portainer/docker-compose.yml) | Stack completa (`pulso` + Caddy + `coturn`) | Cadastre `deploy/portainer/templates.json` como App Template ou use Stack Git apontando para `deploy/portainer/docker-compose.yml`. |
| **Render** | [`render.yaml`](../../../render.yaml) | PaaS HTTP/HTTPS/WebSocket apenas (sem UDP) | Use plano `starter` ou superior: o plano `free` suspende após ~15 min e descarta **Salas** em RAM. |
| **Fly.io** | [`fly.toml`](../../../fly.toml) | PaaS HTTP/HTTPS/WebSocket apenas (sem UDP) | Mantém `auto_stop_machines = false` e `min_machines_running = 1` para não destruir **Salas** ativas em RAM. |

---

## 4. Configurando TURN externo em PaaS HTTP (Render e Fly.io)

Como **Render** e **Fly.io** roteiam apenas tráfego HTTP/HTTPS/WebSocket (TCP) na borda padrão, não é possível hospedar o `coturn` dentro da mesma **Instância**. Sem um TURN externo, **Mensagens Efêmeras** em texto e **Chamadas de Vídeo** P2P (via STUN) funcionam em redes abertas, mas se os dois **Participantes** estiverem atrás de NAT simétrico ou firewall restritivo, o navegador exibirá aviso informando que a **Chamada de Vídeo** foi bloqueada enquanto o texto segue ativo.

Para habilitar **Chamada de Vídeo** em qualquer rede usando Render ou Fly.io, configure uma das duas opções de TURN externo:

1. **Opção A — `coturn` auto-hospedado em uma VPS dedicada:**
   Execute apenas o serviço `coturn` de `deploy/docker-compose.yml` em uma VPS com as portas `3478/tcp+udp` e `49160–49300/udp` liberadas, e defina na PaaS:
   - `TURN_URLS=turn:turn.seudominio.com:3478?transport=udp,turn:turn.seudominio.com:3478?transport=tcp`
   - `TURN_SECRET=<mesmo-segredo-do-coturn>`
2. **Opção B — Serviço TURN gerenciado (ex.: Cloudflare Realtime TURN):**
   Defina as credenciais estáticas nas variáveis da PaaS (sem definir `TURN_SECRET`):
   - `TURN_URLS=turn:turn.cloudflare.com:3478?transport=udp,turns:turn.cloudflare.com:5349?transport=tcp`
   - `TURN_USERNAME=<seu-usuario-turn>`
   - `TURN_CREDENTIAL=<sua-credencial-turn>`

> [!NOTE]
> Um servidor TURN externo observa os endereços IP e o volume de tráfego da **Chamada de Vídeo**, embora áudio e vídeo permaneçam cifrados de ponta a ponta via DTLS/SRTP. As **Mensagens Efêmeras** continuam passando apenas pela sua **Instância** com criptografia ponta a ponta no navegador.
