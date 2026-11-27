# Cryptographic Verification, Offline USB, Bridges & `.onion` Mirrors

[Português (BR)](../pt-br/verification-offline-bridges.md) · [English](./verification-offline-bridges.md) · [Español](../es/verification-offline-bridges.md) · [简体中文](../zh-CN/verification-offline-bridges.md)

This guide covers verifying PULSO release signatures, running **PULSO Tor** 100% offline from a USB drive/pendrive, obtaining private bridges under censorship, and hosting community `.onion` release mirrors.

---

## 1. Verify integrity with `SHA256SUMS` and `SHA256SUMS.asc`

Every official release publishes desktop packages alongside:

- `SHA256SUMS`: SHA-256 digests for every release file (`pulso-tor-vX.Y.Z-...` and `pulso-local-vX.Y.Z-...`).
- `SHA256SUMS.asc`: detached PGP signature created with the project's PGP release signing key.
- **GitHub Artifact Attestations** (SLSA build provenance tied to the official repository).

> [!IMPORTANT]
> Always download your package together with `SHA256SUMS`, `SHA256SUMS.asc`, and the project's public PGP release key before transferring files to an offline machine or USB drive.

### Step A — Import the project PGP public key and verify `SHA256SUMS.asc`

On macOS (GPG Suite / Homebrew `gnupg`), Linux (`gpg`), or Windows (Gpg4win / Git for Windows):

```bash
# 1. Import the project's PGP release public key (.asc published in the repository/release)
gpg --import pulso-release-key.asc

# 2. Verify the detached signature on SHA256SUMS
gpg --verify SHA256SUMS.asc SHA256SUMS
```

Confirm the output reports `Good signature` for the PULSO release key. Never run a binary if `gpg --verify` reports `BAD signature`.

### Step B — Verify the downloaded file's SHA-256 checksum

Run the command for your platform inside the download folder:

- **Linux:**
  ```bash
  sha256sum -c SHA256SUMS --ignore-missing
  ```
- **macOS:**
  ```bash
  shasum -a 256 -c SHA256SUMS --ignore-missing
  ```
- **Windows (PowerShell):**
  ```powershell
  Get-FileHash .\pulso-tor-v0.1.0-windows-x64.zip -Algorithm SHA256
  Select-String -Pattern "pulso-tor-v0.1.0-windows-x64.zip" .\SHA256SUMS
  ```
  *(Confirm the 64 hex characters match the corresponding line in `SHA256SUMS`.)*

### Step C (optional) — Verify SLSA provenance with GitHub CLI

When `gh` is available on an online machine:

```bash
gh attestation verify ./pulso-tor-v0.1.0-linux-x64.AppImage --owner pulso-app
```

---

## 2. 100% offline USB / pendrive usage (**PULSO Tor**)

All **PULSO Tor** packages are **100% self-contained**: the Node.js SEA sidecar, frontend assets, `tor` daemon, and `lyrebird` are all bundled inside. Nothing is downloaded at runtime.

### Preparing the USB drive / pendrive

1. On a preparation computer, download the target package along with `SHA256SUMS` and `SHA256SUMS.asc`:
   - **Windows:** `pulso-tor-vX.Y.Z-windows-x64.zip` (portable archive; leaves no registry entries).
   - **Linux:** `pulso-tor-vX.Y.Z-linux-x64.AppImage` (or `linux-arm64.AppImage`).
   - **macOS:** `pulso-tor-vX.Y.Z-macos-arm64.dmg` or `macos-x64.dmg`.
