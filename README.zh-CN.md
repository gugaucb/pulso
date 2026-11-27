<div align="center">

<img src="./docs/design/pulso-logo.jpg" alt="PULSO" width="120" />

# PULSO

**端到端加密的阅后即焚 1:1 通信——无需注册、无数据库、零痕迹。**

[![许可证: MIT](https://img.shields.io/badge/License-MIT-5B3DF5.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![E2EE](https://img.shields.io/badge/E2EE-ECDH%20P--256%20%2B%20AES--256--GCM-0EA5E9)](#安全隐私与威胁模型)
[![Tor](https://img.shields.io/badge/Tor-Onion%20v3%20%2B%20lyrebird-7D4698?logo=torproject&logoColor=white)](./docs/tor-mode.md)
[![语言](https://img.shields.io/badge/%E8%AF%AD%E8%A8%80-EN%20%7C%20PT--BR%20%7C%20ES%20%7C%20%E4%B8%AD%E6%96%87-1E293B)](#多语言文档)

<p id="多语言文档">
  <a href="./README.md">English</a> ·
  <a href="./README.pt-BR.md">Português (BR)</a> ·
  <a href="./README.es.md">Español</a> ·
  <strong>简体中文</strong>
</p>

</div>

---

**PULSO** 是一款开源的即时阅后即焚 1:1 通信应用，面向高隐私需求的对话场景。两位**参与者**（**房主**与**访客**）通过简短的**房间码**（`XXXX-XXXX`）在纯内存隔离的**房间**中通信，支持浏览器原生端到端加密、**普通模式**下的可选 WebRTC **视频通话**，或以纯文本 **Tor 模式**直接发布为临时 v3 `.onion` 洋葱服务。

---

## 核心特性

- **零账号、零持久化：** 无需注册，无数据库，不落盘任何消息。房间状态仅保存在内存中，当**非活动倒计时**归零或**房主**离开时自动销毁。
- **浏览器原生 E2EE + SAS 校验：** 基于 Web Crypto API（`ECDH P-256` + `AES-256-GCM`）在浏览器间协商密钥，结合 URL `#k=` 哈希片段密钥（永不发送至服务器）以及短认证码（SAS）核验弹窗。
- **两种运行模式：**
  - **普通模式：** 加密阅后即焚文本消息 + 可选 WebRTC 点对点**视频通话**（音频、摄像头、屏幕共享与多种布局），支持自定义 STUN/TURN。
  - **Tor 模式：** 通过内置 C-Tor 守护进程与 `lyrebird` 可插拔传输（`Snowflake`、`obfs4`、`webtunnel`、`meek_lite`），直接将**房间**发布为纯内存 v3 Onion Service（`ADD_ONION NEW:ED25519-V3 Flags=DiscardPK`），并严格禁用**视频通话**以防 WebRTC 泄露真实 IP。
- **防监控设计：** 失焦自动模糊防窥幕布、打印拦截、可选会话水印、内存内按小时轮换的 HMAC-SHA256 来源哈希（无明文 IP 日志），以及彻底的**零后台回连（zero phone-home）**策略。
- **多语言与主题：** 支持 `简体中文`、`English`、`Português (Brasil)` 与 `Español`，提供浅色与深色主题。

---

## 官方发行版

根据您的网络环境与威胁模型选择合适的发行方式：

| 发行版 | 适用对象 | 工作方式 | 指南 |
| :--- | :--- | :--- | :--- |
| **PULSO Tor** | 处于审查或监控网络中的**房主** | 零痕迹 **Tauri v2** 桌面应用 + Node.js SEA sidecar，内置 `tor` 与 `lyrebird`（支持网桥及 `os.tmpdir()` 自动清除），在默认浏览器打开**房间** | [房主快速入门](./docs/guides/zh-CN/host-quickstart.md) · [校验、离线 U 盘与网桥](./docs/guides/zh-CN/verification-offline-bridges.md) |
| **PULSO 本地 / 隧道** | 位于 CGNAT 或家庭防火墙后的**房主** | 同一 **Tauri v2** 桌面壳运行**普通模式**，支持一键开启 `cloudflared` 反向隧道（`https://` + `wss://`）、透明提示徽标与尽力而为的**视频通话** | [房主快速入门](./docs/guides/zh-CN/host-quickstart.md) |
| **PULSO 服务器** | 在 VPS 或 PaaS 上部署的**运维者** | 加固的多架构 `distroless` 镜像（`linux/amd64`、`linux/arm64`）、双配置 `docker-compose.yml`（极简模式或 Caddy 无日志 TLS + `coturn`）与一键模板 | [运维者部署指南](./docs/guides/zh-CN/operator-server.md) |

> 全部 4 种语言的完整文档索引：[docs/guides/README.md](./docs/guides/README.md)。

---

## 快速开始与使用方式

### 1. 桌面端房主（无需终端）

1. 前往 [GitHub Releases](https://github.com/gugaucb/pulso/releases) 下载对应平台的 **PULSO Tor** 或 **PULSO 本地 / 隧道**（macOS `.dmg`、Windows `.exe` / 便携 `.zip`、Linux `.AppImage` / `.deb`）。
2. 参考[房主快速入门](./docs/guides/zh-CN/host-quickstart.md)与[校验、离线 U 盘与网桥](./docs/guides/zh-CN/verification-offline-bridges.md)验证 `SHA256SUMS` / `SHA256SUMS.asc`（并按 v1 的 3 步指南通过 macOS Gatekeeper / Windows SmartScreen）。
3. 启动应用：
   - **PULSO Tor：** 选择*直接连接*、内置 *Snowflake* 或粘贴私有网桥（仅存于内存和 `os.tmpdir()`），等待 `.onion` 就绪后在默认浏览器中打开**房间**。
   - **PULSO 本地 / 隧道：** 点击 **启动实例与隧道**（手动选择开启）以生成公开的 `https://*.trycloudflare.com` 邀请链接并在浏览器中打开**房间**。
4. 对话结束后，在控制面板或系统托盘点击 **关闭并清除痕迹**，即可终止所有子进程并擦除临时文件。

### 2. 运维者自托管（Docker 与一键部署）

复制环境变量模板并启动极简配置（配合现有反向代理）或完整生产栈（**Caddy** 无日志自动 TLS + 加固的 **`coturn`** TURN 服务器）：

```bash
cp deploy/.env.example deploy/.env
# 编辑 deploy/.env（设置 PULSO_DOMAIN，并使用 `openssl rand -hex 32` 生成 TURN_SECRET）

# 极简配置（仅绑定到 127.0.0.1:3001）
docker compose -f deploy/docker-compose.yml up -d

# 完整配置（PULSO + Caddy TLS + coturn TURN）
docker compose -f deploy/docker-compose.yml --profile full up -d
```

仓库还提供官方一键部署模板：
- **Coolify：** [deploy/coolify/docker-compose.yml](./deploy/coolify/docker-compose.yml)
- **Portainer.io：** [deploy/portainer/templates.json](./deploy/portainer/templates.json)
- **Render：** [render.yaml](./render.yaml)
- **Fly.io：** [fly.toml](./fly.toml)

防火墙端口（`80/tcp`、`443/tcp+udp`、`3478/tcp+udp`、`49160-49300/udp`）、`TRUST_PROXY` 及 HTTP PaaS 外部 TURN 配置详见[运维者部署指南](./docs/guides/zh-CN/operator-server.md)。

### 3. 从源码本地运行与开发

**环境要求：**
- **Node.js `22+`** 与 **npm**
- *（可选，仅在构建原生 Tauri 桌面端时需要）* **Rust**（`1.83+`）及对应平台的 Tauri 系统依赖

**安装并启动普通模式（开发环境）：**

```bash
git clone https://github.com/gugaucb/pulso.git
cd pulso
npm install
npm run dev
```

`npm run dev` 会在 `http://127.0.0.1:3001` 启动 Fastify + WebSocket 后端，并在 `http://localhost:5173` 启动 Vite 前端开发服务器（自动代理 `/ws`、`/api` 与 `/healthz`）。

**从源码本地启动 Tor 模式：**

```bash
npm run build
node scripts/fetch-tor-bundle.mjs
npm run start:tor
```

> 若系统已安装 `tor`，可直接指定路径：`PULSO_TOR_BIN=/path/to/tor npm run start:tor`。更多架构细节请参见 [docs/tor-mode.md](./docs/tor-mode.md)。

**常用构建与测试命令：**

| 命令 | 说明 |
| :--- | :--- |
| `npm run build` | 类型检查、构建前端 SPA (`dist/`) 与服务端包 (`dist/server/`) |
| `npm run build:desktop-ui` | 构建轻量桌面控制面板前端 (`dist-desktop/`) |
| `npm run build:sidecar` | 使用 `esbuild` 与 Node.js SEA 打包 sidecar 可执行文件 (`scripts/build-sidecar.mjs`) |
| `npm start` | 启动**普通模式**生产服务器 (`node dist/server/index.js`) |
| `npm test` | 运行 Vitest 单元测试与集成测试 |
| `npm run test:e2e` | 运行 Playwright 浏览器端到端测试 |

### 4. 如何使用房间

1. **创建房间：** 打开 Web 界面（或由桌面端自动在默认浏览器打开 `127.0.0.1`），可选填写临时昵称，选择**普通模式**或 **Tor 模式**（由 **PULSO Tor** 启动时自动锁定），点击**创建房间**。
2. **邀请访客：** 分享**房间码**（`XXXX-XXXX`）、完整邀请链接（`/?room=XXXX-XXXX#k=...`，密钥 `#k=` 仅保留在客户端）或 `.onion` 地址（**Tor 模式**下由访客在 Tor Browser 中打开）。
3. **核验加密：** 打开 SAS 安全码校验弹窗，通过可信带外渠道核对短验证码。
4. **通信与清除：** 交换端到端加密的阅后即焚消息（在**普通模式**下预览音视频设备后可开启**视频通话**）。互动或手动续期会重置**非活动倒计时**；离开房间、在桌面端点击 **关闭并清除痕迹** 或倒计时结束时，所有内存状态与临时文件将被彻底清除。

---

## 安全、隐私与威胁模型

- **端到端加密载荷：** 消息在浏览器端通过 `Web Crypto API` 加密，服务器仅转发密文并严格限制每间房最多 2 位参与者。
- **无明文 IP 日志与落盘数据：** 禁用 `Fastify` 请求日志，`SecurityManager` 使用每小时轮换的内存 HMAC-SHA256 密钥对来源 IP 哈希限流；**Tor 模式**仅在 `os.tmpdir()` 下创建 `0700` 权限临时目录（`pulso-tor-*`），退出与启动时均强制清除。
- **隧道中继透明告知：** 使用 **PULSO 本地 / 隧道**时，双方界面均会显示明确提示，说明 Cloudflare 作为隧道中继可见网络元数据与 IP，而聊天内容依然保持端到端加密。
- **零后台回连（Zero phone-home）：** 桌面端绝不后台轮询更新服务器（**PULSO Tor** 零明网请求；**PULSO 本地 / 隧道**仅在用户手动点击检查更新时发起一次请求）。

---

## 架构与技术栈

```text
.
├── src/                  # React 19 前端、Web Crypto E2EE、WebRTC MediaPort、桌面控制面板 UI
├── server/               # Fastify 5 + @fastify/websocket 中继、RoomStore、TorController、CloudflaredAdapter、sidecar
├── shared/               # 共享协议定义、运行时字段过滤与房间码校验
├── src-tauri/            # Tauri v2 桌面壳（系统托盘、进程组清理、tor/local 双配置）
├── deploy/               # Docker Compose（极简 + Caddy/coturn 完整栈）、Caddyfile、Coolify 与 Portainer 模板
├── scripts/              # fetch-tor-bundle、fetch-cloudflared、build-sidecar (Node SEA)、发布与镜像脚本
├── docs/                 # Tor 模式技术文档 (tor-mode.md) 及四语用户/运维指南 (pt-br, en, es, zh-CN)
├── Dockerfile            # 加固的多阶段 distroless nonroot 镜像 (UID 65532)
├── render.yaml           # Render 一键部署蓝图
└── fly.toml              # Fly.io 一键部署配置
```

**技术栈：** TypeScript · React 19 · Vite 6 · Tailwind CSS 4 · Fastify 5 · `@fastify/websocket` · Web Crypto API · WebRTC · C-Tor + `lyrebird` · `cloudflared` · Tauri v2 · Node.js 22 LTS SEA · Docker Distroless · Caddy · `coturn` · Vitest · Playwright。

---

## 环境变量参考

本地开发时所有环境变量均为可选（完整模板参见 [deploy/.env.example](./deploy/.env.example)）：

| 变量 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `PORT` / `HOST` | `3001` / `0.0.0.0` | HTTP/WebSocket 监听端口与网卡（桌面 / Tor 模式强制 `127.0.0.1`） |
| `TRUST_PROXY` | `false` | 位于 Caddy 等反向代理后时设为 `true`、`1` 或跳数，以按参与者隔离限流 |
| `STUN_URLS` | Google STUN | 逗号分隔的 STUN 服务器列表（设为空字符串 `""` 可禁用） |
| `TURN_URLS` | *(未设置)* | 对称 NAT 穿透所需的 TURN/TURNS 地址列表 |
| `TURN_SECRET` / `TURN_TTL_SECONDS` | *(未设置)* / `3600` | 与 `coturn` (`use-auth-secret`) 共享的 HMAC-SHA1 密钥与凭证有效期 |
| `PULSO_INACTIVITY_MS` | `3600000` (1小时) | 房间自动销毁前的**非活动倒计时**时长 |
| `PULSO_GRACE_WINDOW_MS` | `30000` (30秒) | 瞬断重连宽限窗口 |
| `PULSO_MAX_ROOMS` | `1000` | 单实例内存中允许的最大并发房间数 |
| `PULSO_TOR_BIN` | *(自动探测)* | 显式指定 `tor` 可执行文件路径 |
| `PULSO_CLOUDFLARED_BIN` | *(自动探测)* | 显式指定 `cloudflared` 可执行文件路径 |

---

## 参与贡献

欢迎提交改进与翻译！

1. Fork [gugaucb/pulso](https://github.com/gugaucb/pulso) 并创建特性分支。
2. 修改界面文案或文档时请遵循 [GLOSSARY.md](./GLOSSARY.md) 中的规范术语。
3. 补充相应测试并在提交 Pull Request 前执行校验：
   ```bash
   npm run build && npm test
   ```

## 安全漏洞报告

请**勿**在公开 Issue 中披露安全漏洞。请通过 [GitHub Security Advisories](https://github.com/gugaucb/pulso/security/advisories) 私密提交安全报告，以便维护者在公开前完成修复。

## 许可证

基于 [MIT 许可证](./LICENSE) 开源发布。
