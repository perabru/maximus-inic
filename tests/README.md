# Testes das regras de acesso

Esta suíte usa somente o Firebase Realtime Database Emulator e o projeto fictício `demo-maximus-inic`. Não usa dados nem credenciais do projeto de produção.

Requisitos: Node.js compatível com a versão instalada da Firebase CLI e Java 21. Nesta pasta, execute `npm install`, depois `npm test`. O emulador baixa seu arquivo oficial na primeira execução.

Os cenários verificam: leituras por papel e grupo, proibição de autopromoção, diretório de orientadores, mensagens, tarefas, índices privados, convite por e-mail verificado, vínculo de orientador, consumo atômico do convite, cancelamento, replay e perda de permissão após remoção/troca de orientador. A permissão histórica do namespace `items` também é preservada.

A suíte também executa o código real de `firebase-service.js` contra clientes autenticados do emulador. Verifica notas coletivas e individuais de 0 a 10, decimais, privacidade entre colegas, auditoria, remoção inclusive do último integrante, invalidação de convites antigos, novas admissões após convite posterior, congelamento da exclusão e limpeza atômica. Uma falha de conexão simulada após o bloqueio confirma que uma segunda chamada conclui a exclusão sem apagar perfis globais ou outros grupos.

O navegador usa os SDKs Firebase por CDN; estas dependências existem apenas para os testes. Não publique `node_modules/`.

Validação realizada em 06/11/2026: 851 cenários aprovados no Realtime Database Emulator 4.11.2 (Firebase CLI 15.35.0, Node.js 24.22.1 e Java 21).


Os casos novos cobrem Google por popup e retorno de redirecionamento, escolha obrigatória de perfil no primeiro acesso, preservação de contas existentes e ausência de autopromoção. Contratos são testados em PDF/JPEG/PNG, com limite exato de 3 MiB, validação da assinatura dos bytes, extensão segura no download, metadados separados do conteúdo e leitura exclusiva do proprietário/coordenação. Edição de registro sem timestamp, alterações parciais e acesso de colegas ou orientadores sem vínculo e aprovação são recusados.

Também há execução real de envio e aceite de convites pelo professor, eventos de calendário, congelamento e remoção dos eventos com o grupo. O worker de Web Push é validado com permissão apenas para ler seus seis namespaces (incluindo apenas confirmações de aceite, nunca recusas), gravar marcadores e remover inscrições expiradas; não pode criar perfil/grupo, promover papéis, ler notas/contratos ou registrar uma inscrição própria.

A configuração inicial do emulador usa `emulator-deny.rules.json`. `security.mjs` carrega as regras reais explicitamente antes de criar qualquer dado de teste. O runtime do serviço exige banco local na porta 9000 e projeto fictício `demo-maximus-inic`; não permite conexão com produção. Autenticação Google e gerenciamento de credenciais são simulados, enquanto todas as leituras e gravações de dados passam pelas regras do emulador. Em ambientes com proxies WebSocket/HTTP injetados, execute a suíte com o tráfego de localhost fora desses proxies.

A suíte `mandatory-term-proposal.test.mjs` acrescenta 100 verificações: termo obrigatório de 2027 em contas novas e existentes, bloqueio de professores ainda não aprovados, metadados/arquivo ausentes ou inconsistentes, envio otimista recusado pelo servidor, substituição aguardando confirmação e sessão antiga após logout. Propostas aceitam até três orientadores pendentes por meio de slots fixos no banco; convites recusados liberam reutilização sem apagar histórico. Corridas entre dois aceites e entre novo convite/aceite preservam um único orientador, cancelam os demais pedidos e criam apenas confirmação de aceite. A exclusão remove índices, slots e confirmações, preservando os termos privados.

A suíte `member-proposal.test.mjs` verifica os convites aos colegas no cadastro: normalização e deduplicação de e-mails, exclusão do próprio endereço, limite de 20 destinatários distintos, opção sem colegas, e-mail ainda não cadastrado e recebimento apenas pela conta verificada correspondente. A proposta, os oito marcos e os convites de estudantes/orientadores são atômicos; uma gravação recusada não deixa resíduos. A criação do professor para si com convites também é testada, junto com tentativas de forjar criador, orientador ou integrantes. Os convidados só entram após aceitar e cumprir o termo obrigatório.


