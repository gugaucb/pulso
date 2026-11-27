<div align="center">

<img src="./docs/design/pulso-logo.jpg" alt="PULSO" width="120" />

# PULSO

**Ephemeral 1:1 end-to-end encrypted communication — no accounts, no database, zero trace.**

[![License: MIT](https://img.shields.io/badge/License-MIT-5B3DF5.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![E2EE](https://img.shields.io/badge/E2EE-ECDH%20P--256%20%2B%20AES--256--GCM-0EA5E9)](#security-privacy--threat-model)
[![Tor](https://img.shields.io/badge/Tor-Onion%20v3%20%2B%20lyrebird-7D4698?logo=torproject&logoColor=white)](./docs/tor-mode.md)
[![Languages](https://img.shields.io/badge/Languages-EN%20%7C%20PT--BR%20%7C%20ES%20%7C%20%E4%B8%AD%E6%96%87-1E293B)](#languages)

<p id="languages">
  <strong>English</strong> ·
  <a href="./README.pt-BR.md">Português (BR)</a> ·
  <a href="./README.es.md">Español</a> ·
  <a href="./README.zh-CN.md">简体中文</a>
</p>

</div>

---

**PULSO** is an open-source ephemeral 1:1 communication application designed for privacy-critical conversations. Two participants (**Host** and **Guest**) meet inside an isolated, RAM-only **Room** identified by a short Room Code (`XXXX-XXXX`), with browser-native end-to-end encryption, optional WebRTC video calling in **Normal Mode**, or text-only **Tor Mode** published directly as an ephemeral v3 `.onion` service.

---

## Features

- **Zero accounts, zero persistence:** No sign-up, no database, and no message history on disk. Rooms live strictly in RAM and self-destruct when the **Inactivity Countdown** expires or the **Host** leaves.
- **Browser-native E2EE + SAS verification:** Keys are negotiated directly between browsers via `ECDH P-256` and `AES-256-GCM` (Web Crypto API), hardened with an optional link secret in the `#k=` URL hash fragment (never sent to the server) and a Short Authentication String (SAS) verification modal.
- **Two operating modes:**
  - **Normal Mode:** Ephemeral encrypted text messaging plus optional peer-to-peer **Video Call** (audio, camera, screen sharing, layouts) over WebRTC with configurable STUN/TURN.
  - **Tor Mode:** Publishes the **Room** directly as an in-RAM v3 Onion Service (`ADD_ONION NEW:ED25519-V3 Flags=DiscardPK`) via a bundled C-Tor daemon and `lyrebird` pluggable transports (`Snowflake`, `obfs4`, `webtunnel`, `meek_lite`). **Video Call** is strictly blocked in Tor Mode to prevent IP/WebRTC leaks.
- **Anti-surveillance UX:** Automatic screen-shield blur curtain, print blocking, optional session watermark, rotating in-RAM HMAC origin hashing (zero raw IP logs), and zero background update checks (*zero phone-home*).
- **Multilingual & themeable UI:** Available in `English`, `Português (Brasil)`, `Español`, and `简体中文`, with Light and Dark themes.

---

## Official Distributions

Choose the distribution that matches your network environment and threat model:

| Distribution | Audience | How it works | Guide |
| :--- | :--- | :--- | :--- |
| **PULSO Tor** | **Host** under censorship or surveillance | Zero-trace **Tauri v2** desktop app + Node.js SEA sidecar with embedded `tor` + `lyrebird` (bridges & `os.tmpdir()` purge), opening the **Room** in your default browser | [Host Quickstart](./docs/guides/en/host-quickstart.md) · [Verification & Bridges](./docs/guides/en/verification-offline-bridges.md) |
| **PULSO Local / Tunnel** | **Host** behind CGNAT or home firewall | Same **Tauri v2** desktop shell running **Normal Mode** with opt-in `cloudflared` reverse tunnel (`https://` + `wss://`), transparency badge, and best-effort **Video Call** | [Host Quickstart](./docs/guides/en/host-quickstart.md) |
| **PULSO Server** | **Operator** on a VPS or PaaS | Hardened multi-arch `distroless` container (`linux/amd64`, `linux/arm64`), `docker-compose.yml` (minimal or Caddy zero-log TLS + `coturn`), and 1-click templates | [Operator Guide](./docs/guides/en/operator-server.md) |

> Full documentation index in all 4 languages: [docs/guides/README.md](./docs/guides/README.md).

---

## Getting Started (How to Start & Use)

### 1. Host Desktop App (No Terminal Required)

1. Download **PULSO Tor** or **PULSO Local / Tunnel** for macOS (`.dmg`), Windows (`.exe` / portable `.zip`), or Linux (`.AppImage` / `.deb`) from [GitHub Releases](https://github.com/gugaucb/pulso/releases).
2. Verify `SHA256SUMS` and `SHA256SUMS.asc` (or follow the 3-step v1 Gatekeeper / SmartScreen instructions for ad-hoc builds) in [Host Quickstart](./docs/guides/en/host-quickstart.md) and [Verification, Offline USB & Bridges](./docs/guides/en/verification-offline-bridges.md).
3. Launch the app:
   - **PULSO Tor:** Select *Direct*, built-in *Snowflake*, or paste private bridges (held only in RAM/`os.tmpdir()`), wait for `.onion` readiness, and click **Open Room in Browser**.
   - **PULSO Local / Tunnel:** Click **Start Instance with Tunnel** (opt-in) to generate a public `https://*.trycloudflare.com` invite link and open the **Room** in your browser.
4. When finished, click **Stop and purge trace** in the control window or system tray to terminate all child processes and wipe temporary files.

### 2. Operator Self-Hosting (Docker & 1-Click PaaS)

Copy the environment template and start either the minimal profile (behind an existing reverse proxy) or the full production stack (**Caddy** automatic TLS with zero access logs + hardened **`coturn`** TURN server):

```bash
cp deploy/.env.example deploy/.env
# Edit deploy/.env (set PULSO_DOMAIN and generate TURN_SECRET with `openssl rand -hex 32`)

# Minimal profile (binds strictly to 127.0.0.1:3001)
docker compose -f deploy/docker-compose.yml up -d

# Full profile (PULSO + Caddy TLS + coturn TURN)
docker compose -f deploy/docker-compose.yml --profile full up -d
```

Official 1-click deployment templates are also included for:
- **Coolify:** [deploy/coolify/docker-compose.yml](./deploy/coolify/docker-compose.yml)
- **Portainer.io:** [deploy/portainer/templates.json](./deploy/portainer/templates.json)
- **Render:** [render.yaml](./render.yaml)
- **Fly.io:** [fly.toml](./fly.toml)

See [Operator Guide](./docs/guides/en/operator-server.md) for firewall ports (`80/tcp`, `443/tcp+udp`, `3478/tcp+udp`, `49160-49300/udp`), `TRUST_PROXY`, and external TURN configuration on HTTP-only PaaS.

### 3. Local Development from Source

**Prerequisites:**
- **Node.js `22+`** and **npm**
- *(Optional, only to compile the native Tauri desktop shell)* **Rust** (`1.83+`) and platform Tauri system dependencies

**Install and run Normal Mode (development):**

```bash
git clone https://github.com/gugaucb/pulso.git
cd pulso
npm install
npm run dev
```

`npm run dev` starts the Fastify + WebSocket backend on `http://127.0.0.1:3001` and the Vite dev server on `http://localhost:5173` (proxying `/ws`, `/api`, and `/healthz`).

**Run Tor Mode locally from source:**

```bash
npm run build
node scripts/fetch-tor-bundle.mjs
npm run start:tor
```

> Already have `tor` installed on your system? Point directly to it: `PULSO_TOR_BIN=/path/to/tor npm run start:tor`. See [docs/tor-mode.md](./docs/tor-mode.md) for details.

**Common build & verification scripts:**

| Command | Description |
| :--- | :--- |
| `npm run build` | Typechecks client & server, builds Vite SPA (`dist/`), and bundles server (`dist/server/`) |
| `npm run build:desktop-ui` | Builds the compact Tauri control panel UI (`dist-desktop/`) |
| `npm run build:sidecar` | Bundles and builds the Node.js SEA sidecar binary (`scripts/build-sidecar.mjs`) |
| `npm start` | Runs the production Normal Mode server (`node dist/server/index.js`) |
| `npm test` | Runs the Vitest unit and integration test suite |
| `npm run test:e2e` | Runs Playwright end-to-end browser tests |

### 4. How to Use a Room

1. **Create a Room:** Open the web interface (or let the desktop app open `127.0.0.1`), enter an optional temporary display name, choose **Normal Mode** or **Tor Mode** (locked automatically when launched via `PULSO Tor`), and click **Create Room**.
2. **Invite the Guest:** Share the **Room Code** (`XXXX-XXXX`), the full invite link (`/?room=XXXX-XXXX#k=...` — keeping the `#k=` secret client-side), or the `.onion` link (in **Tor Mode**, opened by the Guest in Tor Browser).
3. **Verify E2EE:** Open the **Verify encryption** (SAS) modal and compare the short verification code over a trusted out-of-band channel.
4. **Communicate & Purge:** Exchange encrypted **Ephemeral Messages** (and start a **Video Call** in **Normal Mode** after previewing local devices). Activity resets or manually renewing the **Inactivity Countdown** keeps the Room alive; leaving, closing the desktop **Instance** via **Stop and purge trace**, or letting the countdown reach zero purges all Room state from RAM and wipes temporary files.

---

## Security, Privacy & Threat Model

- **End-to-end encrypted payloads:** Messages are encrypted in the browser (`Web Crypto API`); the relay server only forwards opaque ciphertexts and enforces the strict 1:1 (2-participant) limit.
- **No raw IP logs or persistent storage:** `Fastify` request logging is disabled, `SecurityManager` hashes origin IPs with an in-RAM HMAC-SHA256 key rotated hourly, and **Tor Mode** stores ephemeral `torrc`/cookie artifacts exclusively in a `0700` directory under `os.tmpdir()` (`pulso-tor-*`) deleted on exit and startup.
- **Transparent network intermediary notice:** In **PULSO Local / Tunnel**, both **Participants** see an explicit banner stating that Cloudflare observes network metadata/IPs for the reverse tunnel while **Ephemeral Messages** remain end-to-end encrypted.
- **Zero phone-home:** Neither desktop distribution polls update servers in the background (`PULSO Tor` never issues clearnet requests; `PULSO Local / Tunnel` checks releases only on manual click).

---

## Architecture & Tech Stack

```text
.
├── src/                  # React 19 SPA, Web Crypto E2EE, WebRTC MediaPort, Desktop Panel UI
├── server/               # Fastify 5 + @fastify/websocket relay, RoomStore, TorController, CloudflaredAdapter, sidecar
├── shared/               # Shared protocol contracts, runtime sanitization, Room Code helpers
├── src-tauri/            # Tauri v2 desktop shell (tray icon, process-group cleanup, tor/local flavors)
├── deploy/               # Docker Compose (minimal + Caddy/coturn full), Caddyfile, Coolify & Portainer templates
├── scripts/              # fetch-tor-bundle, fetch-cloudflared, build-sidecar (Node SEA), release & mirror scripts
├── docs/                 # Technical architecture (tor-mode.md) and multilingual guides (pt-br, en, es, zh-CN)
├── Dockerfile            # Hardened multi-stage distroless nonroot image (UID 65532)
├── render.yaml           # 1-click Render Blueprint
└── fly.toml              # 1-click Fly.io configuration
```

**Core stack:** TypeScript · React 19 · Vite 6 · Tailwind CSS 4 · Fastify 5 · `@fastify/websocket` · Web Crypto API · WebRTC · C-Tor + `lyrebird` · `cloudflared` · Tauri v2 · Node.js 22 LTS SEA · Docker Distroless · Caddy · `coturn` · Vitest · Playwright.

---

## Configuration Reference

All server variables are optional for local development (see [deploy/.env.example](./deploy/.env.example) for a ready-to-copy template):

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `PORT` / `HOST` | `3001` / `0.0.0.0` | HTTP/WebSocket bind port and interface (`127.0.0.1` in desktop/Tor mode) |
| `TRUST_PROXY` | `false` | Enable (`true`, `1`, or hop count) behind Caddy/reverse proxies for per-participant rate limits |
| `STUN_URLS` | Google STUN | Comma-separated STUN URLs (`""` disables STUN) |
| `TURN_URLS` | *(unset)* | Comma-separated TURN/TURNS URLs for symmetric NAT traversal in **Normal Mode** |
| `TURN_SECRET` / `TURN_TTL_SECONDS` | *(unset)* / `3600` | Shared HMAC-SHA1 secret with `coturn` (`use-auth-secret`) for ephemeral TURN credentials |
| `PULSO_INACTIVITY_MS` | `3600000` (1h) | **Inactivity Countdown** duration before automatic **Room** purge |
| `PULSO_GRACE_WINDOW_MS` | `30000` (30s) | Reconnection grace window on transient disconnects |
| `PULSO_MAX_ROOMS` | `1000` | Maximum concurrent **Rooms** held in RAM |
| `PULSO_TOR_BIN` | *(auto)* | Explicit path to `tor` executable (overrides `.tor-bin/` and `PATH`) |
| `PULSO_CLOUDFLARED_BIN` | *(auto)* | Explicit path to `cloudflared` executable |

---

## Contributing

Contributions are welcome!

1. Fork [gugaucb/pulso](https://github.com/gugaucb/pulso) and create a feature branch.
2. Follow the canonical domain vocabulary in [GLOSSARY.md](./GLOSSARY.md) when updating UI copy or documentation.
3. Add or update tests alongside your changes and verify before opening a pull request:
   ```bash
   npm run build && npm test
   ```

## Security

Please **do not** report security vulnerabilities in public GitHub issues. Report suspected vulnerabilities privately through [GitHub Security Advisories](https://github.com/gugaucb/pulso/security/advisories) so maintainers can investigate and coordinate a fix before disclosure.

## License

Licensed under the [MIT License](./LICENSE).
