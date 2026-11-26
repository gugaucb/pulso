# Pesquisa de primitivas E2EE no navegador e mitigações contra captura de tela

Type: research
Status: resolved

## Question

Investigar com fontes primárias (W3C Web Crypto API, MDN, IETF/RFCs, `@noble/curves`, Electron/Tauri docs): (a) melhores primitivas E2EE no cliente para uma **Sala** 1:1 sem cadastro (ECDH P-256 vs. X25519 + HKDF-SHA256 + AES-256-GCM / ChaCha20-Poly1305), como evitar MITM de um servidor não confiável usando o **Código da Sala** ou segredo fora de banda (fragmento `#key` na URL / SAS de verificação) e compatibilidade com Tor Browser; (b) técnicas concretas de mitigação anti-printscreen no navegador (Visibility API, `blur`, `@media print`, `user-select`, watermark dinâmica) vs. proteção de SO em wrappers desktop, incluindo limitações reais documentadas.

## Answer

- **E2EE no cliente:** `Web Crypto API` oferece `ECDH P-256` + `HKDF-SHA256` + `AES-256-GCM` nativamente em todos os navegadores (incluindo Tor Browser 14.x sobre Firefox ESR 128, onde `X25519` nativo ainda não existe, e sem depender de WebAssembly). Alternativamente, `X25519` + `ChaCha20-Poly1305` exigem `@noble/curves` + `@noble/ciphers` + `@noble/hashes` em JS puro (sem WASM), pois `ChaCha20-Poly1305` ainda não é nativo na `SubtleCrypto` padrão dos browsers.
- **Nonces e Anti-Replay:** Utilizar IV de 96 bits determinístico conforme NIST SP 800-38D Seção 8.2.1 (32 bits de direção/remetente + 64 bits de contador monotônico) com AAD e verificação estrita de contador crescente no receptor.
- **Anti-MITM sem contas/PKI:** Separar o **Código da Sala** (roteamento no servidor) de um segredo de 256 bits no fragmento `#key` da URL (que nunca é enviado ao servidor HTTP segundo RFC 3986 §3.5 e RFC 9110) e combinar com derivação de **SAS** visual (RFC 6189) para confirmação mútua entre os dois **Participantes**.
- **Tor Browser:** `.onion` é tratado como *Secure Context* (`SubtleCrypto` funciona no nível **Standard**), mas o nível **Safer** bloqueia JS em `.onion` servidos por `http://` (não-HTTPS) e o nível **Safest** desativa JS, JIT e WebAssembly globalmente.
- **Anti-printscreen:** No navegador, `visibilitychange`, `window.blur`, `@media print`, `user-select: none`, bloqueio de `contextmenu` e watermark dinâmica funcionam apenas como mitigação dissuasiva/comportamental — o browser não consegue interceptar nem bloquear atalhos de captura do SO (`PrintScreen`, `Cmd+Shift+3/4`, `Win+Shift+S`). Em wrappers desktop, Electron (`setContentProtection`) e Tauri v2 (`set_content_protected`) funcionam via `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` no Windows 10 2004+/11, dependem no macOS de `NSWindow.SharingType.none` (já marcado pela Apple como constante legada ignorada em capturas modernas com ScreenCaptureKit), e **não têm suporte no Linux (X11/Wayland)**.

Relatório completo: [02-criptografia-e2ee-e-anti-screenshot.md](../research/02-criptografia-e2ee-e-anti-screenshot.md).
