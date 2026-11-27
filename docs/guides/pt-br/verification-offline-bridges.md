# Verificação Criptográfica, Uso Offline, Bridges e Espelhos `.onion`

[Português (BR)](./verification-offline-bridges.md) · [English](../en/verification-offline-bridges.md) · [Español](../es/verification-offline-bridges.md) · [简体中文](../zh-CN/verification-offline-bridges.md)

Este guia cobre a conferência matemática dos pacotes do PULSO, o uso 100% offline em pendrive do **PULSO Tor**, a obtenção de bridges privadas contra censura e como terceiros ou coletivos podem manter espelhos `.onion` confiáveis das releases.

---

## 1. Verificar integridade com `SHA256SUMS` e `SHA256SUMS.asc`

Toda release oficial publica os instaladores acompanhados de três artefatos de integridade:

- `SHA256SUMS`: lista com a impressão digital SHA-256 de cada arquivo da release (`pulso-tor-vX.Y.Z-...` e `pulso-local-vX.Y.Z-...`).
- `SHA256SUMS.asc`: assinatura PGP destacada gerada pela chave pública PGP de release do projeto.
- **GitHub Artifact Attestations** (proveniência SLSA vinculada ao repositório oficial).

> [!IMPORTANT]
> Baixe sempre o pacote desejado junto com `SHA256SUMS`, `SHA256SUMS.asc` e a chave pública PGP oficial de release do projeto antes de levar os arquivos para outra máquina ou pendrive.

### Passo A — Importar a chave pública PGP do projeto e validar `SHA256SUMS.asc`

No macOS (com GPG Suite / Homebrew `gnupg`), Linux (`gpg`) ou Windows (Gpg4win / Git for Windows):

```bash
# 1. Importe a chave pública PGP de release do projeto (arquivo .asc publicado no repositório/release)
gpg --import pulso-release-key.asc

# 2. Confira a assinatura da lista de hashes
gpg --verify SHA256SUMS.asc SHA256SUMS
```

A saída deve confirmar `Good signature` (assinatura válida) associada à chave pública de release do PULSO. Nunca prossiga se o `gpg --verify` acusar `BAD signature`.

### Passo B — Conferir o hash SHA-256 do pacote baixado

Execute o comando correspondente ao seu sistema na pasta onde estão os arquivos:

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
  *(Compare se os 64 caracteres hexadecimais retornados são idênticos aos da linha correspondente em `SHA256SUMS`.)*

### Passo C (opcional) — Conferir proveniência SLSA com GitHub CLI

Quando tiver o `gh` instalado e acesso à release oficial:

```bash
gh attestation verify ./pulso-tor-v0.1.0-linux-x64.AppImage --owner pulso-app
```

---

## 2. Uso 100% offline via pendrive (**PULSO Tor**)

Os pacotes do **PULSO Tor** são **100% autocontidos**: o executável Node.js SEA, o frontend, o daemon `tor` e o `lyrebird` já estão todos dentro do pacote. Nenhum componente é baixado durante a execução.

### Preparando o pendrive

1. Em uma máquina de preparação, baixe o pacote desejado junto com `SHA256SUMS` e `SHA256SUMS.asc`:
   - **Windows:** `pulso-tor-vX.Y.Z-windows-x64.zip` (versão portátil, não altera o registro do Windows).
   - **Linux:** `pulso-tor-vX.Y.Z-linux-x64.AppImage` (ou `linux-arm64.AppImage`).
   - **macOS:** `pulso-tor-vX.Y.Z-macos-arm64.dmg` ou `macos-x64.dmg`.
