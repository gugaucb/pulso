import type { Locale } from '../domain/types';
import type { TorBootstrapPhase } from './types';

export interface DesktopDictionary {
  flavorTorTitle: string;
  flavorTorSubtitle: string;
  flavorLocalTitle: string;
  flavorLocalSubtitle: string;
  statusLabel: string;
  statusIdle: string;
  statusStarting: string;
  statusBootstrapping: string;
  statusTunnelStarting: string;
  statusReady: string;
  statusStalled: string;
  statusStopping: string;
  statusError: string;
  trayMinimizedNotice: string;
  dismissNotice: string;
  openRoomInBrowser: string;
  stopAndPurge: string;
  purgedConfirmation: string;
  stoppedConfirmation: string;
  localUrlLabel: string;
  onionUrlLabel: string;
  publicOriginLabel: string;
  tor: {
    connectionGroupLabel: string;
    modeDirectLabel: string;
    modeDirectHint: string;
    modeSnowflakeLabel: string;
    modeSnowflakeHint: string;
    modeCustomLabel: string;
    modeCustomHint: string;
    customBridgesLabel: string;
    customBridgesPlaceholder: string;
    customBridgesHelpTitle: string;
    customBridgesHelpBody: string;
    customBridgesRamNotice: string;
    customBridgesEmptyError: string;
    startButton: string;
    stallTitle: string;
    stallBody: string;
    restartSnowflakeButton: string;
    pasteCustomBridgeButton: string;
    zeroClearnetNotice: string;
    torVersionLabel: (version: string) => string;
    manualUpdateInstruction: string;
    manualUpdateMirrorUrl: string;
    phases: Record<TorBootstrapPhase, string>;
    progressPercent: (percent: number) => string;
  };
  local: {
    trustModelTitle: string;
    trustModelBody: string;
    startWithTunnelButton: string;
    startLocalOnlyButton: string;
    advancedOptionsToggle: string;
    turnRamNotice: string;
    turnUrlsLabel: string;
    turnUrlsPlaceholder: string;
    turnUsernameLabel: string;
    turnCredentialLabel: string;
    turnSecretLabel: string;
    tunnelActiveBadge: string;
    tunnelErrorNotice: (message: string) => string;
    localOnlyReadyNotice: string;
    checkUpdatesButton: string;
    checkingUpdates: string;
    updateAvailableNotice: (version: string) => string;
    upToDateNotice: (version: string) => string;
    updateCheckFailedNotice: string;
  };
}