2. Run the PGP + SHA-256 verification above **before** copying to the USB drive (and also copy `SHA256SUMS`, `SHA256SUMS.asc`, and the `.asc` public key onto the USB drive so the target machine can re-verify offline).
3. On Windows, extract the `.zip` into a USB folder (e.g. `E:\PULSO-Tor\`). On Linux, mark the `.AppImage` executable (right-click > **Properties** > **Permissions**). On macOS, open the `.dmg` straight from the USB drive and follow the 3 Gatekeeper steps in the [Host Quick-Start Guide](./host-quickstart.md).

### Runtime guarantees on the target machine

- **PULSO Tor** creates its isolated temporary directory inside `os.tmpdir()` (`0700`) rather than writing state onto the USB drive or next to the app binary.
- Clicking **Stop and purge trace** destroys active **Rooms**, clears RAM `.onion` keys, and removes the temporary directory from disk.
- Integrity checks with `gpg --verify` and `sha256sum` / `shasum` work **100% offline** using only the imported public key and local files on the USB drive.

---

## 3. Censorship circumvention & obtaining private bridges

When the **Host** network blocks direct Tor connections (DPI or port filtering):

### Option 1 — Built-in **Snowflake** (1 click)

1. Select **Built-in Snowflake** in **PULSO Tor** before clicking **Start Tor Instance**.
2. If you started in direct mode and bootstrap stalled, click **Restart with Snowflake (anti-censorship)** on the stall alert.
3. The app launches the unified `lyrebird` binary with diagnostic logging disabled.

### Option 2 — Obtain and paste private **bridges** (`obfs4`, `webtunnel`, `snowflake`, `meek_lite`)

If Snowflake is also blocked on your network, request private `Bridge` lines from Tor Project's official distribution channels:

1. **Web (BridgeDB):** visit `https://bridges.torproject.org` (or via Tor Browser) and request `obfs4` or `webtunnel`.
2. **Telegram:** send `/bridges` to `@GetBridgesBot`.
3. **Email:** send an email to `bridges@torproject.org` from a Gmail or Riseup address with `get transport obfs4` (or `get transport webtunnel`) in the message body.

In **PULSO Tor**:

1. Choose **Custom bridge** (or click **Paste custom bridge** if direct mode stalls).
2. Paste your bridge lines (`obfs4`, `snowflake`, `webtunnel`, and `meek_lite` are supported).
3. The controller sanitizes every line against `torrc` injection, writes them into an ephemeral `0600` `torrc` **before** spawning Tor, and raises the startup timeout to `180s`. Clicking **Stop and purge trace** wipes them with zero persistence across sessions.

---

## 4. Alternate mirrors & community `.onion` mirror guide

Where GitHub is blocked, **PULSO Tor** artifacts plus `SHA256SUMS` and `SHA256SUMS.asc` can be mirrored to **Codeberg** or **GitLab** via `scripts/mirror-release.mjs` (automated in CI when mirror credentials are configured).

### How third parties and collectives can host an `.onion` mirror

Any community member or organization can serve a static, read-only `.onion` mirror of **PULSO Tor** releases. Because every **Host** verifies `SHA256SUMS.asc`, **mirrors do not need to be trusted**: a tampered mirror cannot forge the project's PGP signature.

1. **Download and verify the official release files** for tag `vX.Y.Z`:
   - All `pulso-tor-vX.Y.Z-*` packages
   - `SHA256SUMS` and `SHA256SUMS.asc`
   - The project's PGP release public key `.asc`
2. **Serve the directory on loopback** (`127.0.0.1:8080`) using a minimal static HTTP server with access logs disabled (e.g., Caddy with `log { output discard }` or Nginx with `access_log off;` and `autoindex on;`).
3. **Configure an Onion Service v3** in the mirror host's `torrc`:
   ```text
   HiddenServiceDir /var/lib/tor/pulso-mirror/
   HiddenServiceVersion 3
   HiddenServicePort 80 127.0.0.1:8080
   ```
4. **Publish the `.onion` hostname** from `/var/lib/tor/pulso-mirror/hostname` together with clear instructions reminding users to run `gpg --verify SHA256SUMS.asc SHA256SUMS` and `sha256sum -c` before running any package.
5. **Mirror automation for Codeberg / GitLab:** operators running their own Forgejo/Codeberg or GitLab mirror can sync a verified local directory using `node scripts/mirror-release.mjs --dir ./release-assets --version 0.1.0 --provider codeberg` (see `node scripts/mirror-release.mjs --help`).
