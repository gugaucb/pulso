# Host Quick-Start Guide — PULSO Tor & PULSO Local / Tunnel

[Português (BR)](../pt-br/host-quickstart.md) · [English](./host-quickstart.md) · [Español](../es/host-quickstart.md) · [简体中文](../zh-CN/host-quickstart.md)

This guide explains, in plain language with zero terminal commands required, how a **Host** downloads, opens, and safely stops **PULSO Tor** (**Tor Mode**) or **PULSO Local / Tunnel** (**Normal Mode**).

> [!TIP]
> Before opening any downloaded package, we recommend checking its cryptographic signature in the [Verification, Offline USB & Bridges Guide](./verification-offline-bridges.md).

---

## 1. Which desktop package should I download?

Official release files follow `pulso-tor-vX.Y.Z-<os>-<arch>.<ext>` and `pulso-local-vX.Y.Z-<os>-<arch>.<ext>` on the official Releases page (or alternate mirrors for **PULSO Tor**):

- **PULSO Tor** (**Tor Mode**): choose this when you want to publish a **Room** at an `.onion` address without exposing your IP address or leaving traces on disk. Supports text **Ephemeral Messages** only (no **Video Call**), and the **Guest** joins using **Tor Browser**.
- **PULSO Local / Tunnel** (**Normal Mode**): choose this when you are behind a home router or CGNAT and want to share a **Room** reachable in any standard web browser, with **Ephemeral Messages** and optional **Video Call**.

| Operating system | File to download |
| :--- | :--- |
| **macOS** (Apple Silicon `arm64` or Intel `x64`) | `.dmg` |
| **Windows** (`x64`) | `.exe` installer or portable `.zip` (no install) |
| **Linux** (`x64` or `arm64`) | `.AppImage` (portable) or `.deb` (Ubuntu/Debian) |

---

## 2. Opening v1 in 3 steps (without paid Apple/Microsoft certificates)

In v1, desktop builds do not yet include paid commercial Apple Developer or Microsoft Authenticode certificates. On **first launch**, your operating system shows a standard security prompt. Follow these 3 clicks—no terminal needed:

### macOS Sequoia (Gatekeeper)

PULSO `.dmg` builds are ad-hoc signed at build time so they run cleanly on Apple Silicon and Intel Macs. On first launch:

1. Open the `.dmg`, drag PULSO to **Applications** (or run directly from a USB drive), and double-click it. When the unidentified developer warning appears, click **OK** (or **Done**).
2. Open **System Settings** (Apple menu in the top-left corner) and go to **Privacy & Security**.
3. Scroll down to **Security**, click **Open Anyway** next to the PULSO notice, and confirm with Touch ID or your Mac passcode. From the second launch onward, it opens directly.

### Windows (SmartScreen)

You can run the `.exe` installer or unzip the portable `.zip` into any folder or USB drive and double-click `pulso-desktop.exe`:

1. Double-click the downloaded file. If **Microsoft Defender SmartScreen** displays *"Windows protected your PC"*, keep the window open.
2. Click the **More info** link right below the warning text.
3. Click the **Run anyway** button that appears at the bottom.

### Linux (`.AppImage` or `.deb`)

- **With `.AppImage` (no installation):** right-click the `.AppImage` file in your file manager > **Properties** > **Permissions** > check **Allow executing file as program** (or equivalent toggle), close Properties, and double-click to launch.
- **With `.deb` (Ubuntu / Debian / Mint):** double-click the `.deb` file to open your graphical software installer and click **Install**.

---

## 3. Running PULSO Tor (Tor Mode)

1. Open **PULSO Tor**. Before starting the **Instance**, pick a connection mode:
   - **Direct connection:** fast default for networks without censorship.
   - **Built-in Snowflake:** 1-click automatic censorship circumvention powered by `lyrebird`.
   - **Custom bridge:** paste private bridge lines obtained from the official channels in the [Verification, Offline USB & Bridges Guide](./verification-offline-bridges.md). Bridges stay in RAM and an ephemeral temp directory purged on exit.
2. Click **Start Tor Instance** and watch the human-readable progress (bridge IPs are never exposed).
   - If the network blocks direct Tor traffic and bootstrap stalls, a clear alert offers 1-click **Restart with Snowflake (anti-censorship)** or **Paste custom bridge**.
3. Once the `.onion` address is published, your default browser opens your **Room** at `127.0.0.1` automatically (or click **Open Room in browser**).
4. Create the **Room** and share the **Room Code** and `.onion` address with your **Guest** to open in **Tor Browser**. All **Ephemeral Messages** vanish when the **Room** is closed or the **Inactivity Timer** reaches zero.

---

## 4. Running PULSO Local / Tunnel (Normal Mode)

1. Open **PULSO Local / Tunnel**. The panel explains the tunnel trust model before exposing anything online:
   - The reverse tunnel is **opt-in**: nothing is exposed to the internet until you click **Start Instance with Tunnel**.
   - To keep the **Room** strictly on your local Wi-Fi/LAN, click **Start local only**.
2. When you start the Cloudflare tunnel, the **Instance** creates an `https://...trycloudflare.com` origin without registration or router port forwarding, and opens the **Room** in your default browser.
3. **Participant transparency:** both **Host** and **Guest** see a clear badge inside the **Room** noting that Cloudflare observes network metadata and IP addresses while **Ephemeral Messages** stay end-to-end encrypted in the browser (the key lives in the `#` URL fragment and is never sent to the server).
4. **Best-effort Video Call:** works automatically via STUN when the network allows P2P media. If a strict NAT or corporate firewall blocks direct video, **Ephemeral Messages** continue uninterrupted; optionally, you can enter external TURN details under **Advanced options (RAM-only external TURN)** before starting (kept strictly in RAM).

---

## 5. System tray lifecycle and "Stop and purge trace"

- **Closing the window does not drop your Room:** while the **Instance** is active, closing the panel window minimizes it to the **system tray** (menu bar on macOS, notification area on Windows/Linux) so your **Room** stays online.
- **How to shut down and purge everything:** open the PULSO tray menu (labeled **Encerrar e purgar rastro** in v1 native tray menus) or click **Stop and purge trace** in the panel window. This closes active **Rooms**, stops Tor or the tunnel process tree, and deletes the temporary working directory under `os.tmpdir()`.

---

## 6. Zero phone-home policy (no background update checks)

No PULSO desktop distribution performs automatic background update checks:

- **PULSO Local / Tunnel:** includes an optional manual **Check for updates** button in the panel. Only when clicked does it make a single on-demand request and open the releases page in your browser (never auto-downloading or auto-installing).
- **PULSO Tor:** makes **zero clearnet requests**. The panel displays the installed app and embedded Tor versions with the official releases URL for you to check manually inside **Tor Browser** (or via mirrors described in the [Verification & Mirrors Guide](./verification-offline-bridges.md)).
