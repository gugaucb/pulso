# 密码学校验、U 盘离线使用、网桥与 `.onion` 镜像指南

[Português (BR)](../pt-br/verification-offline-bridges.md) · [English](../en/verification-offline-bridges.md) · [Español](../es/verification-offline-bridges.md) · [简体中文](./verification-offline-bridges.md)

本指南介绍如何验证 PULSO 发布包的密码学签名、通过 U 盘 100% 离线运行 **PULSO Tor**、在审查环境下获取私有网桥，以及社区或第三方如何托管 `.onion` 发布镜像。

---

## 1. 使用 `SHA256SUMS` 与 `SHA256SUMS.asc` 验证完整性

每次官方发布都会随桌面安装包一起提供以下验证文件：

- `SHA256SUMS`：所有发布包（`pulso-tor-vX.Y.Z-...` 与 `pulso-local-vX.Y.Z-...`）的 SHA-256 摘要清单。
- `SHA256SUMS.asc`：使用项目发布 PGP 公钥生成的分离签名文件。
- **GitHub Artifact Attestations**（与官方仓库绑定的 SLSA 构建溯源证明）。

> [!IMPORTANT]
> 在将文件复制到离线电脑或 U 盘之前，请务必同时下载目标安装包、`SHA256SUMS`、`SHA256SUMS.asc` 以及项目官方发布 PGP 公钥。

### 步骤 A — 导入项目 PGP 公钥并验证 `SHA256SUMS.asc`

在 macOS（GPG Suite / Homebrew `gnupg`）、Linux（`gpg`）或 Windows（Gpg4win / Git for Windows）中执行：

```bash
# 1. 导入项目官方发布 PGP 公钥（仓库/发布页提供的 .asc 文件）
gpg --import pulso-release-key.asc

# 2. 验证 SHA256SUMS 的分离签名
gpg --verify SHA256SUMS.asc SHA256SUMS
```

请确认输出包含 PULSO 发布公钥对应的 `Good signature`。如果 `gpg --verify` 报告 `BAD signature`，切勿运行任何文件。

### 步骤 B — 核对下载包的 SHA-256 校验和

在文件所在目录执行对应系统的命令：

- **Linux：**
  ```bash
  sha256sum -c SHA256SUMS --ignore-missing
  ```
- **macOS：**
  ```bash
  shasum -a 256 -c SHA256SUMS --ignore-missing
  ```
- **Windows（PowerShell）：**
  ```powershell
  Get-FileHash .\pulso-tor-v0.1.0-windows-x64.zip -Algorithm SHA256
  Select-String -Pattern "pulso-tor-v0.1.0-windows-x64.zip" .\SHA256SUMS
  ```
  *（确认返回的 64 位十六进制哈希与 `SHA256SUMS` 中对应行完全一致。）*

### 步骤 C（可选）— 使用 GitHub CLI 验证 SLSA 溯源

在已安装 `gh` 的联网设备上：

```bash
gh attestation verify ./pulso-tor-v0.1.0-linux-x64.AppImage --owner pulso-app
```

---

## 2. 通过 U 盘 100% 离线使用（**PULSO Tor**）

所有 **PULSO Tor** 发布包均 **100% 自包含**：内置 Node.js SEA 后端、前端资源、`tor` 守护进程以及 `lyrebird`，运行时不会下载任何组件。

### 准备 U 盘

1. 在联网准备机上下载目标安装包以及 `SHA256SUMS`、`SHA256SUMS.asc`：
   - **Windows：** `pulso-tor-vX.Y.Z-windows-x64.zip`（便携压缩包，不写入系统注册表）。
   - **Linux：** `pulso-tor-vX.Y.Z-linux-x64.AppImage`（或 `linux-arm64.AppImage`）。
   - **macOS：** `pulso-tor-vX.Y.Z-macos-arm64.dmg` 或 `macos-x64.dmg`。
