# Pesquisa: Primitivas E2EE no Navegador e Mitigações contra Captura de Tela

Relatório baseado exclusivamente em fontes primárias (especificações W3C/WICG, MDN Web Docs, IETF RFCs, NIST SP 800-38D, repositórios oficiais `@noble/*`, documentação oficial do Tor Browser, Electron, Tauri v2/`tao`, Apple AppKit e Microsoft Win32) para orientar a arquitetura de segurança do **PULSO**.

---

## Parte (a) — Primitivas E2EE no Cliente para uma Sala 1:1 sem Cadastro

### 1. Acordo de Chaves: ECDH P-256 (`Web Crypto API`) vs. X25519 (Nativo vs. `@noble/curves`)

| Critério | ECDH `P-256` (Web Crypto nativo) | `X25519` (Web Crypto Level 2 nativo) | `X25519` em JS puro (`@noble/curves`) |
| :--- | :--- | :--- | :--- |
| **Especificação** | [W3C Web Crypto API (`ECDH`)](https://w3c.github.io/webcrypto/) / [MDN `EcdhKeyDeriveParams`](https://developer.mozilla.org/en-US/docs/Web/API/EcdhKeyDeriveParams) | [W3C Web Crypto API (`X25519`)](https://w3c.github.io/webcrypto/) / [RFC 7748](https://datatracker.ietf.org/doc/html/rfc7748) | [RFC 7748](https://datatracker.ietf.org/doc/html/rfc7748) / [`paulmillr/noble-curves`](https://github.com/paulmillr/noble-curves) |
| **Suporte em navegadores modernos** | Universal desde Chrome 4+, Edge 12+, Firefox 34+, Safari 11+ ([MDN `SubtleCrypto`](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto)) | Recente: Firefox 130+, Chrome 133+, Edge 133+, Safari 17.0+ ([MDN `EcdhKeyDeriveParams`](https://developer.mozilla.org/en-US/docs/Web/API/EcdhKeyDeriveParams)) | Universal em qualquer engine JS moderno (ES2020+), sem depender de suporte nativo do browser ([`paulmillr/noble-curves`](https://github.com/paulmillr/noble-curves)) |
| **Impacto no Tor Browser** | Suportado nativamente (Firefox ESR 128 e ESR 140) | Ausente no Tor Browser 14.x (baseado em Firefox ESR 128); disponível apenas a partir do Tor Browser 15 (Firefox ESR 140) ([Tor Project Blog](https://blog.torproject.org/)) | Funciona tanto no Tor Browser 14.x quanto no 15.x em JS puro, **sem WebAssembly** ([`paulmillr/noble-curves`](https://github.com/paulmillr/noble-curves)) |
| **Chaves não-extraíveis** | Sim (`extractable: false` em `CryptoKey` nativo) ([W3C Web Crypto](https://w3c.github.io/webcrypto/)) | Sim (`extractable: false` em `CryptoKey` nativo) ([W3C Web Crypto](https://w3c.github.io/webcrypto/)) | Não — material de chave reside na heap JS do runtime |
| **Dependências e auditoria** | Zero dependências (nativo do navegador) | Zero dependências (nativo do navegador) | Zero dependências externas, código auditado (Cure53 / Trail of Bits) ([`paulmillr/noble-curves`](https://github.com/paulmillr/noble-curves)) |

**Conclusão prática para acordo de chaves:**
- Se o objetivo for máxima compatibilidade nativa com zero bundle e chaves `CryptoKey` não-extraíveis (inclusive no Tor Browser 14.x / ESR 128), **`ECDH` com curva `P-256`** na `Web Crypto API` é suportado universalmente.
- Se a preferência arquitetural for **Curve25519 / X25519** (RFC 7748, imune a preocupações históricas com constantes NIST e amplamente adotada em Signal/WireGuard/TLS 1.3), **não se deve assumir suporte nativo universal de `X25519` na `Web Crypto API`** enquanto navegadores baseados em Firefox ESR 128 (Tor Browser 14.x) e Chrome < 133 ainda estiverem em uso. A abordagem recomendada é usar **`@noble/curves` (`x25519`)** como implementação consistente em JS puro (sem WASM), ou *feature detection* da Web Crypto API com fallback transparente para `@noble/curves`.

---

### 2. Derivação de Chaves: HKDF-SHA256 (`RFC 5869` / Web Crypto `HKDF`)

Tanto o segredo bruto de ECDH P-256 quanto o de X25519 **não têm entropia uniforme ao longo de todos os bits** e **não devem ser usados diretamente como chave simétrica** ([RFC 7748](https://datatracker.ietf.org/doc/html/rfc7748); [`paulmillr/noble-curves`](https://github.com/paulmillr/noble-curves)).

Conforme a [RFC 5869, Seção 2](https://datatracker.ietf.org/doc/html/rfc5869#section-2), o **HKDF** opera em duas etapas:
1. **Extract:** `PRK = HMAC-SHA256(salt, IKM)` — concentra a entropia do segredo compartilhado `IKM` em uma chave pseudoaleatória `PRK` de 256 bits (`HashLen = 32` octetos). Quando há um segredo fora-de-banda (ex.: `#key` da URL), ele pode compor o `IKM` junto ao segredo ECDH/X25519 (ou o `salt`).
2. **Expand:** `OKM = HKDF-Expand(PRK, info, L)` — deriva chaves independentes vinculadas ao contexto (`info`) para separação criptográfica de domínios (ex.: chave de cifragem `Anfitrião -> Convidado`, chave `Convidado -> Anfitrião`, e bytes para SAS de verificação).

- **Na Web Crypto API:** `HKDF` é nativo e amplamente suportado via `SubtleCrypto.deriveKey()` / `SubtleCrypto.deriveBits()` com `HkdfParams` (`name: "HKDF"`, `hash: "SHA-256"`, `salt`, `info`) ([MDN `HkdfParams`](https://developer.mozilla.org/en-US/docs/Web/API/HkdfParams); [MDN `SubtleCrypto.deriveKey()`](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey)).
- **Em JS puro:** `@noble/hashes` fornece `hkdf(sha256, ikm, salt, info, length)` em conformidade com a RFC 5869, sem dependências e sem WASM ([`paulmillr/noble-hashes`](https://github.com/paulmillr/noble-hashes)).

---

### 3. Cifra Autenticada (AEAD): `AES-256-GCM` vs. `ChaCha20-Poly1305`

| Critério | `AES-256-GCM` (`NIST SP 800-38D`) | `ChaCha20-Poly1305` (`RFC 8439`) |
| :--- | :--- | :--- |
| **Suporte nativo na Web Crypto API** | **Sim — universal** em todos os navegadores modernos via `SubtleCrypto` (`name: "AES-GCM"`, `length: 256`) ([MDN `AesGcmParams`](https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams); [MDN `SubtleCrypto.encrypt()`](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt)) | **Não** — ausente da `Web Crypto API` padrão dos navegadores atuais; está em incubação na proposta *Modern Algorithms* ([WICG `webcrypto-modern-algos`](https://wicg.github.io/webcrypto-modern-algos/); [MDN `SubtleCrypto`](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto)) |
| **Implementação requerida no cliente** | Nativa (acelerada por hardware via AES-NI/ARMv8 Crypto em C++/Rust do navegador) | Biblioteca JS pura obrigatória no navegador, ex.: `@noble/ciphers` (`chacha20poly1305` / `xchacha20poly1305`) ([`paulmillr/noble-ciphers`](https://github.com/paulmillr/noble-ciphers)) |
| **Tamanho de chave e tag** | Chave 256 bits, tag de autenticação padrão 128 bits ([MDN `AesGcmParams`](https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams)) | Chave 256 bits, tag Poly1305 de 128 bits ([RFC 8439](https://datatracker.ietf.org/doc/html/rfc8439)) |
| **Desempenho em Tor Browser `Safest` / sem JIT** | Nativo em C++ (não sofre penalidade de execução JS interpretada para cifrar/decifrar payloads ou anexos) | Roda em JS puro; adequado para mensagens de texto curtas, mas sensível à desativação de JIT em payloads grandes |
| **Tamanho do Nonce/IV** | 96 bits (12 bytes) recomendado ([NIST SP 800-38D](https://csrc.nist.gov/pubs/sp/800/38/d/final)) | 96 bits (12 bytes) na RFC 8439; variante `XChaCha20-Poly1305` usa 192 bits (24 bytes) ([RFC 8439](https://datatracker.ietf.org/doc/html/rfc8439); [`paulmillr/noble-ciphers`](https://github.com/paulmillr/noble-ciphers)) |

**Recomendação de cifra:**
- **`AES-256-GCM` via Web Crypto API** é a escolha mais sólida para o navegador por ser nativa, padronizada, acelerada por hardware e suportada inclusive quando o JIT está restrito.
- **`ChaCha20-Poly1305` via `@noble/ciphers`** é excelente alternativa caso todo o pipeline criptográfico precise ser 100% agnóstico a `SubtleCrypto` (por exemplo, para unificar cliente web e daemon/CLI, ou evitar dependência de contexto seguro em cenários não-HTTPS — embora o Tor Browser já trate `.onion` como *Secure Context*).

---

### 4. Gerenciamento de Nonces / IVs (96 bits único por mensagem, direção e anti-replay)

Tanto na especificação [NIST SP 800-38D, Seção 5.2.1.1 e Seção 8.2.1](https://csrc.nist.gov/pubs/sp/800/38/d/final) (para AES-GCM) quanto na [RFC 8439](https://datatracker.ietf.org/doc/html/rfc8439) (para ChaCha20-Poly1305), **a reutilização de um mesmo par `(chave, nonce/IV)` é catastrófica**, pois revela o XOR dos plaintexts e permite forjar tags de autenticação ([MDN `AesGcmParams`](https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams)).

Seguindo a **Construção Determinística da NIST SP 800-38D, Seção 8.2.1** ([NIST SP 800-38D](https://csrc.nist.gov/pubs/sp/800/38/d/final)):
- Usa-se um **IV de 96 bits (12 bytes)** dividido em:
  - **Campo Fixo (32 bits iniciais):** identificador da direção/remetente (ex.: `0x00000001` para mensagens do **Anfitrião** e `0x00000002` para mensagens do **Convidado**, ou chaves direcionais distintas derivadas via HKDF com `info` diferente). Isso elimina qualquer colisão mesmo que ambos os **Participantes** enviem mensagens simultaneamente com o mesmo número de sequência.
  - **Campo de Invocação (64 bits finais):** contador monotônico estrito (`uint64`, começando em `0` ou `1`, incrementado de `+1` a cada **Mensagem Efêmera** cifrada naquela direção).
- **Proteção contra Replay e Reordenação:** Como o protocolo é de **Sala** em RAM sem histórico persistido em disco, o receptor mantém `lastSeenCounter` (ou janela deslizante) por direção e **rejeita qualquer pacote com `counter <= lastSeenCounter`** (ou fora da janela permitida). Além disso, vincula-se o metadado de direção/contador/versão no campo `additionalData` (AAD) do AEAD ([MDN `AesGcmParams`](https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams)).

---

### 5. Prevenção de MITM contra Servidor/Relay não Confiável (sem Contas nem PKI)

Sem contas persistentes nem infraestrutura de chaves públicas (PKI/certificados por usuário), um servidor de sinalização/relay malicioso pode substituir as chaves públicas ECDH/X25519 em trânsito e realizar ataque Man-in-the-Middle (MITM). Os mecanismos aplicáveis são:

1. **Papel estritamente de endereçamento do `Código da Sala` (vs. baixa entropia):**
   - Um **Código da Sala** curto e legível (ex.: `X9K2-P7M4`, ~40 bits de entropia) identifica a **Sala** no servidor/relay para rotear a conexão, mas **não deve ser tratado isoladamente como segredo criptográfico forte contra ataques offline** se for conhecido pelo próprio servidor.
   - Se o **Código da Sala** (ou uma senha compartilhada fora-de-banda) for usado como segredo autenticado contra MITM ativo do relay, o protocolo adequado é um **PAKE como SPAKE2 ([RFC 9382](https://datatracker.ietf.org/doc/html/rfc9382))**, que permite a duas partes derivarem uma chave forte a partir de um segredo de baixa entropia sem revelá-lo ao servidor — porém exige que o **Código da Sala** tenha rate-limiting rigoroso ou nunca seja enviado ao servidor em claro (o que entra em conflito se o servidor precisar do mesmo **Código da Sala** para indexar a **Sala**!). Logo, deve-se **separar o ID de roteamento (`Código da Sala`) do segredo criptográfico**.

2. **Segredo fora-de-banda no fragmento `#key` da URL ([RFC 3986](https://datatracker.ietf.org/doc/html/rfc3986#section-3.5) e [RFC 9110](https://datatracker.ietf.org/doc/html/rfc9110)):**
   - Segundo a **[RFC 3986, Seção 3.5](https://datatracker.ietf.org/doc/html/rfc3986#section-3.5)**, o componente fragmento (tudo após `#`) destina-se exclusivamente ao processamento no agente de usuário (cliente) e **não é enviado nas requisições HTTP ao servidor**. Isso é reforçado pela **[RFC 9110, Seções 4.2.5 e 7.1](https://datatracker.ietf.org/doc/html/rfc9110)**, que exclui explicitamente o fragmento da URI-alvo das requisições HTTP/HTTPS.
   - Portanto, em um link compartilhado fora-de-banda (ex.: `https://pulso.app/s/X9K2-P7M4#k=<256-bit-base64url>`), o servidor vê apenas `/s/X9K2-P7M4` (o **Código da Sala**), enquanto `<256-bit>` permanece exclusivamente no cliente.
   - Combinando via **HKDF-SHA256** o segredo efêmero ECDH/X25519 com o segredo do `#key` (PSK), um relay que não possua `#key` **não consegue executar MITM bem-sucedido**, pois não deriva a mesma chave final (além de autenticar as chaves públicas trocadas via MAC/assinatura ou inclusão no HKDF).
   - *Limitação operacional:* se o **Convidado** digitar apenas o **Código da Sala** curto manualmente (sem o link completo com `#key`), o segredo fora-de-banda não estará presente; nesse fluxo, a defesa contra MITM depende da verificação **SAS** abaixo.

3. **Verificação por SAS (Short Authentication String) — padrão ZRTP ([RFC 6189](https://datatracker.ietf.org/doc/html/rfc6189)):**
   - Definida formalmente no protocolo ZRTP (**[RFC 6189](https://datatracker.ietf.org/doc/html/rfc6189)**), a **SAS** consiste em derivar via HKDF (a partir do segredo compartilhado da sessão e das chaves públicas ordenadas de **Anfitrião** e **Convidado**) um código visual curto e determinístico (ex.: 4–6 caracteres hexadecimais/dígitos ou sequência de emojis/palavras).
   - Os dois **Participantes** comparam a SAS fora-de-banda (ou visualmente durante a **Chamada de Vídeo**, ou por outro canal de confiança). Se um relay malicioso tiver interceptado o acordo de chaves, os segredos compartilhados nos dois extremos serão diferentes e as SAS **não coincidirão**, denunciando o MITM imediatamente.

**Combinação recomendada para o PULSO:**
- **Link de convite com `#key` (256 bits) + Código da Sala** como caminho principal (anti-MITM automático sem exposição ao servidor HTTP conforme RFC 3986/9110).
- **SAS visual exibida na Sala** (derivada do segredo de sessão via HKDF-SHA256) sempre disponível para confirmação mútua — indispensável quando o **Convidado** entra digitando apenas o **Código da Sala** sem fragmento `#key`, ou no **Modo Tor** quando compartilha apenas o endereço `.onion` + código.

---

### 6. Compatibilidade com Tor Browser (Security Levels: Standard, Safer, Safest)

A documentação oficial do Tor Browser ([Tor Browser Manual — Security Settings](https://tb-manual.torproject.org/security-settings/) e [Onion Services](https://tb-manual.torproject.org/onion-services/)) define três níveis com impacto direto em apps web E2EE:

| Nível do Tor Browser | JavaScript | WebAssembly (`wasm`) & JIT | `SubtleCrypto` (`crypto.subtle`) | Impacto no **Modo Tor** (`.onion` HTTP vs. HTTPS) |
| :--- | :--- | :--- | :--- | :--- |
| **Standard** (padrão) | Habilitado em todos os sites | Habilitados (JIT + `wasm` + `asm.js`) | Disponível em HTTPS, `localhost` e `.onion` (Tor Browser configura `.onion` como *potentially trustworthy origin* nos termos da [W3C Secure Contexts](https://w3c.github.io/webappsec-secure-contexts/)) | Funciona integralmente, inclusive sobre `http://<endereço>.onion`, pois o Tor criptografa fim-a-fim a camada `.onion` |
| **Safer** | **Desabilitado em sites HTTP (não-HTTPS)**; habilitado em HTTPS | Restritos/endurecidos (e `wasm` frequentemente bloqueado via NoScript) | Disponível onde o JS estiver permitido e o contexto for seguro | **Ponto crítico:** serviços `.onion` servidos apenas via **`http://`** são tratados como não-HTTPS no nível **Safer**, fazendo o Tor Browser **bloquear o JavaScript da página** por padrão, a menos que o usuário volte para *Standard* ou libere o domínio no NoScript ([Tor Browser Manual](https://tb-manual.torproject.org/security-settings/)) |
| **Safest** | **Desabilitado por padrão em todos os sites** | `javascript.options.wasm = false`, `asmjs = false`, `baselinejit = false`, `ion = false` | Inacessível enquanto JS estiver bloqueado pelo NoScript | **Qualquer SPA/cliente E2EE em JavaScript não executa** neste modo a menos que o usuário abra uma exceção explícita no NoScript para o site |

**Implicações arquiteturais para o PULSO:**
1. **Não depender de WebAssembly (`wasm`)** para a criptografia E2EE (ex.: evitar libsodium-wasm se não houver fallback), pois no nível **Safer/Safest** o `wasm` pode ser bloqueado. Tanto `SubtleCrypto` quanto `@noble/curves` + `@noble/ciphers` + `@noble/hashes` rodam **sem WebAssembly**.
2. **Atenção ao Tor Browser 14.x (Firefox ESR 128) vs. 15.x (Firefox ESR 140):** o `X25519` nativo da `Web Crypto API` só chegou no Firefox 130+, portanto não existe no Tor Browser 14.x (ESR 128) ([Tor Project Blog](https://blog.torproject.org/)). Usar `ECDH P-256` nativo ou `@noble/curves` (`x25519` em JS puro) garante funcionamento no Tor Browser 14.x e 15.x.
3. **Documentar na UX do Modo Tor:** informar ao usuário que o nível **Safest** desativa JavaScript globalmente e que, caso acesse o serviço `.onion` via `http://` no nível **Safer**, é necessário permitir scripts para aquela `.onion` ou usar o nível **Standard** (já que o tráfego `.onion` já possui cifragem fim-a-fim pelo protocolo Tor, cf. [Tor Manual — Onion Services](https://tb-manual.torproject.org/onion-services/)).

---

## Parte (b) — Técnicas de Mitigação contra Captura de Tela (Anti-Printscreen)

### 1. No Navegador Web: O que Funciona vs. O que NÃO Pode ser Bloqueado

Por arquitetura de segurança (sandbox do navegador), uma página web **não tem acesso nem controle sobre o compositor gráfico do sistema operacional, hardware de vídeo ou ferramentas de captura do SO**. Conforme [MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia), a própria API web de captura (`getDisplayMedia`) exige gesto explícito e permissão do usuário ao navegador, não dando à página controle sobre capturas feitas por fora.

| Técnica / API Web | O que faz na prática (Mitigação real) | O que NÃO bloqueia (Limitação documentada) | Fonte Primária |
| :--- | :--- | :--- | :--- |
| **`document.visibilityState` + evento `visibilitychange`** | Dispara quando a aba é ocultada, minimizada ou trocada pelo usuário (`"hidden"` / `"visible"`). Útil para aplicar *blur*/ocultar conteúdo sensível automaticamente quando a janela não está em primeiro plano. | Não dispara em capturas com a janela visível (ex.: app de gravação em segundo plano, *snipping tool* sem trocar de aba, segundo monitor). | [MDN `Page Visibility API`](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API) / [`Document.visibilityState`](https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilityState) |
| **Eventos `window` `blur` / `focus`** | Detecta perda de foco da janela do navegador (ex.: quando o usuário clica em outro aplicativo, como uma ferramenta de captura). Permite desfocar/cobrir as mensagens imediatamente ao perder foco. | Ferramentas que capturam por atalho global sem tirar foco da janela (ou gravação contínua de tela em background) não disparam `blur`; também gera falsos positivos ao interagir com outro monitor. | [MDN `Window: blur`](https://developer.mozilla.org/en-US/docs/Web/API/Window/blur_event) / [`Window: focus`](https://developer.mozilla.org/en-US/docs/Web/API/Window/focus_event) |
| **CSS `@media print`** | Oculta mensagens e interface sensível ao imprimir ou exportar página para PDF (`display: none` / mensagem substitutiva em `@media print`). | Afeta apenas impressão/exportação PDF nativa do navegador; não tem efeito nenhum em screenshots ou gravações de tela. | [MDN CSS `@media`](https://developer.mozilla.org/en-US/docs/Web/CSS/@media) |
| **CSS `user-select: none`** | Impede seleção casual e cópia rápida de texto pelo mouse/toque em elementos da interface. | Não impede visualização, captura de tela nem extração do texto diretamente via DevTools/DOM ou OCR da imagem. | [MDN `user-select`](https://developer.mozilla.org/en-US/docs/Web/CSS/user-select) |
| **Bloqueio de `contextmenu` (`e.preventDefault()`)** | Suprime o menu de contexto padrão (botão direito) para dificultar "Salvar imagem" / "Inspecionar" casual. | Não bloqueia atalhos de DevTools, extensões do navegador nem qualquer recurso do sistema operacional. | [MDN `contextmenu`](https://developer.mozilla.org/en-US/docs/Web/API/Element/contextmenu_event) |
| **Interceptação de teclas (`KeyboardEvent.key === "PrintScreen"`, `Cmd+Shift+3/4`, `Win+Shift+S`)** | Permite reagir caso o navegador entregue um evento de tecla `"PrintScreen"` (por exemplo, limpando temporariamente a tela ou registrando alerta visual), quando o evento chega ao DOM. | **Não pode impedir a captura do SO:** atalhos globais de screenshot do sistema (`Cmd+Shift+3`/`4` no macOS, `Win+Shift+S` no Windows, botões físicos no mobile) são interceptados pelo SO **antes** do navegador receber eventos de teclado; quando `"PrintScreen"` chega ao JS, frequentemente só ocorre no `keyup`, após o SO já ter copiado o framebuffer; `preventDefault()` não cancela a captura do SO. | [MDN `KeyboardEvent` Key Values](https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_key_values) |
| **Watermark dinâmica (SVG/Canvas/DOM overlay)** | Sobrepõe marca d'água semitransparente e não-interativa (`pointer-events: none`) contendo o **Código da Sala**, timestamp e identificador da sessão. | Não impede a captura de tela nem câmera externa; atua exclusivamente como **dissuasão e rastreabilidade forense** caso uma captura vaze. | Padrão CSS/DOM (`pointer-events: none`) |

---

### 2. Em Wrappers Desktop (Electron e Tauri v2): Proteção Nativa por Sistema Operacional

Quando empacotado localmente (ex.: wrapper desktop para o **Modo Tor**), é possível invocar APIs nativas de proteção de janela, com diferenças críticas documentadas entre plataformas:

#### APIs dos Wrappers
- **Electron:** `win.setContentProtection(true)` em `BrowserWindow` / `BaseWindow` ([Electron `BrowserWindow` Docs](https://www.electronjs.org/docs/latest/api/browser-window#winsetcontentprotectionenable)).
- **Tauri v2:** propriedade estática `contentProtected: true` na configuração de janela (`tauri.conf.json`), método Rust `window.set_content_protected(true)` ([`tauri::Window::set_content_protected`](https://docs.rs/tauri/latest/tauri/window/struct.Window.html)), ou método JS `getCurrentWindow().setContentProtected(true)` via `@tauri-apps/api/window` — exigindo explicitamente a permissão `"core:window:allow-set-content-protected"` nas *capabilities* do Tauri v2 ([Tauri v2 Window API](https://v2.tauri.app/reference/javascript/api/namespacewindow/)).

#### Comportamento Real Subjacente por SO

1. **Windows (`SetWindowDisplayAffinity`):**
   - Tanto Electron quanto Tauri v2 chamam a função Win32 [`SetWindowDisplayAffinity`](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity) sobre uma janela *top-level* pertencente ao próprio processo, exigindo composição ativa do **DWM (Desktop Window Manager)**.
   - **Windows 10 versão 2004+ e Windows 11:** usa `WDA_EXCLUDEFROMCAPTURE` (`0x00000011`), que **omite completamente a janela** de capturas de tela, gravações e compartilhamento de tela via APIs do Windows ([Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity); [Electron Docs](https://www.electronjs.org/docs/latest/api/browser-window#winsetcontentprotectionenable)).
   - **Versões anteriores do Windows:** recorre a `WDA_MONITOR` (`0x00000001`), fazendo a janela aparecer como um **retângulo preto sólido** nas capturas.
   - **Ressalvas documentadas:** a mudança só entra em vigor no **próximo ciclo de composição** do DWM (não é instantânea no retorno da chamada), e a própria Microsoft adverte que a API **não deve ser tratada como mecanismo de segurança inviolável ou DRM**, pois não impede fotografia física da tela nem capturas fora das APIs públicas do DWM ([Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity)).

2. **macOS (`NSWindow.sharingType` / `NSWindow.SharingType.none`):**
   - Electron (e bibliotecas desktop equivalentes baseadas em AppKit) define `NSWindow.sharingType = NSWindowSharingNone` (`NSWindow.SharingType.none`) ([Electron Docs](https://www.electronjs.org/docs/latest/api/browser-window#winsetcontentprotectionenable)).
   - **Limitação crítica na documentação oficial da Apple:** a Apple atualmente documenta `NSWindow.SharingType.none` como ***"A legacy constant that macOS no longer uses"*** ([Apple Developer Documentation — `NSWindow.SharingType.none`](https://developer.apple.com/documentation/appkit/nswindow/sharingtype/none); [`NSWindow.sharingType`](https://developer.apple.com/documentation/appkit/nswindow/sharingtype-swift.property)). Em versões modernas do macOS (especialmente macOS 15+ e ferramentas baseadas em **ScreenCaptureKit**), essa propriedade legada é ignorada pelo compositor/captura moderna, deixando de garantir exclusão confiável da janela contra capturas de tela.

3. **Linux (X11 e Wayland):**
   - **Sem suporte nativo:** Tanto o Electron (`win.setContentProtection`) quanto o backend `tao` utilizado pelo Tauri v2 documentam que a proteção de conteúdo é **não suportada no Linux** (`iOS / Android / Linux: Unsupported` na documentação de `tao::window::Window::set_content_protection`) ([`docs.rs/tao` Window](https://docs.rs/tao/latest/tao/window/struct.Window.html); [Electron Docs](https://www.electronjs.org/docs/latest/api/browser-window#winsetcontentprotectionenable)).
   - Nem o protocolo base do X11 nem os compositores Wayland/PipeWire padronizam uma flag universal de janela que impeça screenshots ou gravação de tela pelo compositor do usuário; portanto, chamadas de proteção de conteúdo são *no-op* no Linux.

4. **Limite físico universal:** Nenhuma proteção de software (navegador ou desktop) impede captura por câmera externa (fotografia/vídeo da tela) ou placas de captura HDMI externas.
