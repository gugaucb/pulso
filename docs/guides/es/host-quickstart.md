# Guía Rápida del Anfitrión — PULSO Tor y PULSO Local / Túnel

[Português (BR)](../pt-br/host-quickstart.md) · [English](../en/host-quickstart.md) · [Español](./host-quickstart.md) · [简体中文](../zh-CN/host-quickstart.md)

Esta guía explica, en lenguaje claro y sin necesidad de abrir una terminal, cómo un **Anfitrión** descarga, abre y cierra de forma segura **PULSO Tor** (**Modo Tor**) o **PULSO Local / Túnel** (**Modo Normal**).

> [!TIP]
> Antes de abrir cualquier archivo descargado, recomendamos verificar su firma criptográfica en la [Guía de verificación, uso offline y bridges](./verification-offline-bridges.md).

---

## 1. ¿Qué versión de escritorio descargar?

Los archivos oficiales siguen el formato `pulso-tor-vX.Y.Z-<sistema>.<ext>` y `pulso-local-vX.Y.Z-<sistema>.<ext>` en la página oficial de releases (o en los espejos alternativos para **PULSO Tor**):

- **PULSO Tor** (**Modo Tor**): ideal para publicar una **Sala** en una dirección `.onion` sin exponer tu dirección IP ni dejar rastros en el equipo. Admite únicamente **Mensajes Efímeros** de texto (sin **Videollamada**) y el **Invitado** se conecta mediante **Tor Browser**.
- **PULSO Local / Túnel** (**Modo Normal**): ideal cuando estás detrás de un router doméstico o CGNAT y deseas compartir una **Sala** accesible en cualquier navegador estándar, con **Mensajes Efímeros** y **Videollamada** opcional.

| Sistema operativo | Archivo a descargar |
| :--- | :--- |
| **macOS** (Apple Silicon `arm64` o Intel `x64`) | `.dmg` |
| **Windows** (`x64`) | Instalador `.exe` o paquete portátil `.zip` (sin instalación) |
| **Linux** (`x64` o `arm64`) | `.AppImage` (portátil) o `.deb` (Ubuntu/Debian) |

---

## 2. Cómo abrir en la v1 en 3 pasos (sin certificado de pago)

En la v1, los binarios todavía no incluyen certificados comerciales de pago de Apple o Microsoft. Por ello, al **abrir por primera vez**, el sistema operativo muestra un aviso estándar de seguridad. Sigue estos 3 pasos sin usar terminal:

### macOS Sequoia (Gatekeeper)

Los archivos `.dmg` de PULSO vienen prefirmados de forma ad-hoc en compilación para funcionar en Apple Silicon e Intel. La primera vez:

1. Abre el archivo `.dmg`, arrastra PULSO a **Aplicaciones** (o ábrelo directamente desde una memoria USB) y haz doble clic. Cuando aparezca el aviso de desarrollador no identificado, haz clic en **OK** (o **Aceptar**).
2. Abre **Ajustes del Sistema** (menú de Apple arriba a la izquierda) y entra en **Privacidad y Seguridad**.
3. Desplázate hasta **Seguridad**, haz clic en **Abrir de todos modos** junto al aviso de PULSO y confirma con tu huella o contraseña del Mac. A partir de la segunda vez se abrirá directamente.

### Windows (SmartScreen)

Puedes ejecutar el instalador `.exe` o descomprimir el `.zip` portátil en cualquier carpeta o USB y abrir `pulso-desktop.exe`:

1. Haz doble clic en el archivo descargado. Si aparece la pantalla azul de **Microsoft Defender SmartScreen** (*"Windows protegió su PC"*), no la cierres.
2. Haz clic en el enlace **Más información** debajo del aviso.
3. Haz clic en el botón **Ejecutar de todas formas** que aparece abajo.

### Linux (`.AppImage` o `.deb`)

- **Con `.AppImage` (sin instalación):** haz clic derecho sobre el `.AppImage` en tu gestor de archivos > **Propiedades** > **Permisos** > marca **Permitir ejecutar el archivo como un programa** (o equivalente), cierra la ventana y haz doble clic.
- **Con `.deb` (Ubuntu / Debian / Mint):** haz doble clic en el `.deb` para abrir el instalador gráfico del sistema y pulsa **Instalar**.

