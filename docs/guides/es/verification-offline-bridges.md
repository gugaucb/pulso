# Verificación Criptográfica, Uso Offline en USB, Bridges y Espejos `.onion`

[Português (BR)](../pt-br/verification-offline-bridges.md) · [English](../en/verification-offline-bridges.md) · [Español](./verification-offline-bridges.md) · [简体中文](../zh-CN/verification-offline-bridges.md)

Esta guía cubre la verificación criptográfica de las releases de PULSO, el uso 100% sin conexión desde USB/pendrive de **PULSO Tor**, la obtención de bridges privadas frente a censura y cómo terceros o colectivos pueden alojar espejos `.onion`.

---

## 1. Verificar integridad con `SHA256SUMS` y `SHA256SUMS.asc`

Cada release oficial publica los paquetes acompañados de:

- `SHA256SUMS`: resúmenes SHA-256 de cada archivo (`pulso-tor-vX.Y.Z-...` y `pulso-local-vX.Y.Z-...`).
- `SHA256SUMS.asc`: firma PGP separada generada con la clave pública PGP de release del proyecto.
- **GitHub Artifact Attestations** (procedencia SLSA vinculada al repositorio oficial).

> [!IMPORTANT]
> Descarga siempre el paquete junto con `SHA256SUMS`, `SHA256SUMS.asc` y la clave pública PGP oficial del proyecto antes de copiarlos a un equipo sin conexión o memoria USB.

### Paso A — Importar la clave pública PGP del proyecto y verificar `SHA256SUMS.asc`

En macOS (GPG Suite / Homebrew `gnupg`), Linux (`gpg`) o Windows (Gpg4win / Git for Windows):

```bash
# 1. Importa la clave pública PGP de release del proyecto (.asc publicada en el repositorio/release)
gpg --import pulso-release-key.asc

# 2. Verifica la firma de SHA256SUMS
gpg --verify SHA256SUMS.asc SHA256SUMS
```

Confirma que la salida indique `Good signature` perteneciente a la clave de release de PULSO. Nunca ejecutes un archivo si `gpg --verify` muestra `BAD signature`.

### Paso B — Verificar la suma SHA-256 del paquete descargado

Ejecuta el comando correspondiente dentro de la carpeta de descarga:

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
  *(Comprueba que los 64 caracteres hexadecimales coincidan exactamente con la línea correspondiente en `SHA256SUMS`.)*

### Paso C (opcional) — Verificar procedencia SLSA con GitHub CLI

En un equipo con acceso a internet y `gh` instalado:

```bash
gh attestation verify ./pulso-tor-v0.1.0-linux-x64.AppImage --owner pulso-app
```

---

## 2. Uso 100% offline mediante USB / pendrive (**PULSO Tor**)

Todos los paquetes de **PULSO Tor** son **100% autocontenidos**: incluyen el sidecar Node.js SEA, el frontend, el daemon `tor` y `lyrebird`. No descargan nada en tiempo de ejecución.

### Preparación del USB / pendrive

1. En un equipo de preparación, descarga el paquete deseado junto con `SHA256SUMS` y `SHA256SUMS.asc`:
   - **Windows:** `pulso-tor-vX.Y.Z-windows-x64.zip` (versión portátil sin instalación).
   - **Linux:** `pulso-tor-vX.Y.Z-linux-x64.AppImage` (o `linux-arm64.AppImage`).
   - **macOS:** `pulso-tor-vX.Y.Z-macos-arm64.dmg` o `macos-x64.dmg`.
