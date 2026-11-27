# PULSO — Guías Oficiales (Español)

[Português (BR)](../pt-br/README.md) · [English](../en/README.md) · [Español](./README.md) · [简体中文](../zh-CN/README.md)

**PULSO** ofrece comunicación 1:1 cifrada de extremo a extremo en el navegador, sin registro y sin almacenamiento permanente: como máximo dos **Participantes** (**Anfitrión** e **Invitado**) por **Sala**, identificados mediante un **Código de la Sala** y regulados por el **Temporizador de Inactividad**.

## Elige tu distribución

| Distribución | Para quién es | Cómo funciona | Guía principal |
| :--- | :--- | :--- | :--- |
| **PULSO Tor** | **Anfitrión** bajo censura o vigilancia | Aplicación de escritorio cero rastro con servicio `.onion` integrado (**Modo Tor**, solo **Mensajes Efímeros** de texto) | [Guía rápida del Anfitrión](./host-quickstart.md) |
| **PULSO Local / Túnel** | **Anfitrión** detrás de CGNAT o router doméstico | Aplicación de escritorio en **Modo Normal** con túnel inverso opt-in (`https://`) y **Videollamada** opcional | [Guía rápida del Anfitrión](./host-quickstart.md) |
| **PULSO Servidor** | **Operador** en VPS o PaaS | **Instancia** autoalojada con Docker, Caddy TLS cero registros, `coturn` y plantillas en 1 clic | [Guía del Operador](./operator-server.md) |

## Guías en este idioma

1. **[Guía rápida del Anfitrión (`PULSO Tor` y `PULSO Local / Túnel`)](./host-quickstart.md)** — Descarga, apertura en 3 pasos en la v1 sin certificados de pago (macOS Sequoia, Windows SmartScreen y Linux sin terminal), bandeja del sistema, **"Cerrar y purgar rastro"** y política cero *phone-home*.
2. **[Verificación criptográfica, uso offline en USB, bridges y espejos `.onion`](./verification-offline-bridges.md)** — Verificación de `SHA256SUMS` y `SHA256SUMS.asc` mediante PGP, ejecución 100% sin conexión desde USB/pendrive, obtención de bridges privadas y alojamiento comunitario de espejos `.onion`.
3. **[Guía del Operador (`PULSO Servidor`)](./operator-server.md)** — Perfil mínimo frente a `--profile full` (Caddy + `coturn`), puertos de firewall, variables de entorno (`DETECT_EXTERNAL_IP`, `TRUST_PROXY`), plantillas en 1 clic (**Coolify**, **Portainer.io**, **Render**, **Fly.io**) y TURN externo.
4. **[Arquitectura técnica del Modo Tor (`docs/tor-mode.md`)](../../tor-mode.md)** — Detalles internos de `TorController`, `os.tmpdir()` y `lyrebird`.
