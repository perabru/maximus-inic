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

A suíte `automatic-orientation.test.mjs` mantém seu caminho histórico e agora verifica a escolha de até três candidatos em todas as séries, por meio de `runAdvisorChoiceTests`. Nenhum estudante recebe orientador automaticamente; o primeiro aceite vincula o professor e cancela os demais pedidos. Grupos anteriormente atribuídos ao Bruno continuam preservados. A atribuição direta pelo estudante, candidatos inativos/não aprovados e convites sem proposta continuam recusados, e o termo permanece obrigatório.

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

### Regressões verificadas em 10/11/2026

Os 13 testes do editor incluem quatro novas regressões: retorno ao texto original durante um conflito, atualizações de outras seções e reconexão sem perda do rascunho, resolução explícita de versões, edição durante um salvamento pendente e respostas tardias após revogação do acesso. O conflito permanece pendente para os avisos de saída até ser resolvido. Callbacks tardios não podem reabrir o editor nem restaurar conteúdo privado depois de uma revogação.

## Editor formatado, convites e exclusão definitiva — 12/11/2026

`node --test article-editor.test.mjs article-richtext.test.mjs` cobre texto antigo, árvore formatada no campo `text`, salvamento e revisões, versões em conflito, colagem de conteúdo hostil, links e estilos permitidos, limite com custo da formatação, prévia, exportações Word/TXT, desfazer/refazer e remoção do conteúdo privado ao perder acesso. As regressões de composição de teclado, parágrafos formatados e posição do cursor em linhas vazias protegem o rascunho durante atualizações remotas e histórico local.

`node user-deletion-runtime.test.mjs` executa o serviço com banco em memória e identidades fictícias: correção dos nomes em todos os grupos, proteção da coordenação, ausência de efeito parcial com regras antigas, limpeza de documentos de todos os anos admitidos, convites por UID/e-mail, preservação dos colegas, índices órfãos, retomada e escritas concorrentes. Os 12 cenários passaram.

O teste abaixo roda o serviço e as regras reais no emulador local. Não acessa nem apaga dados de produção:

```sh
npx firebase emulators:exec --project demo-maximus-inic --only database "node user-deletion-security.mjs"
```

As 87 verificações incluem exclusão de estudante e professor, último integrante, grupo arquivado, documentos órfãos, convites históricos e pedidos de um orientador ainda ativo, bloqueio de notas e revogações tardias, recuperação após falha, proibição de recriar/restaurar o perfil eliminado, proteção dos coordenadores e privacidade das leituras de coleção. O marcador mínimo `inactiveUsers/{uid}=true` permanece; a suíte não testa remoção da conta no Firebase Authentication, pois essa operação não faz parte da API do navegador.

Nesta revisão, também passaram novamente as 851 verificações principais de segurança, as 43 do artigo e as 19 do serviço de propostas. Os 219 cenários de `portal-ui.test.cjs` incluem as escolhas aluno/orientador, busca por nome, resumo do convite, validação, envio único, nome editável e conclusão de exclusão interrompida. A validação da interface usa DOM e simulação de seleção; não representa um teste visual em celular nem a execução do Microsoft Word.

Publicar o cliente antes das novas regras não inicia exclusões incompletas: o estado inicial `deleting` é recusado integralmente pelas regras antigas. A ativação do recurso requer a publicação autorizada das regras no projeto Firebase.

Nesta revisão também passaram os 213 cenários da interface do portal e as 43 verificações de acesso e sincronização do artigo no emulador. As regras de produção não foram alteradas; esta atualização corrige o controlador do editor.


## Lista de pessoas com paginação e carregamento (12/11/2026)

A coordenação exibe no máximo 10 cadastros por página. Busca e filtros são aplicados à lista completa antes de selecionar a página; atualizações ao vivo preservam a página e ajustam seu limite após remoções. Os campos de busca e os controles de navegação permanecem montados durante essas atualizações. A paginação é da interface: a assinatura existente do Firebase continua fornecendo o diretório completo.

O estado `usersReady` só libera a lista após os quatro snapshots usados na classificação dos cadastros (`users`, `roles`, `inactiveUsers`, `userArchives`). `usersError` distingue falha de carregamento de uma lista vazia. Logout, bloqueio e perda de coordenação removem os dados da memória e da tela; callbacks de assinaturas antigas são ignorados.

Validação desta alteração: 227 cenários DOM/VM da interface, 13 testes focados do serviço (incluindo as 24 ordens de chegada das quatro fontes) e 5 testes do service worker aprovados. Os testes focados usam dados fictícios e não acessam o Firebase de produção.

```sh
npm run test:ui
node people-loading-runtime.test.mjs
node sw-push.test.mjs
```


## Escolha de orientadores em todas as séries — 12/11/2026

Estudantes do 1º, 2º e 3º ano usam o mesmo fluxo: proposta e termo obrigatórios para convidar até três orientadores aprovados; o grupo aguarda um aceite. A criação sem candidatos continua disponível para enviar convites depois. Não há dependência da disponibilidade de Bruno para criar grupos ou convidar outros professores. Os grupos e vínculos já existentes são mantidos.

