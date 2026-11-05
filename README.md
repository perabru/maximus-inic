# Máximu’s no INIC

Site público com 49 artigos oficiais (8 de 2024 e 41 de 2025), galeria de 28 fotos e acesso à plataforma de grupos INIC 2027. O catálogo permite filtrar ano, nome e instituição; cards abrem os PDFs da Univap. O carrossel mostra uma foto por vez em resolução completa, com transição horizontal, setas laterais, gestos, pausa, miniaturas e ampliação. Preferência de movimento reduzido troca a animação por uma faixa de fotos.

Componentes adaptados das referências Uiverse fornecidas pelo usuário: artigos, convites, carregamento, tema e botões. O slideshow horizontal segue a referência funcional da Hashtag Treinamentos, com implementação própria. Créditos e licença em `THIRD_PARTY_NOTICES.md` e `uiverse-components.css`. A abertura usa a marca do banner enviado.

Pesquisas complementares e limites de cobertura ficam em `research/sources.json`. Pessoas com nomes semelhantes são exibidas com nome completo e instituição. Menções somente em bibliografias não entram no catálogo. Os anais de 2026 ainda não estavam acessíveis na consulta de 05/11/2026; pôsteres nas fotografias não são apresentados como PDFs publicados.

Página de divulgação da iniciação científica estudantil, com fotografias, biblioteca de artigos e acesso aos PDFs oficiais da Univap.

**Site:** https://perabru.github.io/maximus-inic/

## Conteúdo

- Logo PNG transparente e cabeçalho responsivo, com tema e Entrar no canto direito.
- Botões com Montserrat ExtraBold Italic (alias CSS Maximus Interface), hospedada localmente sob SIL OFL 1.1.

- Identidade visual da Escola Máximu’s: índigo `#3d4094` e laranja `#f38635`.
- 28 fotografias fornecidas para esta publicação, otimizadas em WebP, com miniaturas e textos alternativos.
- Carrossel com setas de navegação, teclado, gestos, pausa e ampliação; respeito à preferência de movimento reduzido.
- Biblioteca com pesquisa por tema, título, estudante, professor, instituição e ano.
- Instituição e relação com os professores identificadas em cada registro, incluindo eventuais divergências de cadastro.
- Links externos para os PDFs oficiais, sem copiar os artigos para este repositório.

## Fontes

Consulte [os dados de verificação](research/sources.json). A ausência de anais acessíveis de 2026 não significa ausência de apresentações ou pesquisas nessa edição. A página identifica essa limitação e encaminha ao portal oficial.

O arquivo `articles.json` contém o catálogo verificado; `photos.json` contém a galeria. As descrições são apresentações breves dos temas e não substituem os artigos.

## Publicação

Site estático sem dependências de build. No GitHub Pages, selecione **Deploy from a branch → main → /(root)**. O arquivo `.nojekyll` permite servir os arquivos sem processamento Jekyll.

Para testar localmente, sirva esta pasta em um servidor HTTP. A biblioteca e a galeria carregam seus dados por `fetch`, portanto abrir `index.html` diretamente em `file://` não é suficiente.

O código da página é separado dos direitos sobre as fotografias, a marca da escola e os artigos, que permanecem com seus respectivos titulares.


## Plataforma de acompanhamento (INIC 2027)

- `portal.html`: login/cadastro, grupos, convites, cronograma, mensagens, calendário e coordenação.
- `conformidade.html`: termo com preenchimento local e impressão; PDF em branco em `documentos/`.
- `instalar.html`: instruções Android e iOS.
- `manifest.webmanifest`, `pwa.js`, `sw.js`: instalação e cache público. Autenticação e dados privados exigem conexão e não entram no cache do service worker.
- `theme.js`: tema claro/escuro; guarda apenas a preferência de aparência no navegador.

### Autenticação e autorização

Projeto Firebase informado para este aplicativo. Email/Password e Google habilitados, com domínio GitHub Pages autorizado. Dados do app em `maximusInic`; o nó legado `items` foi mantido com suas permissões anteriores. Contas administrativas iniciais foram criadas diretamente no Auth e seus papéis foram atribuídos no banco. Nenhuma senha ou token está no código.

Novos alunos recebem somente acesso aos próprios grupos. Professores solicitam acesso de orientação no cadastro e aguardam aprovação da coordenação. Convites para alunos exigem confirmação do próprio endereço de e-mail; o login Google já fornece um e-mail verificado. O convite aparece dentro da plataforma: não há disparo automático de e-mail de convite.

