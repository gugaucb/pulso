# 03: Criptografia E2EE no cliente, link com #k e verificação visual SAS

**What to build:** Garantir que toda **Mensagem Efêmera** seja cifrada e decifrada exclusivamente no navegador dos **Participantes** via `Web Crypto API` antes de atravessar o `RoomTransport`, com proteção contra intermediários via segredo no fragmento `#k` da URL compartilhada e código visual de verificação mútua (SAS) dentro da **Sala**.

**Blocked by:** 01: Tracer bullet: Entrada, criação/acesso à Sala 1:1 e troca básica de Mensagens Efêmeras entre abas, 02: Internacionalização (pt-br, en, es, zh-CN) e tema escuro nativo

**Status:** resolved

- [x] Acordo de chaves efêmero no cliente com `ECDH P-256`, derivação via `HKDF-SHA256` e cifra autenticada `AES-256-GCM` usando `Web Crypto API` nativa (sem WebAssembly), garantindo compatibilidade ampla inclusive com Tor Browser.
- [x] Link compartilhado pelo **Anfitrião** inclui segredo aleatório de 256 bits apenas no fragmento `#k=...` da URL; quando presente, o segredo é combinado na derivação HKDF sem jamais ser trafegado pelo `RoomTransport`.
- [x] Separação criptográfica de chaves por direção (**Anfitrião → Convidado** e **Convidado → Anfitrião**) e uso de nonce/IV determinístico de 96 bits (32 bits de direção + 64 bits de contador monotônico) com AAD e rejeição estrita contra replay ou envelopes fora de ordem.
- [x] `RoomTransport` recebe e entrega apenas envelopes cifrados opacos, nunca texto em claro.
- [x] Indicador visual de proteção ponta a ponta na **Sala** abrindo modal com código **SAS** determinístico (derivado da sessão compartilhada) para conferência mútua entre os dois **Participantes**.
- [x] Chaves criptográficas residem exclusivamente em memória RAM da sessão ativa e são descartadas ao sair da **Sala**, com zero persistência em `localStorage`, `sessionStorage` ou `IndexedDB`.
- [x] Testes com `Web Crypto API` real comprovam troca cifrada entre **Anfitrião** e **Convidado**, SAS coincidente em sessão legítima (e divergente em chaves diferentes), rejeição de replay ou tag adulterada e ausência de escrita em storages.

## Comments

- Resolved on integration branch `feat/pulso-frontend` (merged in `5bde6b9`, refined in `ba5fcb8`). Verified via `npx tsc --noEmit`, Vitest (`npm test`), `vite build`, and Playwright E2E (`npm run test:e2e`).
