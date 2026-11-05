# Testes das regras de acesso

Esta suíte usa somente o Firebase Realtime Database Emulator e o projeto fictício `demo-maximus-inic`. Não usa dados nem credenciais do projeto de produção.

Requisitos: Node.js compatível com a versão instalada da Firebase CLI e Java 21. Nesta pasta, execute `npm install`, depois `npm test`. O emulador baixa seu arquivo oficial na primeira execução.

Os cenários verificam: leituras por papel e grupo, proibição de autopromoção, diretório de orientadores, mensagens, tarefas, índices privados, convite por e-mail verificado, vínculo de orientador, consumo atômico do convite, cancelamento, replay e perda de permissão após remoção/troca de orientador. A permissão histórica do namespace `items` também é preservada.

O navegador usa os SDKs Firebase por CDN; estas dependências existem apenas para os testes. Não publique `node_modules/`.

Validação realizada em 05/11/2026: 58 cenários aprovados no Realtime Database Emulator 4.11.2 (Firebase CLI 15.35.0).
