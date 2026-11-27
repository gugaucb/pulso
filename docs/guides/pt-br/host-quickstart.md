# Guia Rápido do Anfitrião — PULSO Tor e PULSO Local / Túnel

[Português (BR)](./host-quickstart.md) · [English](../en/host-quickstart.md) · [Español](../es/host-quickstart.md) · [简体中文](../zh-CN/host-quickstart.md)

Este guia explica, em linguagem simples e sem precisar abrir terminal, como o **Anfitrião** instala, abre e encerra com segurança o **PULSO Tor** (**Modo Tor**) ou o **PULSO Local / Túnel** (**Modo Normal**).

> [!TIP]
> Antes de abrir qualquer arquivo baixado, recomenda-se conferir a integridade no [Guia de verificação criptográfica e uso offline](./verification-offline-bridges.md).

---

## 1. Qual versão desktop baixar?

Os arquivos oficiais seguem o padrão `pulso-tor-vX.Y.Z-<sistema>.<extensão>` e `pulso-local-vX.Y.Z-<sistema>.<extensão>` na página oficial de releases (ou nos espelhos alternativos para o **PULSO Tor**):

- **PULSO Tor** (**Modo Tor**): ideal se você precisa publicar uma **Sala** em endereço `.onion` sem expor seu IP e sem deixar rastro no computador. Suporta apenas **Mensagens Efêmeras** em texto (sem **Chamada de Vídeo**) e exige que o **Convidado** acesse pelo **Tor Browser**.
- **PULSO Local / Túnel** (**Modo Normal**): ideal quando você está atrás de roteador doméstico ou CGNAT e quer abrir uma **Sala** acessível em qualquer navegador comum, com **Mensagens Efêmeras** e **Chamada de Vídeo** opcional.

| Sistema operacional | Arquivo para baixar |
| :--- | :--- |
| **macOS** (Apple Silicon `arm64` ou Intel `x64`) | `.dmg` |
| **Windows** (`x64`) | Instalador `.exe` ou pacote portátil `.zip` (sem instalação) |
| **Linux** (`x64` ou `arm64`) | `.AppImage` (portátil) ou `.deb` (Ubuntu/Debian) |

---

## 2. Como abrir na v1 em 3 passos (sem certificado pago)

Na versão v1, os aplicativos ainda não usam certificados comerciais pagos da Apple ou da Microsoft. Por isso, na **primeira abertura**, o sistema operacional exibe um aviso padrão de segurança. Veja como liberar em 3 passos simples, sem terminal:

### macOS Sequoia (Gatekeeper)

Os arquivos `.dmg` do PULSO já vêm pré-assinados localmente (`ad-hoc`) para funcionar normalmente no Apple Silicon e no Intel. Na primeira vez:

1. Abra o arquivo `.dmg`, arraste o ícone do PULSO para a pasta **Aplicativos** (ou abra diretamente de um pendrive) e clique duas vezes nele. Quando aparecer o aviso de desenvolvedor não identificado, clique em **OK** (ou **Concluído**).
2. Abra os **Ajustes do Sistema** (ícone da maçã no canto superior esquerdo) e entre em **Privacidade e Segurança**.
3. Role até a seção **Segurança**, clique em **Abrir Mesmo Assim** ao lado do aviso sobre o PULSO e confirme com sua biometria ou código de desbloqueio do Mac. Da segunda vez em diante, o aplicativo abre direto.

### Windows (SmartScreen)

Você pode usar o instalador `.exe` ou extrair o pacote portátil `.zip` em qualquer pasta ou pendrive e abrir `pulso-desktop.exe`:

1. Clique duas vezes no arquivo baixado. Se surgir a tela azul *"O Windows protegeu o computador"* (**Microsoft Defender SmartScreen**), não feche a janela.
2. Clique no link discreto **Mais informações** logo abaixo do texto de aviso.
3. Clique no botão **Executar assim mesmo** que aparece na parte inferior.

### Linux (`.AppImage` ou `.deb`)

- **Com `.AppImage` (sem instalação):** clique com o botão direito no arquivo `.AppImage` no gerenciador de arquivos > **Propriedades** > **Permissões** > marque **Permitir a execução do arquivo como programa** (ou equivalente no seu gerenciador gráfico), feche e dê um clique duplo para abrir.
- **Com `.deb` (Ubuntu / Debian / Mint):** dê um clique duplo no arquivo `.deb` para abrir a central de programas do sistema e clique em **Instalar**.

