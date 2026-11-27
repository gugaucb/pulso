# Operator Guide — PULSO Server

[Português (BR)](../pt-br/operator-server.md) · [English](./operator-server.md) · [Español](../es/operator-server.md) · [简体中文](../zh-CN/operator-server.md)

This guide helps an **Operator** deploy and maintain a self-hosted **PULSO Server** **Instance** (**Normal Mode**) on a VPS or via 1-click PaaS templates.

The official `ghcr.io/gugaucb/pulso` container image (multi-arch `linux/amd64` and `linux/arm64`) runs on `gcr.io/distroless/nodejs22-debian12:nonroot` (UID `65532`), with `read_only: true`, `cap_drop: [ALL]`, and native health checks on `GET /healthz`.

---

## 1. Minimal profile vs. Full profile (`--profile full`)

[`deploy/docker-compose.yml`](../../../deploy/docker-compose.yml) supports two deployment profiles:

| Feature | Minimal profile (default) | Full profile (`--profile full`) |
| :--- | :--- | :--- |
| **Command** | `docker compose up -d` | `docker compose --profile full up -d` |
| **Services** | `pulso` only on `127.0.0.1:3001` | `pulso` + **Caddy** (zero-log automatic TLS) + **`coturn`** (`use-auth-secret`) |
| **Best for** | Placing behind an existing Nginx/Caddy/Traefik reverse proxy | Complete single-VPS setup with HTTPS, `wss://`, and NAT-traversal **Video Calls** |
| **`TRUST_PROXY`** | `true` behind a reverse proxy; `false` if direct | `true` required (Caddy forwards client IP headers so RAM rate limits isolate each **Participant**) |

---

## 2. Deploying `--profile full` on a VPS (Caddy + `coturn`)

### Step 1 — Open firewall ports

Allow these exact ports on your VPS firewall before starting:

- **`80/tcp`**: Let's Encrypt HTTP challenge and HTTPS redirect (Caddy).
- **`443/tcp` and `443/udp`**: HTTPS, `wss://`, and HTTP/3 (Caddy).
- **`3478/tcp` and `3478/udp`**: `coturn` STUN/TURN signaling.
- **`49160–49300/udp`**: compact `coturn` media relay range for **Video Calls**.

### Step 2 — Configure `.env`

Copy [`deploy/.env.example`](../../../deploy/.env.example) to `deploy/.env` and customize the required values:

```bash
cd deploy
cp .env.example .env
# Generate a strong shared secret for TURN_SECRET:
openssl rand -hex 32
```

Key environment variables in `deploy/.env`:

- `PULSO_DOMAIN`: FQDN pointing to your VPS IP (used by Caddy for Let's Encrypt TLS and as the `coturn` realm).
- `TRUST_PROXY=true`: ensures `SecurityManager` isolates RAM rate-limiting per **Participant** behind Caddy without persisting plaintext IPs.
- `TURN_SECRET`: shared HMAC secret between the server (`server/iceConfig.ts`) and `coturn` (`--use-auth-secret --static-auth-secret`).
- `TURN_URLS`: e.g. `turn:pulso.example.com:3478?transport=udp,turn:pulso.example.com:3478?transport=tcp`.
- `DETECT_EXTERNAL_IP=yes` and `DETECT_RELAY_IP=yes`: essential on VPS instances behind 1:1 NAT (AWS EC2, Oracle Cloud, Hetzner NAT, etc.) so `coturn` advertises the public IP.
- `STUN_URLS`: comma-separated STUN servers (or `""` to disable STUN).
- `PULSO_INACTIVITY_MS` (`3600000` = 1h), `PULSO_GRACE_WINDOW_MS` (`30000` = 30s), and `PULSO_MAX_ROOMS` (`1000`): **Inactivity Timer**, transient reconnect grace window, and max in-RAM **Rooms**.

### Step 3 — Start and verify

```bash
docker compose --profile full up -d
```

- [`deploy/Caddyfile`](../../../deploy/Caddyfile) discards access logs (`output discard`), sets privacy headers (`Referrer-Policy: no-referrer`, HSTS, `-Server`), and proxies HTTP + `wss://` to `pulso:3001`.
- `coturn` runs with `network_mode: host` (avoiding `docker-proxy` overhead across UDP `49160–49300`), blocks loopback/private/CGNAT/IMDS ranges via `--denied-peer-ip` (anti-SSRF), and disables disk logs.

---

## 3. Official 1-click templates

| Platform | Repository file | Networking & TURN | Important note |
| :--- | :--- | :--- | :--- |
| **Coolify** | [`deploy/coolify/docker-compose.yml`](../../../deploy/coolify/docker-compose.yml) | Includes bundled `coturn` (`network_mode: host`) | Open `3478/tcp+udp` and `49160–49300/udp` on the VPS firewall; Coolify's proxy handles HTTPS/`wss://`. |
| **Portainer.io** | [`deploy/portainer/templates.json`](../../../deploy/portainer/templates.json) and [`deploy/portainer/docker-compose.yml`](../../../deploy/portainer/docker-compose.yml) | Full stack (`pulso` + Caddy + `coturn`) | Add `deploy/portainer/templates.json` as an App Template or deploy a Git Stack pointing to `deploy/portainer/docker-compose.yml`. |
| **Render** | [`render.yaml`](../../../render.yaml) | HTTP/HTTPS/WebSocket PaaS only (no UDP) | Use `starter` plan or higher: the `free` plan spins down after ~15 min and wipes in-RAM **Rooms**. |
| **Fly.io** | [`fly.toml`](../../../fly.toml) | HTTP/HTTPS/WebSocket PaaS only (no UDP) | Sets `auto_stop_machines = false` and `min_machines_running = 1` so active in-RAM **Rooms** are never killed. |

---

## 4. Configuring external TURN on HTTP-only PaaS (Render & Fly.io)

Because **Render** and **Fly.io** only route HTTP/HTTPS/WebSocket (TCP) traffic at their standard edge, `coturn` cannot run inside the same **Instance**. Without external TURN, text **Ephemeral Messages** and P2P **Video Calls** (over STUN) work on open networks, but if both **Participants** are behind symmetric NAT or strict firewalls, the UI displays a clear notice that **Video Call** media was blocked while text messaging keeps working.

To support **Video Calls** across all networks on Render or Fly.io, configure either external TURN option:

1. **Option A — Self-hosted `coturn` on a dedicated VPS:**
   Run only the `coturn` service from `deploy/docker-compose.yml` on a VPS with `3478/tcp+udp` and `49160–49300/udp` open, and configure on your PaaS:
   - `TURN_URLS=turn:turn.yourdomain.com:3478?transport=udp,turn:turn.yourdomain.com:3478?transport=tcp`
   - `TURN_SECRET=<matching-coturn-secret>`
2. **Option B — Managed TURN service (e.g., Cloudflare Realtime TURN):**
   Set static credentials in your PaaS environment (leaving `TURN_SECRET` unset):
   - `TURN_URLS=turn:turn.cloudflare.com:3478?transport=udp,turns:turn.cloudflare.com:5349?transport=tcp`
   - `TURN_USERNAME=<your-turn-username>`
   - `TURN_CREDENTIAL=<your-turn-credential>`

> [!NOTE]
> An external TURN relay observes **Video Call** IP addresses and traffic volume, while audio and video media remain end-to-end encrypted via DTLS/SRTP. **Ephemeral Messages** continue flowing only through your **Instance** with browser-side E2EE.
