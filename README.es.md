<div align="center">

<img src="./docs/design/pulso-logo.jpg" alt="PULSO" width="120" />

# PULSO

**Comunicación efímera 1:1 cifrada de extremo a extremo — sin registro, sin base de datos y sin rastro.**

[![Licencia: MIT](https://img.shields.io/badge/Licencia-MIT-5B3DF5.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![E2EE](https://img.shields.io/badge/E2EE-ECDH%20P--256%20%2B%20AES--256--GCM-0EA5E9)](#seguridad-privacidad-y-modelo-de-amenazas)
[![Tor](https://img.shields.io/badge/Tor-Onion%20v3%20%2B%20lyrebird-7D4698?logo=torproject&logoColor=white)](./docs/tor-mode.md)
[![Idiomas](https://img.shields.io/badge/Idiomas-EN%20%7C%20PT--BR%20%7C%20ES%20%7C%20%E4%B8%AD%E6%96%87-1E293B)](#idiomas)

<p id="idiomas">
  <a href="./README.md">English</a> ·
  <a href="./README.pt-BR.md">Português (BR)</a> ·
  <strong>Español</strong> ·
  <a href="./README.zh-CN.md">简体中文</a>
</p>

</div>

---

**PULSO** es una aplicación de código abierto para comunicación efímera 1:1 diseñada para conversaciones sensibles. Dos participantes (**Anfitrión** e **Invitado**) se reúnen en una **Sala** aislada en RAM identificada por un **Código de Sala** (`XXXX-XXXX`), con cifrado de extremo a extremo nativo del navegador, **Videollamada** opcional en **Modo Normal** o **Modo Tor** solo de texto publicado directamente como servicio Onion v3 (`.onion`).

---

## Características Principales

- **Sin cuentas y sin persistencia:** sin registro, sin base de datos y sin historial en disco. Cada **Sala** vive únicamente en RAM y se autodestruye al agotarse el **Contador de Inactividad** o al salir el **Anfitrión**.
- **E2EE en el navegador + verificación SAS:** intercambio de claves mediante `ECDH P-256` y `AES-256-GCM` (Web Crypto API), reforzado con un secreto opcional en el fragmento `#k=` de la URL (nunca enviado al servidor) y modal de verificación SAS.
- **Dos modos de operación:**
  - **Modo Normal:** **Mensajes Efímeros** cifrados más **Videollamada** P2P opcional mediante WebRTC (audio, cámara, compartir pantalla y diseños flexibles) con STUN/TURN configurable.
  - **Modo Tor:** publica la **Sala** directamente como un Onion Service v3 en RAM (`ADD_ONION NEW:ED25519-V3 Flags=DiscardPK`) usando un daemon C-Tor integrado y `lyrebird` (`Snowflake`, `obfs4`, `webtunnel`, `meek_lite`). La **Videollamada** se bloquea estrictamente para evitar fugas de IP por WebRTC.
- **Protección antivigilancia:** cortina de desenfoque al perder foco, bloqueo de impresión, marca de agua opcional, hashing HMAC-SHA256 rotativo en RAM (cero logs de IP en texto claro) y política cero *phone-home*.
- **Multilingüe y con temas:** interfaz en `Español`, `English`, `Português (Brasil)` y `简体中文`, con tema claro y oscuro.

---

## Distribuciones Oficiales

Elige la distribución acorde a tu red y modelo de amenazas:

| Distribución | Dirigida a | Cómo funciona | Guía |
| :--- | :--- | :--- | :--- |
| **PULSO Tor** | **Anfitrión** bajo censura o vigilancia | App de escritorio **Tauri v2** + sidecar Node.js SEA con `tor` y `lyrebird` integrados (bridges y purga en `os.tmpdir()`), abriendo la **Sala** en tu navegador predeterminado | [Guía rápida del Anfitrión](./docs/guides/es/host-quickstart.md) · [Verificación y Bridges](./docs/guides/es/verification-offline-bridges.md) |
| **PULSO Local / Túnel** | **Anfitrión** detrás de CGNAT o firewall doméstico | Misma base de escritorio **Tauri v2** en **Modo Normal** con túnel inverso opt-in vía `cloudflared` (`https://` + `wss://`), aviso transparente y **Videollamada** *best-effort* | [Guía rápida del Anfitrión](./docs/guides/es/host-quickstart.md) |
| **PULSO Servidor** | **Operador** en VPS o PaaS | Imagen `distroless` endurecida multiarquitectura (`linux/amd64`, `linux/arm64`), `docker-compose.yml` (mínimo o Caddy TLS sin registros + `coturn`) y plantillas en 1 clic | [Guía del Operador](./docs/guides/es/operator-server.md) |

> Índice completo de documentación en los 4 idiomas: [docs/guides/README.md](./docs/guides/README.md).

---

## Cómo Empezar y Usar la Aplicación

### 1. Anfitrión en Escritorio (Sin Terminal)

1. Descarga **PULSO Tor** o **PULSO Local / Túnel** para macOS (`.dmg`), Windows (`.exe` / `.zip` portátil) o Linux (`.AppImage` / `.deb`) desde [GitHub Releases](https://github.com/gugaucb/pulso/releases).
2. Verifica `SHA256SUMS` y `SHA256SUMS.asc` (o sigue los 3 pasos de apertura de la v1 para Gatekeeper / SmartScreen) en la [Guía rápida del Anfitrión](./docs/guides/es/host-quickstart.md) y en [Verificación criptográfica, USB offline y bridges](./docs/guides/es/verification-offline-bridges.md).
3. Inicia la aplicación:
   - **PULSO Tor:** elige *Conexión directa*, *Snowflake integrado* o pega bridges privadas (guardadas solo en RAM/`os.tmpdir()`), espera la dirección `.onion` y abre la **Sala** en el navegador.
   - **PULSO Local / Túnel:** haz clic en **Iniciar Instancia con Túnel** (opt-in) para obtener la URL pública `https://*.trycloudflare.com` y abrir la **Sala** en el navegador.
4. Al terminar, pulsa **Cerrar y purgar rastro** en la ventana o en la bandeja del sistema para detener todos los procesos hijos y borrar los archivos temporales.

### 2. Operador — Autoalojamiento (Docker y Plantillas 1-Clic)

Copia la plantilla de entorno e inicia el perfil mínimo (detrás de un proxy inverso existente) o el perfil completo (**Caddy** con TLS automático sin registros + servidor TURN **`coturn`** endurecido):

```bash
cp deploy/.env.example deploy/.env
# Edita deploy/.env (define PULSO_DOMAIN y genera TURN_SECRET con `openssl rand -hex 32`)

# Perfil mínimo (escucha solo en 127.0.0.1:3001)
docker compose -f deploy/docker-compose.yml up -d

# Perfil completo (PULSO + Caddy TLS + coturn TURN)
docker compose -f deploy/docker-compose.yml --profile full up -d
```

También incluye plantillas oficiales en 1 clic para:
- **Coolify:** [deploy/coolify/docker-compose.yml](./deploy/coolify/docker-compose.yml)
- **Portainer.io:** [deploy/portainer/templates.json](./deploy/portainer/templates.json)
- **Render:** [render.yaml](./render.yaml)
- **Fly.io:** [fly.toml](./fly.toml)

Consulta la [Guía del Operador](./docs/guides/es/operator-server.md) para puertos de firewall (`80/tcp`, `443/tcp+udp`, `3478/tcp+udp`, `49160-49300/udp`), `TRUST_PROXY` y TURN externo en PaaS HTTP.

### 3. Desarrollo Local desde el Código Fuente

**Requisitos previos:**
- **Node.js `22+`** y **npm**
- *(Opcional, solo para compilar la app nativa Tauri)* **Rust** (`1.83+`) y dependencias del sistema de Tauri

**Instalar y ejecutar en Modo Normal (desarrollo):**

```bash
git clone https://github.com/gugaucb/pulso.git
cd pulso
npm install
npm run dev
```

`npm run dev` inicia el servidor Fastify + WebSocket en `http://127.0.0.1:3001` y Vite en `http://localhost:5173` (con proxy para `/ws`, `/api` y `/healthz`).

**Ejecutar Modo Tor localmente desde el código fuente:**

```bash
npm run build
node scripts/fetch-tor-bundle.mjs
npm run start:tor
```

> ¿Ya tienes `tor` instalado en el sistema? Indica su ruta con `PULSO_TOR_BIN=/ruta/a/tor npm run start:tor`. Consulta [docs/tor-mode.md](./docs/tor-mode.md).

**Comandos principales de compilación y pruebas:**

| Comando | Descripción |
| :--- | :--- |
| `npm run build` | Verifica tipos TypeScript, compila la SPA (`dist/`) y el servidor (`dist/server/`) |
| `npm run build:desktop-ui` | Compila la interfaz del panel de escritorio (`dist-desktop/`) |
| `npm run build:sidecar` | Genera el binario sidecar Node.js SEA (`scripts/build-sidecar.mjs`) |
| `npm start` | Inicia el servidor de producción en **Modo Normal** (`node dist/server/index.js`) |
| `npm test` | Ejecuta las pruebas unitarias y de integración con Vitest |
| `npm run test:e2e` | Ejecuta las pruebas E2E en navegador con Playwright |

### 4. Cómo Usar una Sala

1. **Crear una Sala:** abre la interfaz web (o deja que la app de escritorio abra `127.0.0.1`), escribe un nombre temporal opcional, elige **Modo Normal** o **Modo Tor** (bloqueado automáticamente en **PULSO Tor**) y haz clic en **Crear Sala**.
2. **Invitar al Invitado:** comparte el **Código de Sala** (`XXXX-XXXX`), el enlace completo (`/?room=XXXX-XXXX#k=...` — el secreto `#k=` permanece solo en el cliente) o la dirección `.onion` (en **Modo Tor**, abierta en Tor Browser).
3. **Verificar el cifrado:** abre el diálogo SAS y compara el código corto con el otro participante por un canal externo confiable.
4. **Conversar y purgar:** intercambia **Mensajes Efímeros** cifrados (e inicia una **Videollamada** en **Modo Normal** tras previsualizar cámara/micrófono). La actividad reinicia el **Contador de Inactividad**; al salir, usar **Cerrar y purgar rastro** o agotarse el contador, la **Sala** se elimina de la RAM y se purgan los archivos temporales.

---

## Seguridad, Privacidad y Modelo de Amenazas

- **Cifrado de extremo a extremo:** los mensajes se cifran en el navegador (`Web Crypto API`); el servidor solo reenvía cargas cifradas y aplica el límite estricto 1:1.
- **Sin logs de IP ni almacenamiento en disco:** el registro HTTP de `Fastify` está desactivado, `SecurityManager` aplica HMAC-SHA256 en RAM con clave rotativa cada hora y **Modo Tor** guarda `torrc`/cookie únicamente en `os.tmpdir()` (`pulso-tor-*`) con permisos `0700`, eliminados al cerrar e iniciar.
- **Transparencia del túnel:** en **PULSO Local / Túnel**, ambos participantes ven un aviso claro indicando que Cloudflare observa metadatos/IP del túnel inverso mientras el contenido sigue cifrado de extremo a extremo.
- **Cero *phone-home*:** ninguna distribución de escritorio consulta servidores de actualización en segundo plano (**PULSO Tor** no hace peticiones a la clearnet; **PULSO Local / Túnel** solo verifica bajo clic manual).

---

## Arquitectura y Stack Tecnológico

```text
.
├── src/                  # SPA React 19, E2EE Web Crypto, MediaPort WebRTC, panel de escritorio
├── server/               # Fastify 5 + @fastify/websocket, RoomStore, TorController, CloudflaredAdapter, sidecar
├── shared/               # Contratos de protocolo compartidos, sanitización y Código de Sala
├── src-tauri/            # Carcasa Tauri v2 (bandeja, grupos de procesos, perfiles tor/local)
├── deploy/               # Docker Compose (mínimo + Caddy/coturn completo), Caddyfile, Coolify y Portainer
├── scripts/              # fetch-tor-bundle, fetch-cloudflared, build-sidecar (Node SEA), releases y espejos
├── docs/                 # Arquitectura Modo Tor (tor-mode.md) y guías multilingües (pt-br, en, es, zh-CN)
├── Dockerfile            # Imagen multi-stage distroless nonroot (UID 65532)
├── render.yaml           # Blueprint 1-clic para Render
└── fly.toml              # Configuración 1-clic para Fly.io
```

**Stack:** TypeScript · React 19 · Vite 6 · Tailwind CSS 4 · Fastify 5 · `@fastify/websocket` · Web Crypto API · WebRTC · C-Tor + `lyrebird` · `cloudflared` · Tauri v2 · Node.js 22 LTS SEA · Docker Distroless · Caddy · `coturn` · Vitest · Playwright.

---

## Referencia de Configuración

Todas las variables son opcionales en desarrollo local (consulta [deploy/.env.example](./deploy/.env.example)):

| Variable | Valor por defecto | Propósito |
| :--- | :--- | :--- |
| `PORT` / `HOST` | `3001` / `0.0.0.0` | Puerto e interfaz de escucha (`127.0.0.1` en escritorio/**Modo Tor**) |
| `TRUST_PROXY` | `false` | Actívalo (`true`, `1` o saltos) detrás de Caddy/proxy inverso para aislar límites por participante |
| `STUN_URLS` | Google STUN | URLs STUN separadas por comas (`""` desactiva STUN) |
| `TURN_URLS` | *(vacío)* | URLs TURN/TURNS para **Videollamada** detrás de NAT simétrico |
| `TURN_SECRET` / `TURN_TTL_SECONDS` | *(vacío)* / `3600` | Secreto HMAC-SHA1 compartido con `coturn` (`use-auth-secret`) |
| `PULSO_INACTIVITY_MS` | `3600000` (1h) | Duración del **Contador de Inactividad** antes de purgar la **Sala** |
| `PULSO_GRACE_WINDOW_MS` | `30000` (30s) | Ventana de reconexión ante desconexiones transitorias |
| `PULSO_MAX_ROOMS` | `1000` | Máximo de **Salas** simultáneas en RAM |
| `PULSO_TOR_BIN` | *(automático)* | Ruta explícita al ejecutable `tor` |
| `PULSO_CLOUDFLARED_BIN` | *(automático)* | Ruta explícita al ejecutable `cloudflared` |

---

## Cómo Contribuir

¡Las contribuciones son bienvenidas!

1. Haz un fork de [gugaucb/pulso](https://github.com/gugaucb/pulso) y crea una rama para tu cambio.
2. Respeta la terminología de [GLOSSARY.md](./GLOSSARY.md) en textos de interfaz y documentación.
3. Añade o actualiza pruebas y verifica antes de abrir un pull request:
   ```bash
   npm run build && npm test
   ```

## Seguridad

Por favor, **no** reportes vulnerabilidades de seguridad en issues públicas. Repórtalas de forma privada en [GitHub Security Advisories](https://github.com/gugaucb/pulso/security/advisories).

## Licencia

Distribuido bajo la [Licencia MIT](./LICENSE).
