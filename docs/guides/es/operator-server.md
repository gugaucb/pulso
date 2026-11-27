# Guía del Operador — PULSO Servidor

[Português (BR)](../pt-br/operator-server.md) · [English](../en/operator-server.md) · [Español](./operator-server.md) · [简体中文](../zh-CN/operator-server.md)

Esta guía ayuda al **Operador** a desplegar y mantener una **Instancia** autoalojada de **PULSO Servidor** (**Modo Normal**) en un VPS o mediante plantillas PaaS en 1 clic.

La imagen oficial `ghcr.io/gugaucb/pulso` (multiarquitectura `linux/amd64` y `linux/arm64`) usa `gcr.io/distroless/nodejs22-debian12:nonroot` (UID `65532`), sistema de archivos de solo lectura (`read_only: true`), `cap_drop: [ALL]` y comprobación nativa en `GET /healthz`.

---

## 1. Perfil mínimo frente a Perfil completo (`--profile full`)

[`deploy/docker-compose.yml`](../../../deploy/docker-compose.yml) incluye dos perfiles:

| Característica | Perfil mínimo (predeterminado) | Perfil completo (`--profile full`) |
| :--- | :--- | :--- |
| **Comando** | `docker compose up -d` | `docker compose --profile full up -d` |
| **Servicios** | Solo `pulso` en `127.0.0.1:3001` | `pulso` + **Caddy** (TLS automático cero registros) + **`coturn`** (`use-auth-secret`) |
| **Uso ideal** | Detrás de un proxy inverso existente (Nginx/Caddy/Traefik) | Despliegue completo en VPS con HTTPS, `wss://` y **Videollamadas** detrás de NAT |
| **`TRUST_PROXY`** | `true` si hay proxy delante; `false` si es acceso directo | `true` obligatorio (Caddy reenvía la IP para aislar el rate-limit en RAM por **Participante**) |

---

## 2. Despliegue `--profile full` en un VPS (Caddy + `coturn`)

### Paso 1 — Abrir puertos en el firewall

Permite exactamente estos puertos en el firewall del VPS antes de iniciar:

- **`80/tcp`**: desafío HTTP Let's Encrypt y redirección a HTTPS (Caddy).
- **`443/tcp` y `443/udp`**: HTTPS, `wss://` y HTTP/3 (Caddy).
- **`3478/tcp` y `3478/udp`**: señalización STUN/TURN de `coturn`.
- **`49160–49300/udp`**: rango reducido de medios relay de `coturn` para **Videollamadas**.

### Paso 2 — Configurar `.env`

Copia [`deploy/.env.example`](../../../deploy/.env.example) a `deploy/.env` y ajusta las variables clave:

```bash
cd deploy
cp .env.example .env
# Genera un secreto robusto para TURN_SECRET:
openssl rand -hex 32
```

Variables principales en `deploy/.env`:

- `PULSO_DOMAIN`: dominio FQDN apuntando a la IP del VPS (usado por Caddy para TLS y como realm de `coturn`).
- `TRUST_PROXY=true`: permite que `SecurityManager` aísle el rate-limit en RAM por **Participante** detrás de Caddy sin guardar IPs en disco.
- `TURN_SECRET`: secreto HMAC compartido entre el servidor (`server/iceConfig.ts`) y `coturn` (`--use-auth-secret --static-auth-secret`).
- `TURN_URLS`: por ejemplo, `turn:pulso.ejemplo.com:3478?transport=udp,turn:pulso.ejemplo.com:3478?transport=tcp`.
- `DETECT_EXTERNAL_IP=yes` y `DETECT_RELAY_IP=yes`: esenciales en VPS detrás de NAT 1:1 (AWS EC2, Oracle Cloud, etc.) para que `coturn` anuncie la IP pública correcta.
- `STUN_URLS`: lista separada por comas (o `""` para desactivar STUN).
- `PULSO_INACTIVITY_MS` (`3600000` = 1h), `PULSO_GRACE_WINDOW_MS` (`30000` = 30s) y `PULSO_MAX_ROOMS` (`1000`): **Temporizador de Inactividad**, ventana de reconexión y máximo de **Salas** en RAM.