const PT_BR: DesktopDictionary = {
  flavorTorTitle: 'PULSO Tor',
  flavorTorSubtitle: 'Instância local zero-rastro com serviço .onion embutido para Salas no Modo Tor.',
  flavorLocalTitle: 'PULSO Local / Túnel',
  flavorLocalSubtitle: 'Instância local no Modo Normal com túnel reverso opt-in para Salas com Mensagem Efêmera e Chamada de Vídeo.',
  statusLabel: 'Estado da Instância',
  statusIdle: 'Pronta para iniciar',
  statusStarting: 'Iniciando Instância…',
  statusBootstrapping: 'Conectando à rede Tor…',
  statusTunnelStarting: 'Abrindo túnel reverso…',
  statusReady: 'Instância ativa',
  statusStalled: 'Conexão bloqueada ou lenta',
  statusStopping: 'Encerrando e purgando rastro…',
  statusError: 'Falha ao iniciar Instância',
  trayMinimizedNotice: 'A Instância continua ativa na bandeja do sistema para manter sua Sala no ar. Use "Encerrar e purgar rastro" quando terminar.',
  dismissNotice: 'Fechar aviso',
  openRoomInBrowser: 'Abrir Sala no navegador',
  stopAndPurge: 'Encerrar e purgar rastro',
  purgedConfirmation: 'Instância encerrada e rastro temporário purgado do disco.',
  stoppedConfirmation: 'Instância encerrada e memória limpa.',
  localUrlLabel: 'Endereço local da Sala',
  onionUrlLabel: 'Endereço .onion para o Convidado',
  publicOriginLabel: 'Link público via túnel (Cloudflare)',
  tor: {
    connectionGroupLabel: 'Modo de conexão Tor',
    modeDirectLabel: 'Conexão direta',
    modeDirectHint: 'Padrão rápido para redes sem bloqueio.',
    modeSnowflakeLabel: 'Snowflake embutido',
    modeSnowflakeHint: 'Contorno automático de censura em 1 clique via lyrebird.',
    modeCustomLabel: 'Bridge personalizada',
    modeCustomHint: 'Cole linhas obfs4, snowflake, webtunnel ou meek_lite.',
    customBridgesLabel: 'Linhas de bridge (apenas em RAM)',
    customBridgesPlaceholder: 'obfs4 192.0.2.1:443 FINGERPRINT cert=... iat-mode=0',
    customBridgesHelpTitle: 'Como obter bridges privadas:',
    customBridgesHelpBody: 'Acesse bridges.torproject.org (BridgeDB), fale com @GetBridgesBot no Telegram ou envie e-mail para bridges@torproject.org.',
    customBridgesRamNotice: 'Zero persistência entre sessões: mantidas apenas em RAM e em diretório temporário purgado ao encerrar.',
    customBridgesEmptyError: 'Cole ao menos uma linha de bridge antes de iniciar a Instância.',
    startButton: 'Iniciar Instância Tor',
    stallTitle: 'A rede pode estar bloqueando o Tor',
    stallBody: 'O arranque ficou travado antes de completar a conexão. Reinicie com Snowflake embutido ou cole uma bridge personalizada.',
    restartSnowflakeButton: 'Reiniciar com Snowflake (anti-censura)',
    pasteCustomBridgeButton: 'Colar bridge personalizada',
    zeroClearnetNotice: 'Zero requisições na clearnet: este aplicativo nunca consulta atualizações em segundo plano.',
    torVersionLabel: (version) => `Tor ${version}`,
    manualUpdateInstruction: 'Para verificar novas versões com segurança, abra a página oficial de releases manualmente pelo Tor Browser:',
    manualUpdateMirrorUrl: 'https://github.com/pulso-app/pulso/releases',
    phases: {
      starting: 'Preparando daemon Tor isolado…',
      conn_pt: 'Conectando à ponte anti-censura…',
      conn_done_pt: 'Ponte anti-censura alcançada…',
      handshake_pt: 'Negociando transporte camuflado…',
      bootstrap: 'Conectando à rede Tor…',
      hs_desc: 'Publicando endereço .onion…',
      ready: 'Endereço .onion publicado e pronto para abrir a Sala.',
      error: 'Erro no arranque do Tor.',
    },
    progressPercent: (percent) => `${Math.max(0, Math.min(100, Math.round(percent)))}%`,
  },
  local: {
    trustModelTitle: 'Modelo de confiança do túnel (opt-in)',
    trustModelBody: 'Ao ativar o túnel Cloudflare, esse intermediário observa metadados e IPs de rede para rotear sua Sala atrás de CGNAT. Suas Mensagens Efêmeras seguem cifradas ponta a ponta no navegador.',
    startWithTunnelButton: 'Iniciar Instância com Túnel',
    startLocalOnlyButton: 'Iniciar apenas local',
    advancedOptionsToggle: 'Opções avançadas (TURN externo em RAM)',
    turnRamNotice: 'Credenciais TURN ficam apenas em RAM e seguem via stdin para o processo local, sem gravação em disco.',
    turnUrlsLabel: 'URLs TURN (separadas por vírgula)',
    turnUrlsPlaceholder: 'turn:turn.exemplo.org:3478,turns:turn.exemplo.org:5349',
    turnUsernameLabel: 'Usuário TURN (opcional)',
    turnCredentialLabel: 'Credencial TURN (opcional)',
    turnSecretLabel: 'Segredo compartilhado TURN_SECRET (opcional)',
    tunnelActiveBadge: 'Túnel Cloudflare ativo',
    tunnelErrorNotice: (message) => `Túnel indisponível (${message}). A Instância segue acessível localmente em 127.0.0.1.`,
    localOnlyReadyNotice: 'Instância local ativa sem túnel externo. Abra a Sala no navegador padrão.',
    checkUpdatesButton: 'Verificar atualizações',
    checkingUpdates: 'Verificando…',
    updateAvailableNotice: (version) => `Nova versão v${version} disponível. A página de release foi aberta no navegador.`,
    upToDateNotice: (version) => `Você já está na versão mais recente (v${version}).`,
    updateCheckFailedNotice: 'Não foi possível consultar o manifesto de releases agora.',
  },
};