2. 在复制到 U 盘**之前**完成上述 PGP + SHA-256 校验（同时可将 `SHA256SUMS`、`SHA256SUMS.asc` 和 `.asc` 公钥一并放入 U 盘，以便在离线目标机上复核）。
3. Windows 上将 `.zip` 解压到 U 盘目录（例如 `E:\PULSO-Tor\`）；Linux 上在文件属性中勾选可执行权限；macOS 上直接从 U 盘打开 `.dmg`，并按[房主快速入门指南](./host-quickstart.md)中的 3 步放行。

### 目标电脑上的安全保障

- **PULSO Tor** 会在系统 `os.tmpdir()` 下创建隔离的 `0700` 临时目录，不会向 U 盘或应用所在目录写入运行状态。
- 点击 **关闭并清除痕迹** 后，所有**房间**、内存中的 `.onion` 私钥及临时目录都会从磁盘彻底清除。
- `gpg --verify` 与 `sha256sum` / `shasum` 校验完全依赖本地文件和已导入公钥，可 **100% 离线**执行。

---

## 3. 突破审查与获取私有网桥

当**房主**所在网络屏蔽直连 Tor 流量（如 DPI 深度包检测或端口封锁）时：

### 方式一 — 一键启用内置 **Snowflake**

1. 在 **PULSO Tor** 启动前选择 **内置 Snowflake**，再点击 **启动 Tor 实例**。
2. 如果以直连启动后引导停滞，可点击提示中的 **使用 Snowflake 重启（抗审查）**。
3. 应用会通过统一二进制 `lyrebird` 启动抗审查传输，且不向磁盘写入诊断日志。

### 方式二 — 获取并粘贴私有 **网桥**（`obfs4`、`webtunnel`、`snowflake`、`meek_lite`）

若内置 Snowflake 同样受限，可通过 Tor Project 官方渠道获取私有 `Bridge` 配置行：

1. **网页（BridgeDB）：** 访问 `https://bridges.torproject.org`（或通过 Tor Browser 打开）申请 `obfs4` 或 `webtunnel`。
2. **Telegram：** 向 `@GetBridgesBot` 发送 `/bridges`。
3. **电子邮件：** 使用 Gmail 或 Riseup 邮箱向 `bridges@torproject.org` 发送邮件，正文填写 `get transport obfs4`（或 `get transport webtunnel`）。

在 **PULSO Tor** 界面中：

1. 选择 **自定义网桥**（或在直连卡住时点击 **粘贴自定义网桥**）。
2. 粘贴获得的网桥行（支持 `obfs4`、`snowflake`、`webtunnel` 和 `meek_lite`）。
3. 控制器会对每一行执行防 `torrc` 注入校验，在启动进程**之前**写入临时 `0600` `torrc`，并将超时放宽至 `180s`。点击 **关闭并清除痕迹** 后不保留任何跨会话配置。

---

## 4. 备用镜像与社区 `.onion` 镜像搭建指南

在屏蔽 GitHub 的地区，**PULSO Tor** 安装包及 `SHA256SUMS`、`SHA256SUMS.asc` 可通过 `scripts/mirror-release.mjs` 同步到 **Codeberg** 或 **GitLab**（CI 已内置对应自动化钩子）。

### 第三方与社区如何托管 `.onion` 镜像

任何社区或组织都可以为 **PULSO Tor** 搭建只读静态 `.onion` 镜像。由于每位**房主**都会用 `SHA256SUMS.asc` 校验安装包，**镜像本身无需被无条件信任**——被篡改的镜像无法伪造项目的 PGP 签名。

1. **下载并校验官方发布文件**（针对标签 `vX.Y.Z`）：
   - 所有 `pulso-tor-vX.Y.Z-*` 安装包
   - `SHA256SUMS` 与 `SHA256SUMS.asc`
   - 项目官方发布 PGP 公钥 `.asc`
2. **在本地回环地址提供静态文件服务**（`127.0.0.1:8080`），并关闭访问日志（例如 Caddy 使用 `log { output discard }`，或 Nginx 使用 `access_log off;` 与 `autoindex on;`）。
3. **在镜像服务器的 `torrc` 中配置 Onion Service v3：**
   ```text
   HiddenServiceDir /var/lib/tor/pulso-mirror/
   HiddenServiceVersion 3
   HiddenServicePort 80 127.0.0.1:8080
   ```
4. **公布 `/var/lib/tor/pulso-mirror/hostname` 中的 `.onion` 域名**，并醒目提醒下载者在运行前先执行 `gpg --verify SHA256SUMS.asc SHA256SUMS` 和 `sha256sum -c`。
5. **Codeberg / GitLab 镜像同步脚本：** 自建 Forgejo/Codeberg 或 GitLab 镜像站可使用 `node scripts/mirror-release.mjs --dir ./release-assets --version 0.1.0 --provider codeberg` 同步本地已校验目录（详见 `node scripts/mirror-release.mjs --help`）。
