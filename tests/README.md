# Testes das regras de acesso

Esta suíte usa somente o Firebase Realtime Database Emulator e o projeto fictício `demo-maximus-inic`. Não usa dados nem credenciais do projeto de produção.

Requisitos: Node.js compatível com a versão instalada da Firebase CLI e Java 21. Nesta pasta, execute `npm install`, depois `npm test`. O emulador baixa seu arquivo oficial na primeira execução.

Os cenários verificam: leituras por papel e grupo, proibição de autopromoção, diretório de orientadores, mensagens, tarefas, índices privados, convite por e-mail verificado, vínculo de orientador, consumo atômico do convite, cancelamento, replay e perda de permissão após remoção/troca de orientador. A permissão histórica do namespace `items` também é preservada.

A suíte também executa o código real de `firebase-service.js` contra clientes autenticados do emulador. Verifica notas coletivas e individuais de 0 a 10, decimais, privacidade entre colegas, auditoria, remoção inclusive do último integrante, invalidação de convites antigos, novas admissões após convite posterior, congelamento da exclusão e limpeza atômica. Uma falha de conexão simulada após o bloqueio confirma que uma segunda chamada conclui a exclusão sem apagar perfis globais ou outros grupos.

O navegador usa os SDKs Firebase por CDN; estas dependências existem apenas para os testes. Não publique `node_modules/`.

Validação realizada em 05/11/2026: 225 cenários aprovados no Realtime Database Emulator 4.11.2 (Firebase CLI 15.35.0).


Os casos novos cobrem Google por popup e retorno de redirecionamento, escolha obrigatória de perfil no primeiro acesso, preservação de contas existentes e ausência de autopromoção. Contratos são testados em PDF/JPEG/PNG, com limite exato de 3 MiB, validação da assinatura dos bytes, extensão segura no download, metadados separados do conteúdo e leitura exclusiva do proprietário/coordenação. Edição de registro sem timestamp, alterações parciais e acesso de orientadores/colegas são recusados.

Também há execução real de envio e aceite de convites pelo professor, eventos de calendário, congelamento e remoção dos eventos com o grupo. O worker de Web Push é validado com permissão apenas para ler seus cinco namespaces, gravar marcadores e remover inscrições expiradas; não pode criar perfil/grupo, promover papéis, ler notas/contratos ou registrar uma inscrição própria.

A configuração inicial do emulador usa `emulator-deny.rules.json`. `security.mjs` carrega as regras reais explicitamente antes de criar qualquer dado de teste. O runtime do serviço exige banco local na porta 9000 e projeto fictício `demo-maximus-inic`; não permite conexão com produção. Autenticação Google e gerenciamento de credenciais são simulados, enquanto todas as leituras e gravações de dados passam pelas regras do emulador. Em ambientes com proxies WebSocket/HTTP injetados, execute a suíte com o tráfego de localhost fora desses proxies.