No primeiro cadastro com Google, a pessoa escolhe **Estudante** ou **Professor(a)** e conclui seu perfil. A escolha de professor solicita a aprovação da coordenação; não concede permissões administrativas. Contas existentes mantêm seu perfil e papel. Professores aprovados enviam convites aos integrantes dos seus grupos e recebem convites para orientar outras equipes. O botão **Enviar convite +** também encaminha à criação de um grupo quando ainda não há uma equipe disponível.

As regras do servidor controlam os papéis, a entrada em grupos e o acesso aos dados. Ser coordenador na interface não depende de uma comparação de email no JavaScript. Os coordenadores veem todos os grupos e orientadores; cada orientador vê as equipes sob sua orientação. Consulte `service-contract.json` e `database.rules.json`.

### Cronograma e calendário

Ao criar um grupo, oito marcos de planejamento são gerados para o ano escolhido. Datas do INIC 2027 e valores do termo continuam sujeitos à confirmação oficial. Orientadores/coordenadores ajustam os prazos; o progresso ponderado e a situação de atraso são calculados a partir das entregas. A exportação ICS permite importar o calendário nos aplicativos de agenda. Mensagens e convites sincronizam em tempo real enquanto a plataforma está aberta e conectada.

O calendário destaca os nove feriados nacionais federais de 2027 e reúne as entregas e os eventos dos grupos acessíveis à conta. Orientadores e coordenação podem criar, editar e excluir eventos dos grupos que gerenciam. Alterar uma entrega atualiza sua data no calendário. A exportação ICS inclui feriados, eventos e entregas conforme o ano e o filtro escolhido. Fontes oficiais em `research/calendar-2027.md`.

### Contratos assinados

Em **Meu termo**, cada estudante envia um PDF, JPG ou PNG de até 3 MiB com todas as assinaturas. Um novo envio substitui o anterior. A coordenação consulta e baixa os arquivos em **Termos assinados**, com busca pelo nome do estudante ou arquivo. Professores e outros alunos não têm acesso. O serviço valida o formato do arquivo, mantém metadados separados dos bytes e baixa o conteúdo com autenticação, sem URL pública ou cache offline.

### Avisos no aplicativo instalado

O cliente Web Push, o service worker e o remetente agendado usam credenciais restritas guardadas nos secrets protegidos do GitHub Actions. A chave privada e a senha da conta técnica não são publicadas no código. A ativação administrativa exige `senderReady:true`, a variável `INIC_NOTIFICATIONS_READY:true` e os quatro secrets do remetente.

Em **Calendário → Ativar avisos**, cada aluno autoriza o recebimento neste aparelho. No iPhone/iPad, é necessário abrir o aplicativo adicionado à Tela de Início, com sistema compatível. Os avisos são genéricos, sem dados do aluno na tela bloqueada. O remetente verifica mudanças e prazos a cada 15 minutos; execuções do GitHub podem atrasar. O botão **Desativar avisos** cancela a inscrição do aparelho, e sair da conta também a desativa. Detalhes e configuração em `scripts/notifications/README.md`.

### Validação

225 cenários aprovados no Firebase Realtime Database Emulator, incluindo o serviço real, cadastro Google, arquivos de até 3 MiB, privacidade de contratos e notas, eventos, convites do professor, exclusão com retomada e escopo restrito do remetente. Também passaram 20 regressões de interface, sete testes de calendário e 29 testes de Web Push sem envios reais. Instruções reproduzíveis em `tests/README.md` e `scripts/notifications/README.md`. Dados privados e credenciais não entram no repositório.

### Grupos, integrantes e avaliações

A coordenação gerencia todos os grupos. O orientador gerencia apenas os grupos atribuídos a ele. Dentro do grupo, **Editar grupo** altera nome, tema, descrição e edição; em **Resumo → Pessoas do grupo** é possível editar o nome de um integrante naquele grupo, removê-lo ou avaliá-lo. A remoção preserva a conta global da pessoa e apaga sua avaliação individual naquele grupo. Um convite anterior à remoção não permite retornar; é necessário um novo convite.

A aba **Avaliações** reúne a nota coletiva e as notas individuais, de 0 a 10, com comentário opcional, autor e data. Cada aluno consulta a nota coletiva e a própria nota individual. Orientador e coordenação podem editar ou excluir essas avaliações.

**Excluir grupo** pede confirmação e remove integrantes, entregas, mensagens, convites, índices e avaliações do grupo. Se a conexão cair durante a exclusão, o grupo fica bloqueado e a opção **Concluir exclusão** permite terminar a limpeza. Perfis e outros grupos permanecem cadastrados.
