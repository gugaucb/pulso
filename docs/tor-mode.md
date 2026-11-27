# Modo Tor no PULSO

O **Modo Tor** permite que o **Anfitrião** publique uma **Sala** efêmera diretamente como um **Onion Service v3** (`.onion`), restrito exclusivamente a texto (**Mensagem Efêmera** cifrada ponta a ponta), sem exposição de endereço IP nem **Chamada de Vídeo**.

> [!TIP]
> Se você é um **Anfitrião** procurando abrir o aplicativo **PULSO Tor** em poucos cliques (sem terminal), consulte os guias multilíngues:
> - [Guia do Anfitrião (`pt-br`)](./guides/pt-br/host-quickstart.md) · [Verificação, pendrive offline, bridges e espelhos `.onion`](./guides/pt-br/verification-offline-bridges.md)
> - [Todos os idiomas (`pt-br`, `en`, `es`, `zh-CN`)](./guides/README.md)

## Como o controlador Tor funciona

O controlador `TorController` (`server/tor/torController.ts`) gerencia um daemon C-Tor local de forma isolada e zero-rastro:

1. **Purga preventiva no startup:** remove diretórios temporários residuais (`pulso-tor-*`) em `os.tmpdir()` que tenham permanecido de encerramentos abruptos anteriores.
2. **Diretório e configuração efêmera isolada:** cria um diretório único (`0700`) via `mkdtempSync` dentro de `os.tmpdir()` e grava um `torrc` temporário (`0600`) com `SocksPort 0`, `ControlPort auto`, `ControlPortWriteToFile`, `CookieAuthentication 1`, `CookieAuthFile` e `AvoidDiskWrites 1`.
3. **Autenticação `SAFECOOKIE`:** lê o cookie de 32 bytes e executa desafio-resposta HMAC-SHA256 (`AUTHCHALLENGE SAFECOOKIE` + `AUTHENTICATE`) no ControlPort TCP loopback.
4. **Chave `.onion` 100% em RAM:** envia `ADD_ONION NEW:ED25519-V3 Flags=DiscardPK Port=80,127.0.0.1:<porta_local>`, garantindo que a chave privada Ed25519 nunca seja persistida em disco.
5. **Prontidão real:** o endereço `http://<serviceId>.onion` só é marcado como `ready` após confirmar `STATUS_CLIENT ... BOOTSTRAP PROGRESS=100` **e** `HS_DESC UPLOADED`.
6. **Purga garantida no encerramento:** ao parar ou em qualquer falha de inicialização, envia `DEL_ONION` + `SIGNAL SHUTDOWN`, aguarda o término do processo Tor e remove recursivamente o diretório temporário criado em `os.tmpdir()` (incluindo `pt_state/`).

## Contorno de censura com `lyrebird` e bridges

Para redes com bloqueio ou inspeção profunda de pacotes (DPI), o **PULSO Tor** empacota o binário unificado `lyrebird` (série Tor Browser 16.0+) e oferece três modos pré-arranque:

1. **Conexão direta (`direct`):** padrão rápido para redes sem censura (`120s` de tempo limite).
2. **Snowflake embutido (`snowflake`):** contorno automático em 1 clique usando pontes Snowflake integradas.
3. **Bridge personalizada (`custom`):** aceita linhas `obfs4`, `snowflake`, `webtunnel` ou `meek_lite` mantidas somente em RAM e gravadas no `torrc` efêmero (`0600`).

Comportamento de segurança e diagnóstico:

- **Resolução direta de `lyrebird`:** `resolveLyrebirdBinary` localiza `pluggable_transports/lyrebird` (`lyrebird.exe` no Windows) de forma relativa ao binário `tor`, sem depender de `pt_config.json`.
- **Antes do `spawn`:** `UseBridges 1`, `ClientTransportPlugin` e linhas `Bridge` são gravados no `torrc` efêmero antes de iniciar o processo Tor (nunca via `SETCONF` pós-arranque).
- **Sanitização estrita:** todas as linhas coladas passam por validação anti-injeção para impedir quebras de linha ou diretivas arbitrárias no `torrc`.
- **Tempo limite e detecção de travamento:** o tempo limite sobe para `180s` quando bridges estão ativas; se o modo direto travar abaixo de 25% por `25s` (ou emitir `WARN BOOTSTRAP`), o aplicativo oferece reinício em 1 clique com **Snowflake**.
- **Zero rastros de diagnóstico:** `lyrebird` é invocado sem `-enableLogging` nem `-unsafeLogging`, e `redactSensitiveNetworkInfo` mascara IPs de bridges em avisos de erro.

## Resolução do binário `tor`

O controlador procura o executável do daemon Tor nesta ordem de precedência:

1. **`PULSO_TOR_BIN`**: caminho explícito para o binário `tor` (ou `tor.exe` no Windows) definido na execução.
2. **Diretório local do projeto (`.tor-bin`)**: `.tor-bin/tor` ou `.tor-bin/tor/tor` (`.tor-bin/tor.exe` / `.tor-bin/tor/tor.exe` no Windows), ou recursos empacotados do aplicativo desktop.
3. **`PATH` do sistema**: executável `tor` disponível no `PATH`.

## Obtendo e verificando o Tor Expert Bundle

O build do projeto **não** baixa binários automaticamente. Para baixar e verificar a integridade SHA-256 (e assinatura PGP do Tor Browser Developers, impressão digital `EF6E286DDA85EA2A4BA7DE684E2C6E8793298290`) do Tor Expert Bundle oficial (incluindo `linux-aarch64`) no diretório local `.tor-bin/`:

```bash
# Visualizar a URL oficial e o destino sem fazer download
node scripts/fetch-tor-bundle.mjs --dry-run

# Baixar, verificar SHA-256 (e PGP se gpg estiver disponível) contra sha256sums-signed-build.txt e extrair para .tor-bin/
node scripts/fetch-tor-bundle.mjs

# Em CI ou integrações onde a verificação PGP deve ser obrigatória:
node scripts/fetch-tor-bundle.mjs --require-pgp

# Verificar SHA-256 de um arquivo baixado manualmente
node scripts/fetch-tor-bundle.mjs --verify ./tor-expert-bundle.tar.gz --sha256 <digest-sha256>
```

> [!NOTE]
> No macOS (especialmente em máquinas com Apple Silicon `arm64`), o kernel exige que executáveis Mach-O possuam assinatura de código válida; binários sem assinatura sofrem terminação imediata com `SIGKILL` (código 137). O script `fetch-tor-bundle.mjs`, `package-desktop.mjs` e o `TorController` realizam a assinatura ad-hoc (`codesign -s - --force`) no `tor`, `lyrebird` e bibliotecas `.dylib` automaticamente quando necessário.

Como alternativa para execução local via terminal, instale o pacote `tor` do sistema operacional ou aponte `PULSO_TOR_BIN` diretamente para o binário desejado:

```bash
PULSO_TOR_BIN=/caminho/para/tor npm run start:tor
```
