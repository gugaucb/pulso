# Modo Tor no PULSO

O **Modo Tor** permite que o **Anfitrião** publique uma **Sala** efêmera diretamente como um **Onion Service v3** (`.onion`), restrito exclusivamente a texto (**Mensagem Efêmera** cifrada ponta a ponta), sem exposição de endereço IP nem **Chamada de Vídeo**.

## Como o controlador Tor funciona

O controlador `TorController` (`server/tor/torController.ts`) gerencia um daemon C-Tor local de forma isolada e zero-rastro:

1. **Purga preventiva no startup:** remove qualquer diretório `./tor_data` residual de execuções anteriores antes de iniciar.
2. **Configuração efêmera isolada:** grava um `torrc` temporário em `./tor_data` com `SocksPort 0`, `ControlPort auto`, `ControlPortWriteToFile`, `CookieAuthentication 1`, `CookieAuthFile`, e `AvoidDiskWrites 1`.
3. **Autenticação `SAFECOOKIE`:** lê o cookie de 32 bytes e executa desafio-resposta HMAC-SHA256 (`AUTHCHALLENGE SAFECOOKIE` + `AUTHENTICATE`) no ControlPort TCP loopback.
4. **Chave `.onion` 100% em RAM:** envia `ADD_ONION NEW:ED25519-V3 Flags=DiscardPK Port=80,127.0.0.1:<porta_local>`, garantindo que a chave privada Ed25519 nunca seja persistida em disco.
5. **Prontidão real:** o endereço `http://<serviceId>.onion` só é marcado como `ready` após confirmar `STATUS_CLIENT ... BOOTSTRAP PROGRESS=100` **e** `HS_DESC UPLOADED`.
6. **Purga garantida no encerramento:** ao parar ou em qualquer falha de inicialização, envia `DEL_ONION` + `SIGNAL SHUTDOWN`, aguarda o término do processo Tor e remove `./tor_data` recursivamente.

## Resolução do binário `tor`

O controlador procura o executável do daemon Tor nesta ordem de precedência:

1. **`PULSO_TOR_BIN`**: caminho explícito para o binário `tor` (ou `tor.exe` no Windows) definido via variável de ambiente.
2. **Diretório local do projeto (`.tor-bin`)**: `.tor-bin/tor` ou `.tor-bin/tor/tor` (`.tor-bin/tor.exe` / `.tor-bin/tor/tor.exe` no Windows).
3. **`PATH` do sistema**: executável `tor` disponível no `PATH`.

## Obtendo e verificando o Tor Expert Bundle

O build do projeto **não** baixa binários automaticamente. Para baixar e verificar a integridade SHA-256 do Tor Expert Bundle oficial no diretório local `.tor-bin/`:

```bash
# Visualizar a URL oficial e o destino sem fazer download
node scripts/fetch-tor-bundle.mjs --dry-run

# Baixar, verificar SHA-256 contra sha256sums-signed-build.txt e extrair para .tor-bin/
node scripts/fetch-tor-bundle.mjs

# Verificar SHA-256 de um arquivo baixado manualmente
node scripts/fetch-tor-bundle.mjs --verify ./tor-expert-bundle.tar.gz --sha256 <digest-sha256>
```

Como alternativa, instale o pacote `tor` do sistema operacional ou aponte `PULSO_TOR_BIN` diretamente para o binário desejado:

```bash
PULSO_TOR_BIN=/caminho/para/tor npm run start
```