2. Execute a verificação PGP + SHA-256 da seção anterior **antes** de copiar para o pendrive (ou copie também `SHA256SUMS`, `SHA256SUMS.asc` e a chave pública `.asc` para verificar no computador de destino sem acesso à internet).
3. No Windows, extraia o `.zip` para uma pasta do pendrive (ex.: `E:\PULSO-Tor\`). No Linux, torne o `.AppImage` executável (clique direito > **Propriedades** > **Permissões**). No macOS, abra o `.dmg` diretamente a partir do pendrive e siga os 3 passos do [Guia do Anfitrião](./host-quickstart.md).

### Garantias no computador de destino

- O **PULSO Tor** cria seu diretório temporário isolado em `os.tmpdir()` (com permissões restritas) em vez de gravar pastas no pendrive ou no diretório do aplicativo.
- Ao clicar em **Encerrar e purgar rastro**, todas as **Salas**, chaves `.onion` em RAM e arquivos temporários são removidos do disco.
- A verificação de integridade com `gpg --verify` e `sha256sum` / `shasum` funciona **100% offline**, pois depende apenas da chave pública já importada e dos arquivos locais no pendrive.

---

## 3. Contorno de censura e obtenção de bridges privadas

Quando a rede do **Anfitrião** bloqueia conexões Tor diretas (DPI ou filtro de entrada):

### Opção 1 — **Snowflake** embutido (1 clique)

1. Na tela inicial do **PULSO Tor**, selecione **Snowflake embutido** antes de clicar em **Iniciar Instância Tor**.
2. Se você iniciou no modo direto e o progresso travou, clique em **Reiniciar com Snowflake (anti-censura)** no aviso exibido pelo painel.
3. O aplicativo aciona o binário unificado `lyrebird` sem gerar registros de diagnóstico em disco.

### Opção 2 — Obter e colar **bridges** privadas (`obfs4`, `webtunnel`, `snowflake`, `meek_lite`)

Se até o Snowflake estiver restrito na sua região, obtenha linhas `Bridge` privadas pelos meios oficiais do Tor Project:

1. **Site oficial (BridgeDB):** acesse `https://bridges.torproject.org` (ou via Tor Browser) e escolha `obfs4` ou `webtunnel`.
2. **Telegram:** envie `/bridges` para `@GetBridgesBot`.
3. **E-mail:** envie uma mensagem de e-mail para `bridges@torproject.org` a partir de um endereço Gmail ou Riseup com o texto `get transport obfs4` (ou `get transport webtunnel`) no corpo.

No painel do **PULSO Tor**:

1. Escolha **Bridge personalizada** (ou clique em **Colar bridge personalizada** se o arranque direto travar).
2. Cole as linhas recebidas (suporta `obfs4`, `snowflake`, `webtunnel` e `meek_lite`).
3. O controlador valida e sanitiza cada linha contra injeção, grava no `torrc` efêmero (`0600`) **antes** de iniciar o daemon e amplia o tempo limite de arranque para `180s`. Ao clicar em **Encerrar e purgar rastro**, nada permanece salvo para sessões futuras.

---

## 4. Espelhos alternativos e guia para espelho `.onion` comunitário

Para regiões onde o GitHub é bloqueado, as releases do **PULSO Tor** e suas assinaturas (`SHA256SUMS` e `SHA256SUMS.asc`) podem ser espelhadas no **Codeberg** ou **GitLab** usando `scripts/mirror-release.mjs` (executado automaticamente no fluxo de release quando os segredos correspondentes estão configurados).

### Como terceiros e coletivos podem hospedar um espelho `.onion`

Qualquer organização ou colaborador pode publicar um espelho `.onion` estático apenas para leitura dos pacotes do **PULSO Tor**. Como todo pacote é validado pelo **Anfitrião** via `SHA256SUMS.asc`, **um espelho nunca precisa de confiança cega**: um espelho comprometido não consegue falsificar a assinatura PGP do projeto.

1. **Baixe e valide os artefatos oficiais** de uma tag `vX.Y.Z`:
   - Todos os arquivos `pulso-tor-vX.Y.Z-*`
   - `SHA256SUMS` e `SHA256SUMS.asc`
   - O arquivo da chave pública PGP oficial do projeto
2. **Sirva a pasta em loopback** (`127.0.0.1:8080`) com um servidor HTTP estático mínimo sem gravação de registros de acesso (ex.: Caddy com `log { output discard }` ou Nginx com `access_log off;` e `autoindex on;`).
3. **Publique um Onion Service v3** apontando para essa porta local no `torrc` do servidor espelho:
   ```text
   HiddenServiceDir /var/lib/tor/pulso-mirror/
   HiddenServiceVersion 3
   HiddenServicePort 80 127.0.0.1:8080
   ```
4. **Leia o endereço `.onion` gerado** em `/var/lib/tor/pulso-mirror/hostname` e divulgue-o junto com a instrução obrigatória para que quem baixar execute `gpg --verify SHA256SUMS.asc SHA256SUMS` e `sha256sum -c` antes de abrir qualquer executável.
5. **Automação para espelhos Codeberg / GitLab:** se você mantém um espelho próprio em Forgejo/Codeberg ou GitLab, pode sincronizar uma pasta local verificada usando `node scripts/mirror-release.mjs --dir ./release-assets --version 0.1.0 --provider codeberg` (veja `node scripts/mirror-release.mjs --help`).