---

## 3. Usando o PULSO Tor (Modo Tor)

1. Abra o **PULSO Tor**. Antes de iniciar a **Instância**, escolha o modo de conexão:
   - **Conexão direta:** opção rápida para redes sem bloqueio.
   - **Snowflake embutido:** contorno automático em 1 clique para redes com censura (usa `lyrebird` integrado).
   - **Bridge personalizada:** cole linhas obtidas pelos meios oficiais descritos no [Guia de bridges e uso offline](./verification-offline-bridges.md). As bridges ficam apenas na memória RAM e em pasta temporária apagada ao fechar.
2. Clique em **Iniciar Instância Tor** e acompanhe o progresso legível na janela (sem exposição de IPs).
   - Se a rede bloquear a conexão direta e o progresso travar, aparece um aviso claro com o botão de 1 clique **Reiniciar com Snowflake (anti-censura)** ou **Colar bridge personalizada**.
3. Assim que o endereço `.onion` estiver pronto, o navegador padrão abre sua **Sala** em `127.0.0.1` automaticamente (ou clique em **Abrir Sala no navegador**).
4. Crie a **Sala** e envie o **Código da Sala** e o endereço `.onion` para o **Convidado** abrir no **Tor Browser**. Todas as **Mensagens Efêmeras** desaparecem quando a **Sala** é fechada ou quando o **Contador de Inatividade** chega a zero.

---

## 4. Usando o PULSO Local / Túnel (Modo Normal)

1. Abra o **PULSO Local / Túnel**. O painel explica o modelo de confiança do túnel antes de qualquer conexão externa ser aberta:
   - O túnel reverso é **opt-in**: nada é exposto na internet até você clicar em **Iniciar Instância com Túnel**.
   - Se preferir usar apenas na mesma rede local (Wi-Fi/LAN), clique em **Iniciar apenas local**.
2. Ao ativar o túnel Cloudflare, a **Instância** gera um endereço `https://...trycloudflare.com` sem exigir cadastro nem abertura de portas no roteador, e abre a **Sala** no seu navegador padrão.
3. **Transparência para os Participantes:** tanto o **Anfitrião** quanto o **Convidado** veem um selo claro dentro da **Sala** informando que o intermediário Cloudflare observa metadados de rede e endereços IP para encaminhar a conexão, enquanto as **Mensagens Efêmeras** continuam cifradas de ponta a ponta no navegador (a chave permanece no trecho `#` do link, nunca enviada ao servidor).
4. **Chamada de Vídeo *best-effort*:** funciona automaticamente quando a rede permite conexão direta (STUN). Caso o roteador ou firewall corporativo bloqueie o vídeo direto, o texto das **Mensagens Efêmeras** continua ativo sem interrupção; se necessário, você pode informar um servidor TURN externo em **Opções avançadas (TURN externo em RAM)** no painel antes de iniciar (os dados ficam apenas na memória RAM).

---

## 5. Bandeja do sistema e "Encerrar e purgar rastro"

- **Fechar a janela não derruba sua Sala:** enquanto a **Instância** estiver ativa, clicar no botão de fechar apenas minimiza o painel para a **bandeja do sistema** (barra superior no macOS, área de notificação no Windows/Linux) para evitar encerramentos acidentais.
- **Como encerrar e limpar tudo:** abra o menu do ícone do PULSO na bandeja ou clique no botão **Encerrar e purgar rastro** na janela do painel. Isso fecha todas as **Salas** ativas, finaliza o processo Tor ou o túnel e apaga imediatamente o diretório temporário de trabalho criado em `os.tmpdir()`.

---

## 6. Política zero *phone-home* (atualizações sem rastreamento)

Nenhuma distribuição desktop do PULSO verifica atualizações em segundo plano ao abrir ou durante o uso:

- **PULSO Local / Túnel:** possui o botão manual opcional **Verificar atualizações** no painel. Só ao clicar nele o aplicativo faz uma única consulta sob demanda e abre a página oficial de releases no navegador (nada é baixado nem instalado automaticamente).
- **PULSO Tor:** faz **zero requisições na clearnet**. O painel mostra a versão atual do aplicativo e do Tor embutido com o link oficial para você conferir novas versões manualmente usando o **Tor Browser** (ou espelhos descritos no [guia de verificação e espelhos](./verification-offline-bridges.md)).
