# Definir protocolo de criptografia E2EE e mitigações anti-printscreen

Type: grilling
Status: resolved
Blocked by: 02, 04, 06

## Question

Com base na [Pesquisa de primitivas E2EE no navegador e mitigações contra captura de tela](./02-pesquisa-criptografia-e2ee-e-anti-screenshot.md), em [Definir ciclo de vida da Sala, Contador de Inatividade e garantias de zero-rastro](./04-ciclo-de-vida-da-sala-inatividade-e-privacidade.md) e em [Escolher stack full-stack e modelo de distribuição para Modo Normal e Modo Tor](./06-escolha-da-stack-e-arquitetura-de-distribuicao.md), fechar o protocolo de troca de chaves, derivação, cifragem/decifragem cliente-a-cliente, verificação contra MITM, limpeza de chaves em RAM e o pacote exato de mitigações anti-printscreen + aviso transparente ao usuário.

## Answer

Decisões consolidadas na especificação da Fase 2 ([spec.md](../../pulso-backend/spec.md)):

- **Protocolo E2EE nativo (`Web Crypto API`):** manter o protocolo implementado na Fase 1 com `ECDH P-256` efêmero (`extractable: false`, sem WebAssembly, compatível com Tor Browser 14.x e 15.x), derivação `HKDF-SHA256` combinando o segredo ECDH com o segredo de 256 bits `#k` presente apenas no fragmento da URL, e cifragem autenticada `AES-256-GCM` com chaves direcionais separadas, nonce/IV determinístico de 96 bits (`dirId + seq`), AAD, verificação estrita anti-replay monotônica e código visual **SAS** para confirmação mútua contra MITM.
- **Minimização de metadados no relay:** remover `senderName` em texto claro do envelope cifrado trafegado pelo WebSocket; o servidor repassa apenas o envelope opaco `{ version, roomCode, senderId, senderRole, seq, iv, ciphertext, sentAt }`.
- **Volatilidade de chaves:** referências de chaves criptográficas residem exclusivamente em RAM durante a sessão ativa e são descartadas imediatamente ao sair ou expirar a **Sala**.
- **Mitigações anti-printscreen:** manter o pacote dissuasivo web da Fase 1 (`visibilitychange`/`blur`, `@media print`, `user-select: none`, bloqueio de `contextmenu`, marca d'água dinâmica e aviso transparente explicando que navegadores não impedem capturas nativas do sistema operacional ou câmera externa). Proteção nativa de janela do SO fica fora da Fase 2 por conta da escolha de launcher local com navegador padrão no ticket 06.
