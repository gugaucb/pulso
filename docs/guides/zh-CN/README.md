# PULSO — 官方指南（简体中文）

[Português (BR)](../pt-br/README.md) · [English](../en/README.md) · [Español](../es/README.md) · [简体中文](./README.md)

**PULSO** 提供无需注册、无永久存储的浏览器端到端加密 1 对 1 通信：每个**房间**最多容纳两位**参与者**（**房主**与**访客**），通过**房间代码**加入，并受**静默倒计时**保护。

## 选择发行版本

| 发行版本 | 适用对象 | 运行方式 | 主要指南 |
| :--- | :--- | :--- | :--- |
| **PULSO Tor** | 处于审查或监控网络中的**房主** | 零痕迹桌面应用，内置 `.onion` 服务（**Tor 模式**，仅限纯文本**阅后即焚消息**） | [房主快速入门指南](./host-quickstart.md) |
| **PULSO 本地 / 隧道** | 位于 CGNAT 或家用路由器后的**房主** | **标准模式**桌面应用，支持可选反向隧道（`https://`）和可选**视频通话** | [房主快速入门指南](./host-quickstart.md) |
| **PULSO 服务器** | 使用 VPS 或 PaaS 的**运维者** | 自托管**实例**，提供 Docker、零日志 Caddy TLS、`coturn` 与一键部署模板 | [运维者服务器指南](./operator-server.md) |

## 本语言指南目录

1. **[房主快速入门指南（`PULSO Tor` 与 `PULSO 本地 / 隧道`）](./host-quickstart.md)** — 下载方式、v1 无付费签名证书时的 3 步打开方法（macOS Sequoia、Windows SmartScreen、Linux 图形界面免终端操作）、系统托盘生命周期、**“关闭并清除痕迹”**以及零后台回连（zero phone-home）策略。
2. **[密码学校验、U盘离线使用、网桥获取与 `.onion` 镜像指南](./verification-offline-bridges.md)** — 使用 PGP 校验 `SHA256SUMS` 与 `SHA256SUMS.asc`、100% 离线 U盘运行、获取私有网桥，以及社区托管 `.onion` 镜像的方法。
3. **[运维者指南（`PULSO 服务器`）](./operator-server.md)** — 最小配置与 `--profile full`（Caddy + `coturn`）对比、防火墙端口、`DETECT_EXTERNAL_IP` / `TRUST_PROXY` 配置、一键模板（**Coolify**、**Portainer.io**、**Render**、**Fly.io**）以及外部 TURN 配置。
4. **[Tor 模式技术架构（`docs/tor-mode.md`）](../../tor-mode.md)** — `TorController`、`os.tmpdir()` 与 `lyrebird` 实现说明。