Somente as condições de criação em `groups/$gid/.write` e `groups/$gid/.validate` mudaram no arquivo de regras. As validações de aceite, transições de orientação, privacidade, exclusão definitiva e o namespace legado `items` permanecem intactos. Uma tentativa de atribuir diretamente Bruno por um cliente antigo é recusada integralmente.

A correção de nomes em `saveProfile` e `updateUser` preserva a distinção entre coordenação e orientação: coordenadores que não estão no diretório de professores não são adicionados automaticamente; coordenadores já listados mantêm nome e vínculo atualizados. Aprovação explícita por `approveAdvisor` ou `setUserRole(uid, 'coordinator')` continua permitindo os dois papéis.

Verificações aprovadas nesta revisão:

- **887** cenários da suíte principal de regras e serviço.
- **51** verificações isoladas de escolha de orientador, incluindo as três séries, aceite/cancelamento, limites, termo/proposta, candidatos inativos e grupos legados.
- **16** cenários de gestão de pessoas em memória, incluindo as quatro novas regressões de coordenação com ou sem orientação.

```sh
npm test
npx firebase emulators:exec --project demo-maximus-inic --only database "node advisor-choice-security.mjs"
node user-deletion-runtime.test.mjs
```

As verificações usam exclusivamente dados fictícios e o emulador local. SHA-256 do arquivo de regras validado: `8281364e72243edfb8c1f644cfe24f54b1ff02a260c7f5672875171aaeac6830`.

Na interface, 229 cenários DOM/VM foram aprovados: seleção de até três orientadores em todos os anos, rascunhos com escolhas preservadas, mudança de série sem alterar candidatos e bloqueio após mudança de perfil. O filtro Professores inclui a coordenação somente quando também consta no diretório de orientação.

## Comunidade, convites por pessoa e um grupo por aluno — 12/11/2026

O diretório `peopleDirectory` contém somente UID, nome, série, papel, solicitação de papel, indicação de professor aprovado e identificador do grupo do aluno. A leitura exige uma conta autenticada e ativa. E-mails, termos, propostas, notas e a coleção privada de cadastros continuam com seus controles de acesso anteriores. Contas técnicas e perfis Google que ainda não concluíram a escolha de perfil não entram na comunidade.

Novos cadastros publicam a projeção ao concluir o perfil. Na sessão da coordenação, `syncPeopleDirectory` consulta os registros atuais, completa as projeções existentes e reconcilia apenas índices que não correspondem mais a integrantes. Esse processo não altera os textos, as propostas ou os integrantes dos grupos. A lista aguarda a sincronização e distingue falha de carregamento de uma lista vazia. Tentativas de aplicar um resultado antigo após mudança de cadastro, vínculo, papel ou sessão são recusadas pelas validações ou descartadas pelo controlador.

O identificador único `peopleDirectory/{uid}/groupId` é a reserva de participação do aluno. Novas associações precisam atualizar, na mesma operação, o grupo, o índice privado `userGroups` e essa reserva. Não é possível transferir a reserva enquanto a associação anterior continuar válida, apagar o índice para esconder uma participação ou reiniciar o cadastro Google para liberar a vaga. As regras também recusam duas criações ou dois aceites concorrentes; apenas uma operação pode prevalecer. Professores e coordenadores são isentos desse limite e continuam podendo orientar vários grupos. Arquivar um grupo preserva seus integrantes; a remoção do integrante ou a exclusão do grupo libera sua participação.

Convites da comunidade usam UID, sem divulgar o e-mail do destinatário. O índice `memberRequests` impede dois convites simultâneos pendentes para a mesma pessoa e grupo. Convites antigos por e-mail continuam respondíveis, sujeitos à mesma regra de participação única e ao termo obrigatório. A edição de nomes, aprovação de professores, bloqueio, restauração e exclusão atualiza ou remove a projeção pública. A exclusão também remove os novos índices de convite.

As expectativas antigas que criavam vários grupos para o mesmo aluno foram substituídas por alunos distintos nos testes. Os testes de criação direta agora incluem os índices e a reserva exigidos, enquanto as tentativas de omitir esses dados continuam sendo recusadas.

Validação desta alteração, exclusivamente com identidades fictícias:

- **889** verificações da suíte principal de regras e serviço.
- **44** verificações de comunidade e convites no emulador (`social-directory-security.mjs`), incluindo concorrência, perfis incompletos, contas técnicas, professores com vários grupos e operações de gestão.
- **12** tentativas adicionais de contornar os controles por operações diretas (`social-directory-adversarial.mjs`), incluindo rebaixamento de papel, convite antigo por e-mail, remoção incompleta de índices e cadastro Google.
- **87** verificações existentes de exclusão definitiva no emulador.
- **15** cenários controlados de assinaturas e carregamento, incluindo a espera pela sincronização da comunidade e a apresentação de erros.
- **16** cenários existentes de gestão de cadastros em memória.