const EN: DesktopDictionary = {
  flavorTorTitle: 'PULSO Tor',
  flavorTorSubtitle: 'Zero-trace local Instance with embedded .onion service for Tor Mode Rooms.',
  flavorLocalTitle: 'PULSO Local / Tunnel',
  flavorLocalSubtitle: 'Normal Mode local Instance with opt-in reverse tunnel for Ephemeral Messages and Video Calls.',
  statusLabel: 'Instance Status',
  statusIdle: 'Ready to start',
  statusStarting: 'Starting Instance…',
  statusBootstrapping: 'Connecting to Tor network…',
  statusTunnelStarting: 'Opening reverse tunnel…',
  statusReady: 'Instance active',
  statusStalled: 'Connection blocked or stalled',
  statusStopping: 'Stopping and purging trace…',
  statusError: 'Failed to start Instance',
  trayMinimizedNotice: 'The Instance stays active in the system tray to keep your Room alive. Use "Stop and purge trace" when finished.',
  dismissNotice: 'Dismiss notice',
  openRoomInBrowser: 'Open Room in browser',
  stopAndPurge: 'Stop and purge trace',
  purgedConfirmation: 'Instance stopped and temporary trace purged from disk.',
  stoppedConfirmation: 'Instance stopped and memory cleared.',
  localUrlLabel: 'Local Room address',
  onionUrlLabel: '.onion address for Guest',
  publicOriginLabel: 'Public tunnel link (Cloudflare)',
  tor: {
    connectionGroupLabel: 'Tor connection mode',
    modeDirectLabel: 'Direct connection',
    modeDirectHint: 'Fast default for networks without censorship.',
    modeSnowflakeLabel: 'Built-in Snowflake',
    modeSnowflakeHint: '1-click automatic censorship circumvention via lyrebird.',
    modeCustomLabel: 'Custom bridge',
    modeCustomHint: 'Paste obfs4, snowflake, webtunnel, or meek_lite lines.',
    customBridgesLabel: 'Bridge lines (RAM-only)',
    customBridgesPlaceholder: 'obfs4 192.0.2.1:443 FINGERPRINT cert=... iat-mode=0',
    customBridgesHelpTitle: 'How to obtain private bridges:',
    customBridgesHelpBody: 'Visit bridges.torproject.org (BridgeDB), message @GetBridgesBot on Telegram, or email bridges@torproject.org.',
    customBridgesRamNotice: 'Zero persistence across sessions: kept only in RAM and an ephemeral temp directory purged on exit.',
    customBridgesEmptyError: 'Paste at least one bridge line before starting the Instance.',
    startButton: 'Start Tor Instance',
    stallTitle: 'The network may be blocking Tor',
    stallBody: 'Bootstrap stalled before completing the circuit. Restart with built-in Snowflake or paste a custom bridge.',
    restartSnowflakeButton: 'Restart with Snowflake (anti-censorship)',
    pasteCustomBridgeButton: 'Paste custom bridge',
    zeroClearnetNotice: 'Zero clearnet requests: this app never checks for updates in the background.',
    torVersionLabel: (version) => `Tor ${version}`,
    manualUpdateInstruction: 'To check for new releases safely, open the official releases page manually inside Tor Browser:',
    manualUpdateMirrorUrl: 'https://github.com/pulso-app/pulso/releases',
    phases: {
      starting: 'Preparing isolated Tor daemon…',
      conn_pt: 'Connecting to anti-censorship bridge…',
      conn_done_pt: 'Anti-censorship bridge reached…',
      handshake_pt: 'Negotiating pluggable transport…',
      bootstrap: 'Connecting to Tor network…',
      hs_desc: 'Publishing .onion address…',
      ready: '.onion address published and ready to open the Room.',
      error: 'Tor bootstrap failed.',
    },
    progressPercent: (percent) => `${Math.max(0, Math.min(100, Math.round(percent)))}%`,
  },
  local: {
    trustModelTitle: 'Tunnel trust model (opt-in)',
    trustModelBody: 'Enabling the Cloudflare tunnel lets Cloudflare observe network metadata and IP addresses to route your Room behind CGNAT. Ephemeral Messages remain end-to-end encrypted in your browser.',
    startWithTunnelButton: 'Start Instance with Tunnel',
    startLocalOnlyButton: 'Start local only',
    advancedOptionsToggle: 'Advanced options (RAM-only external TURN)',
    turnRamNotice: 'TURN credentials stay strictly in RAM and pass via stdin to the local process without touching disk.',
    turnUrlsLabel: 'TURN URLs (comma-separated)',
    turnUrlsPlaceholder: 'turn:turn.example.org:3478,turns:turn.example.org:5349',
    turnUsernameLabel: 'TURN username (optional)',
    turnCredentialLabel: 'TURN credential (optional)',
    turnSecretLabel: 'Shared secret TURN_SECRET (optional)',
    tunnelActiveBadge: 'Cloudflare tunnel active',
    tunnelErrorNotice: (message) => `Tunnel unavailable (${message}). The Instance remains accessible locally at 127.0.0.1.`,
    localOnlyReadyNotice: 'Local Instance active without external tunnel. Open the Room in your default browser.',
    checkUpdatesButton: 'Check for updates',
    checkingUpdates: 'Checking…',
    updateAvailableNotice: (version) => `Version v${version} is available. The release page was opened in your browser.`,
    upToDateNotice: (version) => `You are already on the latest version (v${version}).`,
    updateCheckFailedNotice: 'Unable to check the release manifest right now.',
  },
};