A suíte `agreement-review.test.mjs` verifica a conferência humana do termo: somente coordenação confirma ou devolve com um motivo; aluno proprietário acompanha o parecer, mas não pode criá-lo, alterá-lo ou apagá-lo. Cada decisão é vinculada à versão e ao timestamp exatos do arquivo, com auditoria e comparação da revisão anterior para evitar que um clique antigo sobrescreva uma decisão nova. Reenvios deixam o parecer anterior inefetivo, inclusive arquivos legados. Os motivos aceitam parágrafos e rejeitam espaço/tabulação/quebra de linha sem conteúdo. Uma falha no canal de parecer não muda a exigência original de upload.

A suíte `agreement-signatures.test.mjs` verifica a assinatura eletrônica por conta autenticada, com consentimento explícito, nome/UID/papel, horário do servidor e SHA-256 do original. A coordenação pode assinar termos aceitos; o orientador só acessa termos aprovados de integrantes de seu grupo ativo atual. O mesmo coordenador pode também assinar como orientador somente no próprio grupo. Convite pendente, diretório de professores isolado, grupo alheio, associação removida ou papel não aprovado não concedem acesso. Desenho PNG é opcional; a declaração autenticada e o consentimento são obrigatórios.

As assinaturas são vinculadas à versão do upload e ao parecer aprovado. Reenvio, devolução ou nova aprovação invalidam os registros anteriores na visualização atual. Testes de concorrência cobrem o arquivo ser substituído por bytes iguais durante o cálculo do hash, alteração do parecer durante a assinatura e atualização ao vivo do professor após uma segunda aprovação sem mudar o grupo. O serviço revalida a versão e o parecer depois de ler e calcular o hash. Não são certificados ICP-Brasil ou Gov.br, não há URL pública de termo assinado e o worker de avisos não recebe acesso aos documentos ou assinaturas.


A suíte `user-management.test.mjs` cobre edição global de estudantes e professores pela coordenação, proteção dos coordenadores e exclusão recuperável do cadastro. A primeira gravação bloqueia imediatamente o UID autenticado e remove os dispositivos de avisos; uma interrupção deixa um estado retomável. A limpeza remove vínculos, índices, notas individuais e permissões, preservando os termos e as auditorias para a coordenação. Restaurar o cadastro não restaura grupos nem convites antigos. Convites antigos identificados somente por e-mail podem permanecer no histórico; o horário imutável de emissão e o corte de restauração impedem o aceite por API direta. Professores administram somente os grupos que orientam.

A suíte `orientation-transitions.test.mjs` verifica atribuição e substituição pela coordenação, saída somente pelo orientador atual, motivo da troca, comparação da versão e auditoria imutável. Uma operação concorrente não sobrescreve uma orientação mais recente. O professor anterior perde imediatamente os acessos ao grupo, enquanto os integrantes, conteúdos e notas dos alunos são preservados. Os avisos de substituição, atribuição e indisponibilidade pertencem somente aos respectivos destinatários e têm confirmação de leitura. O coordenador que também orienta mantém seu acesso global.

A suíte `automatic-orientation.test.mjs` verifica o vínculo direto com Bruno para estudantes do 1º e 2º anos, inclusive quando selecionam outro professor, mantendo os convites para colegas e o cronograma. O 3º ano continua aguardando o aceite dos candidatos. Tentativas diretas de contornar a regra, cadastro de Bruno ausente ou inativo não deixam grupos ou tarefas parciais. As outras suítes usam estudantes do 3º ano nos cenários de escolha livre.