```sh
npm test
npx firebase emulators:exec --project demo-maximus-inic --only database "node social-directory-security.mjs"
npx firebase emulators:exec --project demo-maximus-inic --only database "node social-directory-adversarial.mjs"
npx firebase emulators:exec --project demo-maximus-inic --only database "node user-deletion-security.mjs"
node people-loading-runtime.test.mjs
node user-deletion-runtime.test.mjs
```

SHA-256 das regras validadas: `64068dc99ee04a2e66f245085ff8abc2480201d14828c632b1f36a52c8b0d4c7`. Essas regras precisam ser publicadas antes do novo cliente. Os testes não consultam nem modificam o projeto Firebase de produção.

## Grupos da mesma série e comunidade visível — 12/11/2026

Os novos grupos usam `schoolYear` canônico (`1º ano`, `2º ano` ou `3º ano`), independente da edição numérica em `year`. A criação por aluno deriva a série do perfil autenticado. Professores e coordenação precisam escolher a série. Convites novos para alunos exigem UID cadastrado e série igual; aceites revalidam a série atual, incluindo convites históricos por e-mail. Professores continuam podendo orientar vários grupos de séries distintas.

`same-year-security.mjs` exercita o serviço real e as regras no emulador. `same-year-adversarial.mjs` usa operações diretas e corridas controladas para tentar contornar a restrição: criação forjada, aceite após troca de série, cadastro completo/onboarding, remoção do campo, troca de papel, remoção de índices, membros legados com valor falso e arquivamento parcial seguido de restauração. Bloquear o cadastro não permite apagar um índice mantendo a participação real. A exclusão e o arquivamento normais removem cada vínculo junto com a participação correspondente.

Grupos antigos sem série permanecem editáveis com os integrantes preservados, mas não admitem novos alunos antes da classificação segura. `school-year-migration.test.mjs` verifica a simulação, aplicação, repetição e recálculo transacional com alterações concorrentes; grupos mistos e dados inconsistentes permanecem intactos. Os testes da migração usam exclusivamente uma referência em memória e não invocam credenciais administrativas.

Na interface, a comunidade pode ser consultada antes do termo, mas ações acadêmicas continuam bloqueadas. Todos os alunos permanecem visíveis; o selo **Outra série** e a seleção desabilitada explicam a restrição. A suíte cobre mudança de série/perfil/grupo durante o formulário, campo adulterado no DOM, seleção obrigatória por professores/coordenação, convites legados em carregamento/falha, nova tentativa e respostas atrasadas após sair da conta.

```sh
npx firebase emulators:exec --project demo-maximus-inic --only database "node same-year-security.mjs"
npx firebase emulators:exec --project demo-maximus-inic --only database "node same-year-adversarial.mjs"
node portal-ui.test.cjs
node --test social-directory-ui.test.mjs school-year-migration.test.mjs sw-push.test.mjs
```

As fixtures de regressão usam alunos distintos da mesma série nos fluxos positivos. Séries diferentes, convites antigos e grupos legados são construídos explicitamente nos testes negativos, sem relaxar as regras para acomodar dados de teste.

Validação final desta versão: **33** verificações do serviço de série, **70** adversariais de série, **888** da suíte principal, **44** do diretório, **12** adversariais do diretório, **87** de exclusão, **43** do artigo e **16** de gestão em memória. Todas terminaram com código 0 sobre os mesmos arquivos antes/depois da execução. Na interface, passaram **265** cenários do portal e **38** da comunidade; a migração passou **20** testes em memória; calendário, indicadores e service worker passaram **41** testes, incluindo a remoção do cache antigo.

SHA-256 final de `database.rules.json`: `98a5251a5ca709ecebfec0fc826f6d7c37fbf9d55b486e36d8ae7288b6d95e64`. SHA-256 final de `firebase-service.js`: `4d3c6de0232b6819ca228013f1fdb6ea3661f178ee1b7b3cbdb88a0c993ace3c`. Os testes não acessaram o banco de produção nem enviaram convites reais.


## Convite de instalação no celular — 12/11/2026

A suíte `pwa-install.test.mjs` executa o cliente real com DOM/VM e capacidades controladas do navegador. Os **25 cenários** cobrem Android, iPhone, iPad com identificação desktop, eventos antes/depois do DOM, abertura somente por clique, consumo único do prompt, cliques concorrentes, aceite/recusa, modo instalado, ajuda de instalação, recuperação de falhas e acessibilidade. O adiamento de sete dias é conferido em navegação, outra aba e retorno pelo histórico, inclusive com storage indisponível ou leitura antiga seguida de escrita negada.

```sh
node --test pwa-install.test.mjs push-client.test.mjs sw-push.test.mjs
```

A validação desta atualização terminou com **41 testes aprovados**: 25 de instalação, 10 do cliente de avisos e 6 do service worker. O teste de ativação verifica a remoção do cache anterior e a preservação da versão `20261112-10` e de caches de outros sites. Os cenários não instalam aplicativos em aparelhos reais, não pedem permissão real de notificações e não acessam dados de produção.