const ES: DesktopDictionary = {
  flavorTorTitle: 'PULSO Tor',
  flavorTorSubtitle: 'Instancia local cero rastro con servicio .onion integrado para Salas en Modo Tor.',
  flavorLocalTitle: 'PULSO Local / Túnel',
  flavorLocalSubtitle: 'Instancia local en Modo Normal con túnel inverso opt-in para Mensajes Efímeros y Videollamadas.',
  statusLabel: 'Estado de la Instancia',
  statusIdle: 'Lista para iniciar',
  statusStarting: 'Iniciando Instancia…',
  statusBootstrapping: 'Conectando a la red Tor…',
  statusTunnelStarting: 'Abriendo túnel inverso…',
  statusReady: 'Instancia activa',
  statusStalled: 'Conexión bloqueada o lenta',
  statusStopping: 'Cerrando y purgando rastro…',
  statusError: 'Error al iniciar la Instancia',
  trayMinimizedNotice: 'La Instancia sigue activa en la bandeja del sistema para mantener tu Sala abierta. Usa "Cerrar y purgar rastro" al terminar.',
  dismissNotice: 'Cerrar aviso',
  openRoomInBrowser: 'Abrir Sala en el navegador',
  stopAndPurge: 'Cerrar y purgar rastro',
  purgedConfirmation: 'Instancia cerrada y rastro temporal purgado del disco.',
  stoppedConfirmation: 'Instancia cerrada y memoria limpia.',
  localUrlLabel: 'Dirección local de la Sala',
  onionUrlLabel: 'Dirección .onion para el Invitado',
  publicOriginLabel: 'Enlace público por túnel (Cloudflare)',
  tor: {
    connectionGroupLabel: 'Modo de conexión Tor',
    modeDirectLabel: 'Conexión directa',
    modeDirectHint: 'Opción rápida predeterminada para redes sin censura.',
    modeSnowflakeLabel: 'Snowflake integrado',
    modeSnowflakeHint: 'Evasión automática de censura en 1 clic mediante lyrebird.',
    modeCustomLabel: 'Bridge personalizada',
    modeCustomHint: 'Pega líneas obfs4, snowflake, webtunnel o meek_lite.',
    customBridgesLabel: 'Líneas de bridge (solo en RAM)',
    customBridgesPlaceholder: 'obfs4 192.0.2.1:443 FINGERPRINT cert=... iat-mode=0',
    customBridgesHelpTitle: 'Cómo obtener bridges privadas:',
    customBridgesHelpBody: 'Visita bridges.torproject.org (BridgeDB), escribe a @GetBridgesBot en Telegram o envía correo a bridges@torproject.org.',
    customBridgesRamNotice: 'Cero persistencia entre sesiones: se mantienen solo en RAM y en directorio temporal purgado al cerrar.',
    customBridgesEmptyError: 'Pega al menos una línea de bridge antes de iniciar la Instancia.',
    startButton: 'Iniciar Instancia Tor',
    stallTitle: 'La red puede estar bloqueando Tor',
    stallBody: 'El arranque se detuvo antes de completar el circuito. Reinicia con Snowflake integrado o pega una bridge personalizada.',
    restartSnowflakeButton: 'Reiniciar con Snowflake (anti-censura)',
    pasteCustomBridgeButton: 'Pegar bridge personalizada',
    zeroClearnetNotice: 'Cero peticiones en clearnet: esta aplicación nunca busca actualizaciones en segundo plano.',
    torVersionLabel: (version) => `Tor ${version}`,
    manualUpdateInstruction: 'Para comprobar nuevas versiones de forma segura, abre manualmente la página de releases en Tor Browser:',
    manualUpdateMirrorUrl: 'https://github.com/pulso-app/pulso/releases',
    phases: {
      starting: 'Preparando daemon Tor aislado…',
      conn_pt: 'Conectando al puente anti-censura…',
      conn_done_pt: 'Puente anti-censura alcanzado…',
      handshake_pt: 'Negociando transporte camuflado…',
      bootstrap: 'Conectando a la red Tor…',
      hs_desc: 'Publicando dirección .onion…',
      ready: 'Dirección .onion publicada y lista para abrir la Sala.',
      error: 'Error al iniciar Tor.',
    },
    progressPercent: (percent) => `${Math.max(0, Math.min(100, Math.round(percent)))}%`,
  },
  local: {
    trustModelTitle: 'Modelo de confianza del túnel (opt-in)',
    trustModelBody: 'Al activar el túnel de Cloudflare, ese intermediario observa metadatos e IPs de red para enrutar tu Sala detrás de CGNAT. Tus Mensajes Efímeros siguen cifrados de extremo a extremo en el navegador.',
    startWithTunnelButton: 'Iniciar Instancia con Túnel',
    startLocalOnlyButton: 'Iniciar solo local',
    advancedOptionsToggle: 'Opciones avanzadas (TURN externo en RAM)',
    turnRamNotice: 'Las credenciales TURN permanecen solo en RAM y se envían por stdin al proceso local, sin guardarse en disco.',
    turnUrlsLabel: 'URLs TURN (separadas por coma)',
    turnUrlsPlaceholder: 'turn:turn.ejemplo.org:3478,turns:turn.ejemplo.org:5349',
    turnUsernameLabel: 'Usuario TURN (opcional)',
    turnCredentialLabel: 'Credencial TURN (opcional)',
    turnSecretLabel: 'Secreto compartido TURN_SECRET (opcional)',
    tunnelActiveBadge: 'Túnel Cloudflare activo',
    tunnelErrorNotice: (message) => `Túnel no disponible (${message}). La Instancia sigue accesible localmente en 127.0.0.1.`,
    localOnlyReadyNotice: 'Instancia local activa sin túnel externo. Abre la Sala en tu navegador predeterminado.',
    checkUpdatesButton: 'Buscar actualizaciones',
    checkingUpdates: 'Buscando…',
    updateAvailableNotice: (version) => `Nueva versión v${version} disponible. Se abrió la página de releases en tu navegador.`,
    upToDateNotice: (version) => `Ya tienes la última versión (v${version}).`,
    updateCheckFailedNotice: 'No se pudo consultar el manifiesto de releases en este momento.',
  },
};

