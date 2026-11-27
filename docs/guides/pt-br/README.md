# PULSO — Documentação Oficial (Português - Brasil)

[Português (BR)](./README.md) · [English](../en/README.md) · [Español](../es/README.md) · [简体中文](../zh-CN/README.md)

O **PULSO** oferece comunicação 1:1 com criptografia de ponta a ponta no navegador, sem cadastro e sem armazenamento permanente: apenas duas pessoas (**Anfitrião** e **Convidado**) por **Sala**, identificadas por um **Código da Sala** e protegidas pelo **Contador de Inatividade**.

## Escolha sua distribuição

| Distribuição | Para quem é | Como funciona | Guia principal |
| :--- | :--- | :--- | :--- |
| **PULSO Tor** | **Anfitrião** sob censura ou vigilância | Aplicativo desktop zero-rastro com serviço `.onion` embutido (**Modo Tor**, apenas **Mensagem Efêmera** em texto) | [Guia rápido do Anfitrião](./host-quickstart.md) |
| **PULSO Local / Túnel** | **Anfitrião** atrás de CGNAT ou roteador doméstico | Aplicativo desktop no **Modo Normal** com túnel reverso opt-in (`https://`) e **Chamada de Vídeo** opcional | [Guia rápido do Anfitrião](./host-quickstart.md) |
| **PULSO Servidor** | **Operador** em VPS ou PaaS | **Instância** auto-hospedada com Docker, Caddy TLS zero-registro, `coturn` e modelos em 1 clique | [Guia do Operador](./operator-server.md) |

## Guias disponíveis neste idioma

1. **[Guia rápido do Anfitrião (`PULSO Tor` e `PULSO Local / Túnel`)](./host-quickstart.md)** — Como baixar, abrir na v1 em 3 passos (macOS Sequoia, Windows SmartScreen e Linux sem terminal), usar a bandeja do sistema, clicar em **"Encerrar e purgar rastro"** e entender a política zero *phone-home*.
2. **[Verificação criptográfica, pendrive offline, bridges e espelhos `.onion`](./verification-offline-bridges.md)** — Conferência de `SHA256SUMS` e `SHA256SUMS.asc` via PGP, execução 100% offline em pendrive, obtenção de bridges privadas e hospedagem comunitária de espelhos `.onion`.
3. **[Guia do Operador (`PULSO Servidor`)](./operator-server.md)** — Perfil mínimo versus `--profile full` (Caddy + `coturn`), portas de firewall, variáveis de configuração (`DETECT_EXTERNAL_IP`, `TRUST_PROXY`), modelos em 1 clique (**Coolify**, **Portainer.io**, **Render**, **Fly.io**) e TURN externo.
4. **[Arquitetura técnica do Modo Tor (`docs/tor-mode.md`)](../../tor-mode.md)** — Detalhes do `TorController`, `os.tmpdir()` e `lyrebird`.
