# PULSO — Official Guides (English)

[Português (BR)](../pt-br/README.md) · [English](./README.md) · [Español](../es/README.md) · [简体中文](../zh-CN/README.md)

**PULSO** provides 1:1 browser-based end-to-end encrypted communication with zero sign-up and zero permanent storage: at most two **Participants** (**Host** and **Guest**) per **Room**, joined via a **Room Code** and governed by the **Inactivity Timer**.

## Choose your distribution

| Distribution | Intended for | How it works | Primary guide |
| :--- | :--- | :--- | :--- |
| **PULSO Tor** | **Host** under censorship or surveillance | Zero-trace desktop app with embedded `.onion` service (**Tor Mode**, text-only **Ephemeral Messages**) | [Host Quick-Start Guide](./host-quickstart.md) |
| **PULSO Local / Tunnel** | **Host** behind CGNAT or home router | **Normal Mode** desktop app with opt-in reverse tunnel (`https://`) and optional **Video Call** | [Host Quick-Start Guide](./host-quickstart.md) |
| **PULSO Server** | **Operator** on VPS or PaaS | Self-hosted **Instance** with Docker, zero-log Caddy TLS, `coturn`, and 1-click templates | [Operator Server Guide](./operator-server.md) |

## Guides in this language

1. **[Host Quick-Start Guide (`PULSO Tor` and `PULSO Local / Tunnel`)](./host-quickstart.md)** — Downloading, 3-step v1 opening without paid certificates (macOS Sequoia, Windows SmartScreen, and Linux without terminal), tray lifecycle, **"Stop and purge trace"**, and zero phone-home policy.
2. **[Cryptographic Verification, Offline USB, Bridges & `.onion` Mirrors](./verification-offline-bridges.md)** — Verifying `SHA256SUMS` and `SHA256SUMS.asc` via PGP, 100% offline USB/pendrive operation, obtaining private bridges, and hosting community `.onion` mirrors.
3. **[Operator Guide (`PULSO Server`)](./operator-server.md)** — Minimal profile vs. `--profile full` (Caddy + `coturn`), firewall ports, environment variables (`DETECT_EXTERNAL_IP`, `TRUST_PROXY`), 1-click templates (**Coolify**, **Portainer.io**, **Render**, **Fly.io**), and external TURN configuration.
4. **[Tor Mode Architecture (`docs/tor-mode.md`)](../../tor-mode.md)** — Technical internals (`TorController`, `os.tmpdir()`, and `lyrebird`).