const ZH_CN: DesktopDictionary = {
  flavorTorTitle: 'PULSO Tor',
  flavorTorSubtitle: '零痕迹本地实例，内置 .onion 服务，用于 Tor 模式房间。',
  flavorLocalTitle: 'PULSO 本地 / 隧道',
  flavorLocalSubtitle: '标准模式本地实例，支持可选反向隧道，用于阅后即焚消息和视频通话。',
  statusLabel: '实例状态',
  statusIdle: '准备就绪',
  statusStarting: '正在启动实例…',
  statusBootstrapping: '正在连接 Tor 网络…',
  statusTunnelStarting: '正在打开反向隧道…',
  statusReady: '实例运行中',
  statusStalled: '连接受阻或缓慢',
  statusStopping: '正在关闭并清除痕迹…',
  statusError: '启动实例失败',
  trayMinimizedNotice: '实例仍在系统托盘中运行以保持房间在线。完成后请使用“关闭并清除痕迹”。',
  dismissNotice: '关闭提示',
  openRoomInBrowser: '在浏览器中打开房间',
  stopAndPurge: '关闭并清除痕迹',
  purgedConfirmation: '实例已关闭，磁盘临时痕迹已清除。',
  stoppedConfirmation: '实例已关闭，内存已清空。',
  localUrlLabel: '本地房间地址',
  onionUrlLabel: '供访客使用的 .onion 地址',
  publicOriginLabel: '隧道公开链接 (Cloudflare)',
  tor: {
    connectionGroupLabel: 'Tor 连接模式',
    modeDirectLabel: '直连模式',
    modeDirectHint: '适用于无封锁网络的快速默认连接。',
    modeSnowflakeLabel: '内置 Snowflake',
    modeSnowflakeHint: '通过 lyrebird 一键自动突破审查。',
    modeCustomLabel: '自定义网桥',
    modeCustomHint: '粘贴 obfs4、snowflake、webtunnel 或 meek_lite 网桥行。',
    customBridgesLabel: '网桥配置行（仅保存在内存中）',
    customBridgesPlaceholder: 'obfs4 192.0.2.1:443 FINGERPRINT cert=... iat-mode=0',
    customBridgesHelpTitle: '如何获取私有网桥：',
    customBridgesHelpBody: '访问 bridges.torproject.org (BridgeDB)，在 Telegram 联系 @GetBridgesBot，或发送邮件至 bridges@torproject.org。',
    customBridgesRamNotice: '会话间零持久化：仅保留在内存和退出时清除的临时目录中。',
    customBridgesEmptyError: '启动实例前请至少粘贴一行网桥配置。',
    startButton: '启动 Tor 实例',
    stallTitle: '当前网络可能正在封锁 Tor',
    stallBody: '引导过程在完成链路前停滞。请改用内置 Snowflake 重启或粘贴自定义网桥。',
    restartSnowflakeButton: '使用 Snowflake 重启（抗审查）',
    pasteCustomBridgeButton: '粘贴自定义网桥',
    zeroClearnetNotice: '零明网请求：此应用绝不会在后台检查更新。',
    torVersionLabel: (version) => `Tor ${version}`,
    manualUpdateInstruction: '如需安全检查新版本，请通过 Tor Browser 手动打开官方发布页面：',
    manualUpdateMirrorUrl: 'https://github.com/pulso-app/pulso/releases',
    phases: {
      starting: '正在准备隔离的 Tor 守护进程…',
      conn_pt: '正在连接抗审查网桥…',
      conn_done_pt: '已连接抗审查网桥…',
      handshake_pt: '正在协商可插拔传输层…',
      bootstrap: '正在连接 Tor 网络…',
      hs_desc: '正在发布 .onion 地址…',
      ready: '.onion 地址已发布，可立即打开房间。',
      error: 'Tor 引导失败。',
    },
    progressPercent: (percent) => `${Math.max(0, Math.min(100, Math.round(percent)))}%`,
  },
  local: {
    trustModelTitle: '隧道信任模型（可选开启）',
    trustModelBody: '启用 Cloudflare 隧道后，该网络中继可看到网络元数据和 IP 地址以穿越 CGNAT。您的阅后即焚消息在浏览器中仍保持端到端加密。',
    startWithTunnelButton: '启动实例并开启隧道',
    startLocalOnlyButton: '仅本地启动',
    advancedOptionsToggle: '高级选项（仅内存中的外部 TURN）',
    turnRamNotice: 'TURN 凭据仅保留在内存中并通过 stdin 传递给本地进程，绝不写入磁盘。',
    turnUrlsLabel: 'TURN URL（逗号分隔）',
    turnUrlsPlaceholder: 'turn:turn.example.org:3478,turns:turn.example.org:5349',
    turnUsernameLabel: 'TURN 用户名（可选）',
    turnCredentialLabel: 'TURN 凭据（可选）',
    turnSecretLabel: 'TURN_SECRET 共享密钥（可选）',
    tunnelActiveBadge: 'Cloudflare 隧道运行中',
    tunnelErrorNotice: (message) => `隧道不可用（${message}）。实例仍可在本地 127.0.0.1 访问。`,
    localOnlyReadyNotice: '本地实例已启动（未开启外部隧道）。请在默认浏览器中打开房间。',
    checkUpdatesButton: '检查更新',
    checkingUpdates: '正在检查…',
    updateAvailableNotice: (version) => `发现新版本 v${version}。已在浏览器中打开发布页面。`,
    upToDateNotice: (version) => `当前已是最新版本 (v${version})。`,
    updateCheckFailedNotice: '暂时无法获取发布清单。',
  },
};

const DESKTOP_DICTIONARIES: Record<Locale, DesktopDictionary> = {
  'pt-br': PT_BR,
  en: EN,
  es: ES,
  'zh-CN': ZH_CN,
};

export function getDesktopDictionary(locale: Locale): DesktopDictionary {
  return DESKTOP_DICTIONARIES[locale] ?? DESKTOP_DICTIONARIES['pt-br'];
}