As suítes `inic-results.test.mjs` e `inic-results-runtime.test.mjs` separam os resultados do INIC das notas escolares e das bancas cadastradas pela coordenação. Verificam identidade e horário de quem alterou, controle de versão, exclusão lógica das bancas, validação de datas, privacidade entre estudantes e bloqueio de alvos inativos. O serviço real também é testado nos formulários e nas atualizações ao vivo: estudante lê somente a própria declaração; orientador lê somente os integrantes atuais; perda do grupo, do vínculo ou do papel de coordenador limpa os dados em memória. Indicadores excluem bancas removidas, alunos inativos, grupos em exclusão e outras edições.

A suíte `proposal.test.mjs` verifica proposta por tópicos ou arquivo privado, consistência entre metadados e bytes, controle de versão, criação atômica com convite e acesso do candidato pendente. Recusa revoga o acesso à proposta e ao arquivo. Novos convites do estudante exigem proposta válida; convites legados já pendentes continuam podendo ser respondidos. Os testes anteriores de criação e convite usam propostas válidas quando esse é um pré-requisito do cenário.

## Registro da execução

| Componente | Cenários |
| --- | ---: |
| Regras e funcionalidades anteriores, incluindo termos e assinaturas | 532 |
| Cadastros, exclusão recuperável e gestão dos acessos | 151 |
| Transições de orientação e avisos | 57 |
| Orientação automática do 1º e 2º anos | 15 |
| Resultados e bancas pelas regras | 40 |
| Resultados, bancas e atualizações ao vivo pelo serviço real | 23 |
| Propostas e arquivos privados pelas regras | 33 |
| Total | 851 |

Nesta pasta, a execução pode ser registrada com:

```sh
npm test > security-test.log 2>&1
```

Após `npm install` (incluindo `linkedom`), as verificações de interface e as unidades podem ser executadas com:

```sh
npm run test:ui
node --test calendar.test.mjs coordination-dashboard.test.mjs tcc-proposal.test.mjs push-client.test.mjs push-sender.test.mjs sw-push.test.mjs signed-term-pdf.test.mjs
```

A última execução completa terminou com `SECURITY TESTS PASSED: 851` e código 0. Em máquinas com proxies injetados, remova apenas os proxies do processo de teste e configure `NO_PROXY=127.0.0.1,localhost`; o emulador deve continuar restrito ao projeto fictício e à porta local 9000.

Arquivos exatos validados, com SHA-256:

- `firebase-service.js`: `4f7be74ceecc41d60cd56470bcb19f6ebedc6acab0c62f64597f23daf698db4f`
- `database.rules.json`: `0f4f32a0910905f7ccff85bd5c82928be257f63eae45241211068efa8ff1e1ce`


Também foram aprovadas 19 verificações isoladas do serviço real de propostas, no mesmo código e nas mesmas regras acima, com código de saída 0. `proposal-runtime.test.mjs` cobre criação por tópicos e arquivo com convites, retenção dos bytes sem novo upload, edição com controle de versão, troca entre texto e arquivo, download autenticado, revogação após recusa e rejeição atômica sem resíduos. O ponto de entrada dessa execução é `proposal-runtime-only.mjs`:

```sh
npx firebase emulators:exec --project demo-maximus-inic --only database "node proposal-runtime-only.mjs" > proposal-runtime-test.log 2>&1
```

Saída esperada dessa verificação adicional: `PROPOSAL RUNTIME TESTS PASSED: 19`.

## Editor de artigos (09/11/2026)

`node --test article-editor.test.mjs` verifica explicações e links, debounce, confirmação do servidor, edições durante um envio, prévia com texto não confiável, conflitos, reconexão e limpeza ao perder acesso. Três cenários adicionais em `portal-ui.test.cjs` verificam a aba integrada, preservação do editor nas atualizações e navegação, alteração do orientador e encerramento da sessão.

`npx firebase emulators:exec --project demo-maximus-inic --only database "node article-security.mjs"` executa 43 verificações com o serviço real e regras reais: leitura compartilhada, isolamento de outros grupos, orientador atual, dados de autoria, limites, termos obrigatórios, corridas entre escritores, notificações ao vivo e exclusão do artigo junto do grupo. Essa execução é exclusiva do emulador local e não acessa dados de produção.