### Paso 3 — Iniciar y comprobar

```bash
docker compose --profile full up -d
```

- [`deploy/Caddyfile`](../../../deploy/Caddyfile) descarta registros de acceso (`output discard`), añade cabeceras de privacidad (`Referrer-Policy: no-referrer`, HSTS, `-Server`) y hace proxy HTTP + `wss://` hacia `pulso:3001`.
- `coturn` usa `network_mode: host` (evitando cuello de botella UDP en `docker-proxy`), bloquea rangos privados/IMDS con `--denied-peer-ip` (anti-SSRF) y desactiva registros en disco.

---

## 3. Plantillas oficiales en 1 clic

| Plataforma | Archivo en el repositorio | Red y TURN | Nota importante |
| :--- | :--- | :--- | :--- |
| **Coolify** | [`deploy/coolify/docker-compose.yml`](../../../deploy/coolify/docker-compose.yml) | Incluye `coturn` integrado (`network_mode: host`) | Abre `3478/tcp+udp` y `49160–49300/udp` en el firewall del VPS; el proxy de Coolify gestiona HTTPS/`wss://`. |
| **Portainer.io** | [`deploy/portainer/templates.json`](../../../deploy/portainer/templates.json) y [`deploy/portainer/docker-compose.yml`](../../../deploy/portainer/docker-compose.yml) | Stack completa (`pulso` + Caddy + `coturn`) | Registra `deploy/portainer/templates.json` como App Template o usa un Git Stack hacia `deploy/portainer/docker-compose.yml`. |
| **Render** | [`render.yaml`](../../../render.yaml) | PaaS solo HTTP/HTTPS/WebSocket (sin UDP) | Usa el plan `starter` o superior: el plan `free` suspende tras ~15 min y borra **Salas** en RAM. |
| **Fly.io** | [`fly.toml`](../../../fly.toml) | PaaS solo HTTP/HTTPS/WebSocket (sin UDP) | Configura `auto_stop_machines = false` y `min_machines_running = 1` para no destruir **Salas** activas en RAM. |

---

## 4. Configurar TURN externo en PaaS HTTP (Render y Fly.io)

Como **Render** y **Fly.io** solo enrutan HTTP/HTTPS/WebSocket (TCP), no es posible ejecutar `coturn` dentro de la misma **Instancia**. Sin TURN externo, los **Mensajes Efímeros** de texto y las **Videollamadas** P2P (vía STUN) funcionan en redes abiertas, pero si ambos **Participantes** están detrás de NAT simétrico o firewall estricto, la interfaz avisa que la **Videollamada** fue bloqueada mientras el texto sigue operativo.

Para habilitar **Videollamadas** en cualquier red desde Render o Fly.io, configura una de estas dos opciones:

1. **Opción A — `coturn` autoalojado en un VPS dedicado:**
   Ejecuta solo el servicio `coturn` de `deploy/docker-compose.yml` en un VPS con `3478/tcp+udp` y `49160–49300/udp` abiertos, y define en tu PaaS:
   - `TURN_URLS=turn:turn.tudominio.com:3478?transport=udp,turn:turn.tudominio.com:3478?transport=tcp`
   - `TURN_SECRET=<mismo-secreto-que-coturn>`
2. **Opción B — Servicio TURN gestionado (ej.: Cloudflare Realtime TURN):**
   Define credenciales estáticas en las variables de la PaaS (dejando `TURN_SECRET` vacío):
   - `TURN_URLS=turn:turn.cloudflare.com:3478?transport=udp,turns:turn.cloudflare.com:5349?transport=tcp`
   - `TURN_USERNAME=<tu-usuario-turn>`
   - `TURN_CREDENTIAL=<tu-credencial-turn>`

> [!NOTE]
> Un servidor TURN externo observa las direcciones IP y el volumen de tráfico de la **Videollamada**, aunque el audio y el vídeo siguen cifrados de extremo a extremo mediante DTLS/SRTP. Los **Mensajes Efímeros** solo pasan por tu **Instancia** con cifrado E2EE en el navegador.