2. Ejecuta la verificación PGP + SHA-256 anterior **antes** de copiar al pendrive (y copia también `SHA256SUMS`, `SHA256SUMS.asc` y la clave pública `.asc` al USB para poder reverificar sin conexión en el equipo de destino).
3. En Windows, extrae el `.zip` en una carpeta del USB (p. ej., `E:\PULSO-Tor\`). En Linux, marca el `.AppImage` como ejecutable (clic derecho > **Propiedades** > **Permisos**). En macOS, abre el `.dmg` directamente desde el USB y sigue los 3 pasos de la [Guía del Anfitrión](./host-quickstart.md).

### Garantías en el equipo de destino

- **PULSO Tor** crea su directorio temporal aislado en `os.tmpdir()` (`0700`) en lugar de escribir estado en el USB o junto al ejecutable.
- Al pulsar **Cerrar y purgar rastro**, se cierran las **Salas**, se limpian las claves `.onion` en RAM y se borra el directorio temporal del disco.
- La comprobación con `gpg --verify` y `sha256sum` / `shasum` funciona **100% offline** usando solo la clave pública importada y los archivos locales del USB.

---

## 3. Evasión de censura y obtención de bridges privadas

Cuando la red del **Anfitrión** bloquea conexiones Tor directas (DPI o filtrado):

### Opción 1 — **Snowflake** integrado (1 clic)

1. Selecciona **Snowflake integrado** en **PULSO Tor** antes de pulsar **Iniciar Instancia Tor**.
2. Si iniciaste en modo directo y se bloqueó, pulsa **Reiniciar con Snowflake (anti-censura)** en la alerta.
3. La aplicación ejecuta el binario unificado `lyrebird` sin escribir registros de diagnóstico en disco.

### Opción 2 — Obtener y pegar **bridges** privadas (`obfs4`, `webtunnel`, `snowflake`, `meek_lite`)

Si Snowflake también está bloqueado, obtén líneas `Bridge` privadas por los canales oficiales de Tor Project:

1. **Web (BridgeDB):** visita `https://bridges.torproject.org` (o desde Tor Browser) y solicita `obfs4` o `webtunnel`.
2. **Telegram:** envía `/bridges` a `@GetBridgesBot`.
3. **Correo electrónico:** escribe a `bridges@torproject.org` desde una cuenta Gmail o Riseup con `get transport obfs4` (o `get transport webtunnel`) en el cuerpo.

En **PULSO Tor**:

1. Selecciona **Bridge personalizada** (o pulsa **Pegar bridge personalizada** si falla el modo directo).
2. Pega tus líneas (`obfs4`, `snowflake`, `webtunnel` y `meek_lite` están soportados).
3. El controlador valida y sanea cada línea frente a inyección en `torrc`, las escribe en un `torrc` efímero (`0600`) **antes** de lanzar Tor y amplía el tiempo límite de arranque a `180s`. Al pulsar **Cerrar y purgar rastro**, nada persiste entre sesiones.

---

## 4. Espejos alternativos y guía para espejo `.onion` comunitario

En regiones con bloqueo a GitHub, los paquetes de **PULSO Tor** junto con `SHA256SUMS` y `SHA256SUMS.asc` pueden replicarse en **Codeberg** o **GitLab** usando `scripts/mirror-release.mjs` (automatizado en CI cuando se configuran las credenciales).

### Cómo terceros y colectivos pueden alojar un espejo `.onion`

Cualquier comunidad u organización puede publicar un espejo `.onion` estático de solo lectura para **PULSO Tor**. Como cada **Anfitrión** verifica `SHA256SUMS.asc`, **no es necesario confiar en el espejo**: un espejo comprometido no puede falsificar la firma PGP del proyecto.

1. **Descarga y verifica los archivos oficiales** de una versión `vX.Y.Z`:
   - Todos los paquetes `pulso-tor-vX.Y.Z-*`
   - `SHA256SUMS` y `SHA256SUMS.asc`
   - La clave pública PGP de release del proyecto (`.asc`)
2. **Sirve la carpeta en loopback** (`127.0.0.1:8080`) con un servidor HTTP estático sin registros de acceso (por ejemplo, Caddy con `log { output discard }` o Nginx con `access_log off;` y `autoindex on;`).
3. **Configura un Onion Service v3** en el `torrc` del servidor espejo:
   ```text
   HiddenServiceDir /var/lib/tor/pulso-mirror/
   HiddenServiceVersion 3
   HiddenServicePort 80 127.0.0.1:8080
   ```
4. **Publica la dirección `.onion`** generada en `/var/lib/tor/pulso-mirror/hostname` junto con el recordatorio de ejecutar `gpg --verify SHA256SUMS.asc SHA256SUMS` y `sha256sum -c` antes de abrir cualquier paquete.
5. **Automatización en Codeberg / GitLab:** quienes mantengan espejos propios en Forgejo/Codeberg o GitLab pueden usar `node scripts/mirror-release.mjs --dir ./release-assets --version 0.1.0 --provider codeberg` (consulta `node scripts/mirror-release.mjs --help`).
