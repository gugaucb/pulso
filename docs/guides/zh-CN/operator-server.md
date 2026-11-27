# 运维者指南 — PULSO 服务器

[Português (BR)](../pt-br/operator-server.md) · [English](../en/operator-server.md) · [Español](../es/operator-server.md) · [简体中文](./operator-server.md)

本指南面向**运维者**，说明如何在自有 VPS 或一键部署 PaaS 平台上发布和维护 **PULSO 服务器** **实例**（**标准模式**）。

官方容器镜像 `ghcr.io/gugaucb/pulso`（支持 `linux/amd64` 与 `linux/arm64` 多架构）基于 `gcr.io/distroless/nodejs22-debian12:nonroot`（UID `65532`），默认启用只读根文件系统（`read_only: true`）、移除全部权限位（`cap_drop: [ALL]`），并通过 `GET /healthz` 进行健康检查。

---

## 1. 最小配置 vs. 完整配置（`--profile full`）

[`deploy/docker-compose.yml`](../../../deploy/docker-compose.yml) 提供两种运行模式：

| 特性 | 最小配置（默认） | 完整配置（`--profile full`） |
| :--- | :--- | :--- |
| **启动命令** | `docker compose up -d` | `docker compose --profile full up -d` |
| **包含服务** | 仅 `pulso`，监听 `127.0.0.1:3001` | `pulso` + **Caddy**（零日志自动 TLS）+ **`coturn`**（`use-auth-secret`） |
| **适用场景** | 已有 Nginx / Caddy / Traefik 反向代理 | 从零在 VPS 上搭建完整 HTTPS、`wss://` 及支持 NAT 穿透的**视频通话** |
| **`TRUST_PROXY`** | 前置反代时设 `true`，直连时设 `false` | 必须为 `true`（Caddy 透传客户端 IP，以便按**参与者**隔离内存限流） |

---

## 2. 在 VPS 上使用 `--profile full` 部署（Caddy + `coturn`）

### 第 1 步 — 放行防火墙端口

启动前请在 VPS 防火墙放行以下端口：

- **`80/tcp`**：Let's Encrypt HTTP 验证及跳转 HTTPS（Caddy）。
- **`443/tcp` 与 `443/udp`**：HTTPS、`wss://` 与 HTTP/3（Caddy）。
- **`3478/tcp` 与 `3478/udp`**：`coturn` STUN/TURN 信令端口。
- **`49160–49300/udp`**：`coturn` 用于**视频通话**的精简媒体中继 UDP 端口段。

### 第 2 步 — 配置 `.env` 文件

复制 [`deploy/.env.example`](../../../deploy/.env.example) 为 `deploy/.env` 并修改关键变量：

```bash
cd deploy
cp .env.example .env
# 为 TURN_SECRET 生成高强度随机密钥：
openssl rand -hex 32
```

`deploy/.env` 中的核心环境变量：

- `PULSO_DOMAIN`：指向 VPS 公网 IP 的 FQDN 域名（用于 Caddy 自动申请证书及 `coturn` realm）。
- `TRUST_PROXY=true`：确保 `SecurityManager` 在 Caddy 后按**参与者**隔离内存速率限制，且不向磁盘记录明文 IP。
- `TURN_SECRET`：后端（`server/iceConfig.ts`）与 `coturn`（`--use-auth-secret --static-auth-secret`）共享的 HMAC 密钥。
- `TURN_URLS`：例如 `turn:pulso.example.com:3478?transport=udp,turn:pulso.example.com:3478?transport=tcp`。
- `DETECT_EXTERNAL_IP=yes` 与 `DETECT_RELAY_IP=yes`：当 VPS 处于 1:1 NAT 后面（如 AWS EC2、Oracle Cloud 等）时必须开启，使 `coturn` 正确通告公网 IP。
- `STUN_URLS`：逗号分隔的 STUN 服务器列表（设为空 `""` 可禁用 STUN）。
- `PULSO_INACTIVITY_MS`（`3600000` = 1 小时）、`PULSO_GRACE_WINDOW_MS`（`30000` = 30 秒）与 `PULSO_MAX_ROOMS`（`1000`）：控制**静默倒计时**、断线宽限窗口以及内存中最大**房间**数。