---

## 3. Usando PULSO Tor (Modo Tor)

1. Abre **PULSO Tor**. Antes de iniciar la **Instancia**, elige el modo de conexión:
   - **Conexión directa:** opción rápida para redes sin censura.
   - **Snowflake integrado:** evasión automática de censura en 1 clic mediante `lyrebird`.
   - **Bridge personalizada:** pega líneas obtenidas en los canales oficiales descritos en la [Guía de bridges y uso offline](./verification-offline-bridges.md). Permanecen solo en RAM y en un directorio temporal purgado al cerrar.
2. Haz clic en **Iniciar Instancia Tor** y observa el progreso legible en el panel (nunca expone direcciones IP de bridges).
   - Si la red bloquea el tráfico Tor directo y el arranque se detiene, aparecerá una alerta con el botón de 1 clic **Reiniciar con Snowflake (anti-censura)** o **Pegar bridge personalizada**.
3. Cuando la dirección `.onion` esté lista, tu navegador predeterminado abrirá la **Sala** en `127.0.0.1` automáticamente (o pulsa **Abrir Sala en el navegador**).
4. Crea la **Sala** y comparte el **Código de la Sala** y la dirección `.onion` con el **Invitado** para que abra en **Tor Browser**. Todos los **Mensajes Efímeros** desaparecen al cerrar la **Sala** o cuando el **Temporizador de Inactividad** llega a cero.

---

## 4. Usando PULSO Local / Túnel (Modo Normal)

1. Abre **PULSO Local / Túnel**. El panel explica el modelo de confianza del túnel antes de exponer nada a internet:
   - El túnel inverso es **opt-in**: no se expone nada hasta que pulses **Iniciar Instancia con Túnel**.
   - Si prefieres usar solo tu red local (Wi-Fi/LAN), pulsa **Iniciar solo local**.
2. Al activar el túnel Cloudflare, la **Instancia** genera una dirección `https://...trycloudflare.com` sin registro ni apertura de puertos en el router, y abre la **Sala** en tu navegador predeterminado.
3. **Transparencia para los Participantes:** tanto el **Anfitrión** como el **Invitado** ven un aviso visible dentro de la **Sala** indicando que Cloudflare observa metadatos de red e IPs para enrutar el tráfico, mientras los **Mensajes Efímeros** siguen cifrados de extremo a extremo en el navegador (la clave permanece en el fragmento `#` del enlace).
4. **Videollamada *best-effort*:** funciona automáticamente con STUN cuando la red permite tráfico P2P. Si un NAT estricto o firewall bloquea el vídeo, los **Mensajes Efímeros** de texto continúan sin interrupción; opcionalmente puedes indicar un TURN externo en **Opciones avanzadas (TURN externo en RAM)** antes de iniciar (solo en memoria RAM).

---

## 5. Bandeja del sistema y "Cerrar y purgar rastro"

- **Cerrar la ventana no cierra tu Sala:** mientras la **Instancia** esté activa, cerrar la ventana minimiza el panel a la **bandeja del sistema** (barra superior en macOS, área de notificación en Windows/Linux) para mantener tu **Sala** en línea.
- **Cómo detener y purgar todo:** abre el menú del icono en la bandeja (etiquetado como **Encerrar e purgar rastro** en el menú nativo v1) o haz clic en **Cerrar y purgar rastro** en la ventana del panel. Esto cierra las **Salas** activas, detiene el daemon Tor o el túnel y borra el directorio temporal creado en `os.tmpdir()`.

---

## 6. Política cero *phone-home* (sin comprobaciones en segundo plano)

Ninguna distribución de escritorio de PULSO realiza comprobaciones automáticas de actualización en segundo plano:

- **PULSO Local / Túnel:** incluye un botón manual opcional **Buscar actualizaciones** en el panel. Solo al pulsarlo realiza una única consulta bajo demanda y abre la página oficial de releases en tu navegador (sin descargas ni instalaciones automáticas).
- **PULSO Tor:** realiza **cero peticiones en clearnet**. El panel muestra la versión instalada y la versión de Tor integrada junto con el enlace oficial para consultarlo manualmente desde **Tor Browser** (o mediante espejos descritos en la [Guía de verificación y espejos](./verification-offline-bridges.md)).
