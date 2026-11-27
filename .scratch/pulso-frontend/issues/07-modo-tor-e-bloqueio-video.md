# 07: Modo Tor na interface e bloqueio estrito de áudio/vídeo

**What to build:** Disponibilizar a seleção explícita de **Modo Tor** na entrada da **Sala** e adaptar toda a interface interna para operação exclusiva de texto cifrado sobre endereço `.onion`, bloqueando rigorosamente qualquer acesso a câmera, microfone ou **Chamada de Vídeo**.

**Blocked by:** 02: Internacionalização (pt-br, en, es, zh-CN) e tema escuro nativo, 06: Fluxo completo de Chamada de Vídeo no Modo Normal (preview, layouts e fallback)

**Status:** resolved

- [x] Seletor de modo na tela de entrada permite escolher entre **Modo Normal** (web padrão com vídeo opcional) e **Modo Tor** (endereço `.onion`, somente texto cifrado), com rótulos traduzidos nos quatro idiomas.
- [x] Fluxo do **Modo Tor** na entrada adapta o compartilhamento para destacar endereço `.onion` + **Código da Sala** e exibe status claro de prontidão para o **Anfitrião** e o **Convidado**.
- [x] Dentro da **Sala** em **Modo Tor**, um selo visível identifica o modo ativo e o botão de **Chamada de Vídeo** permanece desabilitado com explicação clara de que áudio e vídeo são bloqueados para proteger o anonimato.
- [x] A camada de aplicação garante que `MediaPort` nunca seja invocada nem solicite permissões de mídia quando a **Sala** estiver em **Modo Tor**.
- [x] Aviso discreto e informativo orienta quem acessa via Tor Browser sobre a necessidade de JavaScript habilitado no domínio `.onion` caso esteja no nível de segurança *Safer* ou *Safest*.
- [x] Testes de integração verificam a criação e entrada em **Modo Tor**, a exibição do selo e aviso informativo, e asseguram que nenhuma função de `MediaPort` é chamada ao tentar interagir com o controle de vídeo bloqueado.

## Comments

- Resolved on integration branch `feat/pulso-frontend` (merged in `d9bf88b`, refined in `ba5fcb8`). Verified via `npx tsc --noEmit`, Vitest (`npm test`), `vite build`, and Playwright E2E (`npm run test:e2e`).
