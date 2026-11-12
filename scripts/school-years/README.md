# Classificar a série de grupos antigos

Os grupos novos recebem `schoolYear` na criação: `1º ano`, `2º ano` ou `3º ano`. O campo `year` continua sendo a edição do INIC. As regras tornam a série do grupo imutável e impedem convites e novas admissões em grupos antigos ainda sem essa classificação.

Este utilitário administrativo preenche **somente** `groups/{id}/schoolYear` em grupos antigos comprovadamente homogêneos. Ele não exclui, move nem renomeia pessoas; não altera textos, propostas, notas, contas, permissões ou convites. Alunos precisam ter uma única participação com índices e projeção pública consistentes. Abrir o portal da coordenação antes da simulação permite a reconciliação normal do diretório.

Grupos mistos, sem alunos, com série inválida, com vínculo ausente, com alunos em mais de um grupo ou com classificação já conflitante permanecem intactos e aparecem no relatório por ID e motivo. A correção desses casos exige análise da coordenação; o script não decide quem remover. Convites antigos do mesmo ano poderão ser aceitos depois da classificação do grupo, inclusive convites antigos enviados por e-mail.

## Cloud Shell

Use uma sessão administrativa autorizada no projeto. O SDK usa as credenciais padrão do ambiente; nenhuma senha ou chave é incluída neste repositório.

```sh
cd maximus-inic/scripts/school-years
npm install
node migrate.mjs --project fir-ionic-a5e90 --database-url https://fir-ionic-a5e90.firebaseio.com
```

A primeira execução é uma **simulação** e não grava dados. Confira `assignments` (grupos que podem receber a série), `skipped` (grupos preservados para revisão) e `alreadyClassified`.

Para aplicar, use a opção explícita:

```sh
node migrate.mjs --project fir-ionic-a5e90 --database-url https://fir-ionic-a5e90.firebaseio.com --apply
```

Na aplicação, a classificação é recalculada dentro de uma transação no ancestral `maximusInic`. Mudanças concorrentes em integrantes, perfis ou papéis fazem o Firebase repetir a verificação com dados atuais. O ancestral comum é necessário para essa garantia: a transação mantém o restante do conteúdo exatamente como estava, sem imprimi-lo ou salvá-lo em arquivos. O relatório não contém nomes, e-mails, documentos nem credenciais.

O script é idempotente: uma segunda aplicação não muda grupos já classificados. Ele não foi executado em produção como parte dos testes locais.

## Verificação local

```sh
npm test
```

Os testes usam dados sintéticos e uma referência de transação em memória. As regras e o serviço são exercitados separadamente pelo emulador em `tests/same-year-security.mjs` e `tests/same-year-adversarial.mjs`.

Referências oficiais: [instalação do Admin SDK](https://firebase.google.com/docs/admin/setup) e [transações no Realtime Database](https://firebase.google.com/docs/database/admin/save-data#saving_transactional_data).