### 第 3 步 — 启动并验证

```bash
docker compose --profile full up -d
```

- [`deploy/Caddyfile`](../../../deploy/Caddyfile) 会丢弃访问日志（`output discard`）、注入隐私响应头（`Referrer-Policy: no-referrer`、HSTS、`-Server`），并将 HTTP 与 `wss://` 代理到 `pulso:3001`。
- `coturn` 以 `network_mode: host` 运行（避免 `docker-proxy` 处理 `49160–49300/udp` 时的性能损耗），通过 `--denied-peer-ip` 封禁回环、内网、CGNAT 与云厂商 IMDS 地址（防 SSRF），并禁用磁盘日志。

---

## 3. 官方一键部署模板

| 平台 | 仓库配置文件 | 网络与 TURN 支持 | 重要说明 |
| :--- | :--- | :--- | :--- |
| **Coolify** | [`deploy/coolify/docker-compose.yml`](../../../deploy/coolify/docker-compose.yml) | 内置 `coturn`（`network_mode: host`） | 请在 VPS 防火墙开放 `3478/tcp+udp` 与 `49160–49300/udp`；HTTPS/`wss://` 由 Coolify 反代负责。 |
| **Portainer.io** | [`deploy/portainer/templates.json`](../../../deploy/portainer/templates.json) 与 [`deploy/portainer/docker-compose.yml`](../../../deploy/portainer/docker-compose.yml) | 完整堆栈（`pulso` + Caddy + `coturn`） | 将 `deploy/portainer/templates.json` 添加为 App Template，或使用 Git Stack 指向 `deploy/portainer/docker-compose.yml`。 |
| **Render** | [`render.yaml`](../../../render.yaml) | 仅支持 HTTP/HTTPS/WebSocket（无 UDP） | 请使用 `starter` 或更高套餐：`free` 套餐约 15 分钟无流量会休眠并清空内存中的**房间**。 |
| **Fly.io** | [`fly.toml`](../../../fly.toml) | 仅支持 HTTP/HTTPS/WebSocket（无 UDP） | 已配置 `auto_stop_machines = false` 与 `min_machines_running = 1`，避免挂起销毁内存中的活跃**房间**。 |

---

## 4. 在纯 HTTP PaaS（Render 与 Fly.io）配置外部 TURN

由于 **Render** 和 **Fly.io** 边缘代理仅转发 HTTP/HTTPS/WebSocket（TCP）流量，无法在同一**实例**内运行 `coturn`。未配置外部 TURN 时，文本**阅后即焚消息**与 P2P **视频通话**（通过 STUN）在常规网络下可直接工作；但若双方**参与者**均位于对称 NAT 或严格防火墙之后，界面会友好提示**视频通话**受阻，而文本通信不受影响。

要在 Render 或 Fly.io 上支持全网络穿透的**视频通话**，可任选以下一种外部 TURN 方案：

1. **方案 A — 在独立 VPS 上自托管 `coturn`：**
   在开放了 `3478/tcp+udp` 和 `49160–49300/udp` 的 VPS 上仅启动 `deploy/docker-compose.yml` 中的 `coturn` 服务，并在 PaaS 环境变量中设置：
   - `TURN_URLS=turn:turn.yourdomain.com:3478?transport=udp,turn:turn.yourdomain.com:3478?transport=tcp`
   - `TURN_SECRET=<与 coturn 一致的密钥>`
2. **方案 B — 托管 TURN 服务（例如 Cloudflare Realtime TURN）：**
   在 PaaS 中配置静态凭据（保持 `TURN_SECRET` 为空）：
   - `TURN_URLS=turn:turn.cloudflare.com:3478?transport=udp,turns:turn.cloudflare.com:5349?transport=tcp`
   - `TURN_USERNAME=<您的 TURN 用户名>`
   - `TURN_CREDENTIAL=<您的 TURN 凭据>`

> [!NOTE]
> 外部 TURN 中继服务器可以看到**视频通话**的通信双方 IP 与媒体流量大小，但音视频流本身仍通过 DTLS/SRTP 端到端加密。**阅后即焚消息**始终仅经由您的**实例**传输，并在浏览器内保持端到端加密。
