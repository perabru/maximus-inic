# Máximu’s no INIC

Site público com 49 artigos oficiais (8 de 2024 e 41 de 2025), galeria de 28 fotos e acesso à plataforma de grupos INIC 2027. O catálogo permite filtrar ano, nome e instituição; cards abrem os PDFs da Univap. O carrossel mostra uma foto por vez em resolução completa, com transição horizontal, setas laterais, gestos, pausa, miniaturas e ampliação. Preferência de movimento reduzido troca a animação por uma faixa de fotos.

Componentes adaptados das referências Uiverse fornecidas pelo usuário: artigos, convites, carregamento, tema e botões. O slideshow horizontal segue a referência funcional da Hashtag Treinamentos, com implementação própria. Créditos e licença em `THIRD_PARTY_NOTICES.md` e `uiverse-components.css`. A abertura usa a marca do banner enviado.

Pesquisas complementares e limites de cobertura ficam em `research/sources.json`. Pessoas com nomes semelhantes são exibidas com nome completo e instituição. Menções somente em bibliografias não entram no catálogo. Os anais de 2026 ainda não estavam acessíveis na consulta de 05/11/2026; pôsteres nas fotografias não são apresentados como PDFs publicados.

Página de divulgação da iniciação científica estudantil, com fotografias, biblioteca de artigos e acesso aos PDFs oficiais da Univap.

**Site:** https://perabru.github.io/maximus-inic/

## Conteúdo

- Logo PNG transparente e cabeçalho responsivo, com tema e Entrar no canto direito.
- Interface com fonte de sistema em estilo normal, textos maiores e controles sem itálico. Os arquivos Montserrat anteriores permanecem com a licença SIL OFL 1.1.

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
- `conformidade.html`: termo com preenchimento local, assinaturas desenhadas opcionais de aluno e pai/responsável e impressão/PDF; modelo em PDF em `documentos/`, com os responsáveis da escola identificados.
- `instalar.html`: instruções Android e iOS.
- `manifest.webmanifest`, `pwa.js`, `pwa-install.css`, `sw.js`: convite de instalação e cache público. Autenticação e dados privados exigem conexão e não entram no cache do service worker.
- `theme.js`: tema claro/escuro; guarda apenas a preferência de aparência no navegador.

### Autenticação e autorização

Projeto Firebase informado para este aplicativo. Email/Password e Google habilitados, com domínio GitHub Pages autorizado. Dados do app em `maximusInic`; o nó legado `items` foi mantido com suas permissões anteriores. Contas administrativas iniciais foram criadas diretamente no Auth e seus papéis foram atribuídos no banco. Nenhuma senha ou token está no código.

Alunos participam de apenas um grupo; professores aprovados podem orientar vários. A área **Pessoas** mostra os cadastros concluídos da comunidade, com nome, série, perfil e disponibilidade. Os convites novos selecionam o cadastro pelo nome e usam seu UID. Convites antigos por e-mail continuam exigindo a confirmação do endereço correspondente. O convite aparece dentro da plataforma; não há disparo automático de e-mail de convite. Professores solicitam acesso no cadastro e aguardam aprovação da coordenação.

No primeiro cadastro com Google, a pessoa escolhe **Estudante** ou **Professor(a)** e conclui seu perfil. A escolha de professor solicita a aprovação da coordenação; não concede permissões administrativas. Contas existentes mantêm seu perfil e papel. Professores aprovados enviam convites aos integrantes dos seus grupos e recebem convites para orientar outras equipes. O botão **Enviar convite +** também encaminha à criação de um grupo quando ainda não há uma equipe disponível.

**Enviar convite** apresenta duas escolhas: **Aluno ou colega**, com um campo de e-mail, e **Orientador(a)**, com busca pelo nome na lista de professores aprovados. Um resumo confirma a pessoa, o papel e o grupo antes do envio. Quando há apenas um grupo, seu nome já aparece selecionado. A confirmação oferece **Ver convites enviados** e explica que o destinatário recebe o convite dentro do Meu INIC.

Ao cadastrar uma **proposta de TCC**, o estudante pode selecionar até três orientadores aprovados. São permitidos no máximo três convites pendentes de orientação por grupo. Uma recusa libera espaço para convidar outro professor. O primeiro aceite confirma o orientador e encerra os demais convites pendentes; dois aceites simultâneos não substituem a orientação já confirmada. Proposta, cronograma e convites iniciais são gravados juntos. O formulário permite selecionar até 20 colegas cadastrados e disponíveis; cada colega entra somente após aceitar. A disponibilidade é atualizada ao vivo. O banco impede duas entradas simultâneas do mesmo aluno e mantém os professores disponíveis para outros grupos.

O aceite aparece no grupo e gera um aviso ao aluno proponente. A recusa não gera notificação para o aluno. Carregamento e confirmação acompanham as operações reais de cadastro, envio e resposta.

As regras do servidor controlam os papéis, a entrada em grupos e o acesso aos dados. Ser coordenador na interface não depende de uma comparação de email no JavaScript. Os coordenadores veem todos os grupos e orientadores; cada orientador vê as equipes sob sua orientação. Um coordenador também pode orientar suas próprias equipes: permanece com acesso à escola inteira e usa **Grupos que eu oriento** para filtrar suas orientações. Bruno mantém esse acesso de coordenação e orientação pelo papel e diretório cadastrados no banco, sem conceder privilégios por comparação de e-mail no cliente. Consulte `service-contract.json` e `database.rules.json`.

### Cronograma e calendário

Ao criar um grupo, oito marcos de planejamento são gerados para o ano escolhido. Datas do INIC 2027 e valores do termo continuam sujeitos à confirmação oficial. Orientadores/coordenadores ajustam os prazos; o progresso ponderado e a situação de atraso são calculados a partir das entregas. A exportação ICS permite importar o calendário nos aplicativos de agenda. Mensagens e convites sincronizam em tempo real enquanto a plataforma está aberta e conectada.

O calendário destaca os nove feriados nacionais federais de 2027 e reúne as entregas e os eventos dos grupos acessíveis à conta. Orientadores e coordenação podem criar, editar e excluir eventos dos grupos que gerenciam. Alterar uma entrega atualiza sua data no calendário. A exportação ICS inclui feriados, eventos e entregas conforme o ano e o filtro escolhido. Fontes oficiais em `research/calendar-2027.md`.

### Contratos assinados

O envio do termo assinado de 2027 é **obrigatório para todos os estudantes**, inclusive contas já cadastradas. Antes de usar os grupos, o aluno é direcionado a **Meu termo** para enviar um PDF, JPG ou PNG de até 3 MiB. Um termo válido já enviado continua atendendo à exigência. O acesso é liberado após a confirmação do servidor; falha, espera ou envio offline não liberam o uso. As regras também exigem o termo nas gravações acadêmicas. Professores pendentes aguardam aprovação e não conseguem usar essa escolha de perfil para pular a exigência.

A página destaca o download direto do PDF em branco, o preenchimento com assinaturas na tela e o envio do arquivo assinado. No formulário `conformidade.html`, aluno e pai/responsável escolhem individualmente entre assinar no papel e desenhar com mouse, dedo ou caneta. Cada desenho é recortado, ajustado proporcionalmente e posicionado automaticamente na linha correspondente do termo ao imprimir ou salvar como PDF. Os campos e desenhos permanecem apenas na memória da página, sem envio automático nem armazenamento; a limpeza individual remove apenas a assinatura escolhida e a limpeza geral reinicia todo o formulário. Depois, o estudante envia o arquivo final pelo fluxo de **Meu termo**. Os desenhos integram o documento enviado; não criam registros autenticados em nome de aluno ou responsável. Em **Montar meu grupo**, o aluno pode preparar a proposta, os colegas e os orientadores antes de enviar o termo. Esse rascunho fica apenas na memória da sessão e é apagado ao sair ou trocar de conta. Depois da confirmação do termo, o aluno revisa e clica em **Criar grupo e enviar convites**; a confirmação do termo não dispara convites sozinha.

Um novo envio substitui o arquivo anterior. Em **Termos assinados**, a coordenação acompanha **Pendentes** e **Enviados**, pesquisa estudantes e baixa os arquivos recebidos. Outros alunos não têm acesso. Orientadores acessam somente os termos aprovados dos integrantes dos grupos sob sua orientação. O serviço valida o formato e a integridade do arquivo; a conferência das assinaturas cabe à coordenação. A coordenação marca o arquivo como **Conferido** ou o **Devolve** com uma pendência obrigatória. O aluno consulta o resultado em um cartão no aplicativo. Cada parecer se refere à versão conferida: reenviar uma cópia volta a **Aguardando conferência**, sem reaproveitar um check anterior. Professores não podem consultar nem registrar pareceres de outros alunos. O envio válido continua liberando o trabalho acadêmico enquanto a coordenação confere o termo.

O modelo do termo identifica **Prof. Esp. Bruno Michel Pera** como **Professor da disciplina** e **Profa. Esp. Mariana Carmona** como **Professora / Coordenadora**. O campo do orientador do grupo continua separado. O nome do professor da disciplina é fixo no formulário, inclusive depois de limpar os campos. Os nomes impressos não registram uma assinatura; os espaços para assinatura são mantidos. O script `scripts/build-term-template.py` gera as duas páginas A4 do PDF a partir das cláusulas do HTML, preservando o alinhamento entre as versões.

### Assinaturas eletrônicas da equipe escolar

Depois do aceite do termo, o orientador e a coordenação podem assinar eletronicamente com a própria conta. Cada assinatura exige uma confirmação explícita e registra nome, papel, data e vínculo com o arquivo aprovado; o desenho é opcional. O orientador acessa somente os termos aceitos dos integrantes dos grupos que orienta. Um convite ainda não aceito não permite abrir o arquivo. A coordenação acompanha todas as assinaturas, e um coordenador que também orienta assina em cada papel separadamente.

O aplicativo disponibiliza o original e uma versão em PDF com os registros das assinaturas, a identificação da cópia aceita e seu resumo SHA-256. O PDF final inclui o original como anexo, preservado byte a byte. Os registros são assinaturas eletrônicas realizadas no aplicativo. Reenvio, devolução ou novo aceite tornam os registros anteriores inaplicáveis à nova conferência; os responsáveis precisam assinar novamente. Arquivos e pareceres permanecem privados, e o remetente de avisos não recebe acesso a eles.
 Metadados e bytes ficam separados, com download autenticado, sem URL pública ou cache offline.

### Convite de instalação no celular

Ao entrar pelo celular em uma página pública ou no portal, aparece um cartão de instalação, sem exigir login. No Android, o botão usa o convite nativo quando o navegador disponibiliza `beforeinstallprompt`; a confirmação só abre após o toque. Quando essa opção ainda não existe, o cartão mostra as etapas do menu do navegador. No iPhone/iPad, orienta a usar **Compartilhar → Adicionar à Tela de Início** e **Abrir como App**, quando essa opção aparece. Navegadores internos de redes sociais recebem instruções para abrir o site no navegador do aparelho.

**Agora não** e o botão de fechar adiam o convite por sete dias no mesmo navegador. O botão manual em **Como instalar no celular** continua disponível durante esse período. O cartão não aparece automaticamente no computador nem quando o site é aberto em modo de aplicativo instalado. A interface acompanha a conclusão da instalação, não muda o foco automaticamente e mantém espaço para a navegação inferior do portal. A preferência é local; se o navegador bloquear o armazenamento, o adiamento dura a página atual.

O aplicativo depende das opções oferecidas pelo navegador: ele não força a instalação e não consegue detectar universalmente uma instalação anterior ao ser aberto em uma aba comum. Referências de implementação: [gesto do usuário e prompt único](https://developer.mozilla.org/en-US/docs/Web/API/BeforeInstallPromptEvent/prompt) e [instruções para iPhone](https://support.apple.com/en-lamr/guide/iphone/iphea86e5236/ios).

### Avisos no aplicativo instalado

O cliente Web Push, o service worker e o remetente agendado usam credenciais restritas guardadas nos secrets protegidos do GitHub Actions. A chave privada e a senha da conta técnica não são publicadas no código. A ativação administrativa exige `senderReady:true`, a variável `INIC_NOTIFICATIONS_READY:true` e os quatro secrets do remetente.

Em **Calendário → Ativar avisos**, cada aluno autoriza o recebimento neste aparelho. No iPhone/iPad, é necessário abrir o aplicativo adicionado à Tela de Início, com sistema compatível. Os avisos são genéricos, sem dados do aluno na tela bloqueada. O remetente verifica mudanças e prazos a cada 15 minutos; execuções do GitHub podem atrasar. O botão **Desativar avisos** cancela a inscrição do aparelho, e sair da conta também a desativa. Detalhes e configuração em `scripts/notifications/README.md`.

O remetente também acompanha confirmações de orientação. Envia o aviso de aceite apenas ao aluno proponente que ainda pertence ao grupo, sem nome do orientador na tela bloqueada. Convites recusados não entram no remetente e não produzem aviso.

### Validação

O formulário de assinaturas desenhadas tem nove testes comportamentais com canvas raster real: recorte e transparência do PNG, escala de toque, independência das pessoas, alternância com papel, limpeza, cancelamento de ponteiro, nomes e preparação para impressão. Para reproduzir, instale as dependências de `tests/package.json` e execute `npm run test:signatures` na pasta `tests`. A paginação e o resultado visual de impressão exigem também uma conferência do documento renderizado.

851 cenários aprovados no Firebase Realtime Database Emulator, mais 19 testes adicionais das APIs de proposta, com o serviço real: privacidade, contratos, convites, gestão recuperável, conflitos de orientação, Bruno automático, resultados e propostas. Também passaram 210 regressões da interface, sete testes de calendário, 28 do dashboard, 13 do editor da proposta e 46 de Web Push/service worker sem envios reais. A geração do PDF e a preservação do original passaram em 18 testes. Onze verificações independentes conferiram a limpeza dos streams após perda de acesso e outros estados de sessão. Instruções reproduzíveis em `tests/README.md` e `scripts/notifications/README.md`. Dados privados e credenciais não entram no repositório.

### Grupos, integrantes e avaliações

A coordenação gerencia todos os grupos. O orientador gerencia apenas os grupos atribuídos a ele. Dentro do grupo, **Editar grupo** altera nome, tema, descrição e edição; em **Resumo → Pessoas do grupo** é possível editar o nome de um integrante naquele grupo, removê-lo ou avaliá-lo. A remoção preserva a conta global da pessoa e apaga sua avaliação individual naquele grupo. Um convite anterior à remoção não permite retornar; é necessário um novo convite.

A aba **Avaliações** reúne a nota coletiva e as notas individuais, de 0 a 10, com comentário opcional, autor e data. Cada aluno consulta a nota coletiva e a própria nota individual. Orientador e coordenação podem editar ou excluir essas avaliações.

**Excluir grupo** pede confirmação e remove integrantes, entregas, mensagens, convites, índices e avaliações do grupo. Se a conexão cair durante a exclusão, o grupo fica bloqueado e a opção **Concluir exclusão** permite terminar a limpeza. Perfis e outros grupos permanecem cadastrados.

### Cadastros de alunos e professores

A coordenação usa **Editar nome e cadastro** para corrigir nome, série e perfil de acesso. A correção do nome atualiza os nomes do aluno nos grupos em que participa; autoria e assinaturas históricas permanecem como foram registradas. Contas da coordenação ficam protegidas contra exclusão e rebaixamento. O e-mail de autenticação permanece inalterado.

**Excluir definitivamente** exige uma confirmação explícita. A primeira etapa bloqueia o acesso e registra o estado `deleting`; a segunda remove atomicamente perfil, permissões, documentos e assinaturas dos documentos próprios, pareceres, avaliações e resultados individuais, convites enviados/recebidos e seus índices, avisos e vínculos. Professores excluídos deixam de orientar os grupos, inclusive pesquisas arquivadas. Trabalhos compartilhados, colegas e autoria histórica são preservados. Em falha, o cadastro permanece visível e bloqueado com **Concluir exclusão**, permitindo retomar a limpeza. Cadastros arquivados pela versão anterior também podem ser excluídos definitivamente.

Não existe restauração depois da conclusão. A identidade no **Firebase Authentication** é separada dos dados da aplicação: removê-la exige um backend com Firebase Admin SDK. Esta versão mantém apenas `inactiveUsers/{uid}=true` como marcador do cadastro removido para impedir que a identidade de login recrie o perfil. O marcador não guarda nome nem e-mail; referências de autoria nos trabalhos compartilhados continuam preservadas.

**Ativação da exclusão definitiva:** exige publicar as novas regras de `database.rules.json` no Firebase. Com regras antigas, a primeira etapa é recusada integralmente, o cadastro permanece intacto e a interface informa que a operação ainda não está disponível. O editor formatado, a edição de nomes e o formulário de convites usam contratos já existentes.

### Chat do grupo de TCC

Cada equipe possui um **Chat do grupo**, disponível pela lista de grupos e pela aba interna. As mensagens são compartilhadas entre os integrantes, o orientador e a coordenação. Não existem canais individuais nem seletor de destinatário. As regras exigem acesso ao grupo em cada leitura e envio; contas excluídas não podem conversar.

### Atribuição, substituição e saída da orientação

Estudantes do **1º, 2º e 3º ano** escolhem até três professores aprovados para convidar. O grupo aguarda o primeiro aceite; não há atribuição automática de professor. A coordenação pode ajustar a orientação posteriormente. Os professores podem orientar vários grupos e cada aluno participa de apenas um. O serviço confirma o cadastro ativo e aprovado do professor antes de gravar a proposta, sem conceder permissões por comparação de e-mail.

Em **Todos os grupos**, a coordenação usa **Atribuir orientador** quando a equipe ainda não tem professor. A atribuição vincula diretamente um orientador aprovado e ativo, inclusive um coordenador cadastrado também no diretório de orientação. O grupo passa a aparecer para o professor e os integrantes sem exigir outro aceite.

Um grupo já orientado oferece **Substituir orientador** somente para a coordenação. Essa ação exige outro professor, um motivo e confirmação. O orientador atual pode usar **Sair da orientação**, com confirmação e motivo opcional. A saída deixa a equipe disponível para nova atribuição. Em ambos os casos, preservam-se os estudantes, as entregas, a conversa coletiva e o histórico; o professor anterior perde seu vínculo e o acesso decorrente dele. A conta da coordenação conserva o acesso geral da escola.

A confirmação de uma orientação encerra os outros convites pendentes. Os professores envolvidos recebem um card em **Convites → Avisos de orientação**, com a situação atual e a opção de marcar como lido. Esses avisos não criam conversas individuais. Versões verificadas pelo servidor impedem que um aceite atrasado, uma substituição antiga ou duas alterações simultâneas sobrescrevam a orientação atual.

### Resultados do INIC e indicadores da coordenação

No grupo, cada estudante informa o próprio resultado do INIC; o professor registra os resultados dos estudantes das equipes que orienta. A coordenação pode registrar todos. As opções são **Aguardando resultado**, **Aprovado**, **Reprovado** e **Correção pendente**. A correção exige uma descrição. O registro identifica a conta e o papel de quem informou, com data, e permanece separado das notas de 0 a 10 da disciplina. Não representa uma consulta ou validação automática nos sistemas oficiais do evento.

**Indicadores INIC** é uma área exclusiva da coordenação. A coordenação cadastra e atualiza as bancas, avaliadores, datas, situação e ajustes necessários. Seis gráficos mostram grupos por orientador, situação das bancas, resultados declarados por orientação, bancas por mês, progresso das entregas e correções/atrasos. Filtros por edição, orientador, grupo e resultado cruzam os registros reais. Alunos distintos e participações em grupos aparecem com contagens separadas; dados ausentes são apresentados como pendentes, sem criar resultados de exemplo.

### Proposta antes do convite de orientação

A proposta é enviada **somente como anexo**: PDF, JPG ou PNG de até 3 MiB. O formulário mantém apenas os dados de identificação do grupo e da pesquisa; os campos de redação da proposta foram removidos. O professor pode abrir o anexo no convite antes de aceitar ou recusar. Arquivos existentes podem ser mantidos sem novo upload. Propostas antigas em texto continuam disponíveis para leitura; sua substituição exige um anexo e só acontece ao salvar.

Os anexos da proposta têm armazenamento separado dos termos assinados. Um professor candidato acessa a proposta somente enquanto seu convite está pendente; recusa, cancelamento ou perda de vínculo encerram esse acesso. Os bytes não usam URL pública nem entram no cache offline. Convites antigos continuam identificados como anteriores à exigência, sem inventar uma proposta para eles.

### Artigo INIC compartilhado

Dentro de cada grupo, a aba **Artigo INIC** reúne título, autores e afiliações, resumo, palavras-chave, introdução, metodologia, resultados, discussão, conclusão e referências. As cinco seções principais incluem explicação, perguntas-guia, exemplo e links conferidos do curso **TCC Sem Drama 4.0** no Drive de Pobre. Resultados e discussão oferecem aulas de pesquisa de campo e revisão de literatura. A orientação escrita foi elaborada para este aplicativo; as aulas externas são materiais de apoio.

O texto é salvo automaticamente por seção, após uma breve pausa na digitação, e recebido em tempo real pelos integrantes, pelo orientador atual e pela coordenação. **Salvar agora** antecipa o envio. O indicador só confirma o salvamento depois da resposta do servidor. Alterações de outras seções não recriam o campo em edição. Se duas pessoas usam a mesma revisão de uma seção, o servidor aceita apenas uma; o outro autor compara a versão compartilhada com seu rascunho e escolhe qual usar ou revisa o próprio texto antes de salvar.

**Revisão de 10/11/2026:** os links dos cinco tópicos foram conferidos novamente no catálogo público do Drive de Pobre. O editor preserva a escolha local durante um conflito mesmo quando o autor volta ao texto original, chega uma atualização de outra seção ou a conexão é restabelecida. O aviso de alterações pendentes permanece até a resolução. Após a perda de acesso ao grupo, respostas atrasadas de salvamento e sincronização são ignoradas, mantendo o conteúdo privado fora da tela.

Cada seção possui uma barra de ferramentas com negrito, itálico, sublinhado, tachado, fonte, tamanho, alinhamento, subtítulos, listas, cores, marca-texto, subscrito/sobrescrito, links, desfazer/refazer e limpeza da formatação selecionada. Os atalhos Ctrl/Cmd+B, I, U, Z e Y também funcionam. A colagem converte somente elementos, estilos e endereços permitidos; scripts, eventos e CSS arbitrário são descartados.

**Ver artigo montado** reúne os campos na ordem do artigo e preserva a formatação. **Baixar para Word** exporta um documento HTML compatível com Word, com extensão `.doc`; **Baixar texto (.txt)** exporta o texto simples. Ambas as opções incluem o rascunho pendente da sessão. A prévia não substitui o modelo oficial da edição do INIC. Nenhuma submissão ao evento é feita pelo aplicativo.

O campo existente `articles/{grupo}/{seção}/text` continua recebendo texto simples quando não há formatação. Textos formatados usam o prefixo versionado `INIC-RICH/1\n` seguido de uma árvore JSON de elementos permitidos. O editor cria os elementos com `createElement` e `textContent`, sem executar HTML recebido do banco. Textos antigos, inclusive trechos parecidos com HTML, continuam literais. Os limites existentes incluem o armazenamento da formatação; ultrapassá-los mostra um aviso e preserva o rascunho para redução ou exportação. É necessário recarregar clientes antigos para ler o formato novo.

A falta de conexão mantém o texto pendente na memória da página e retoma o envio ao reconectar. Mantenha a sessão aberta até aparecer a confirmação ou baixe uma cópia. Sair da conta e fechar a página alertam sobre alterações pendentes; não há armazenamento persistente de artigos no navegador. Troca de conta, remoção do integrante, exclusão do grupo e substituição do orientador encerram os respectivos acessos. O orientador anterior perde o artigo; os estudantes continuam com o mesmo documento. Excluir o grupo também remove o artigo.

**Ordem de implantação:** publique primeiro `database.rules.json` no projeto Firebase já utilizado pelo aplicativo e só depois publique esta versão do cliente no GitHub Pages. A nova área usa `maximusInic/articles/{grupo}/{seção}` e não exige migração dos grupos existentes. As permissões dos demais dados foram preservadas. Sem a publicação das regras, o Firebase bloqueia a leitura/escrita do artigo.

### Leitura e tipografia

Textos gerais ampliados, controles em fonte normal com peso 600 e contraste reforçado. A escrita formatada do artigo começa com Arial de 12 pt e permite escolher fonte e tamanho; explicações, ajudas e metadados mantêm seus tamanhos de leitura. A proposta acompanha as cores dos temas claro e escuro. `readability.css` reúne ajustes de espaçamento, quebras de linha e áreas de toque; as fontes do editor usam famílias disponíveis no dispositivo, com alternativas locais.


## Comunidade e disponibilidade dos convites

**Pessoas** apresenta cartões de alunos e professores, busca por nome/série, filtros de perfil e disponibilidade e até 12 cartões por página. O carregamento, falhas de conexão e a lista vazia têm estados próprios. As atualizações preservam a busca e a navegação por teclado. Alunos com cadastro concluído podem conhecer a comunidade antes de enviar o termo; criar grupos, enviar convites e aceitar participação continuam exigindo o termo.

Um aluno que criou ou aceitou um grupo aparece como **Já participa de um grupo**. Ele não pode criar ou aceitar outro enquanto o vínculo existir; a remoção do integrante ou a exclusão do grupo libera sua disponibilidade. Um professor pode orientar vários grupos, mas cada grupo continua tendo um orientador confirmado. Convites repetidos ao mesmo cadastro e grupo são bloqueados enquanto aguardam resposta.

**Os grupos reúnem apenas alunos da mesma série:** 1º ano com 1º ano, 2º ano com 2º ano e 3º ano com 3º ano. Todos os alunos permanecem visíveis, mas colegas de outra série mostram o aviso **Outra série** e não podem ser convidados. O filtro **Disponíveis** considera a série do aluno, os vínculos existentes e os convites pendentes. Professores podem orientar equipes de diferentes séries.

`groups/{grupo}/schoolYear` registra a série escolar canônica e é separado de `year`, que continua sendo a edição do INIC. Na criação por aluno, a série vem do perfil autenticado; professores e coordenação escolhem a série do novo grupo. A série do grupo é fixa. O serviço e as regras conferem a série ao criar, convidar e aceitar, inclusive em convites antigos. A série do cadastro de um aluno vinculado não pode ser alterada até a remoção desse vínculo. O envio novo usa o perfil cadastrado; somente a coordenação pode resolver um e-mail legado em UID pelo cadastro privado que já tem permissão para consultar.

Grupos antigos sem `schoolYear` conservam os integrantes e o conteúdo. Novas inclusões ficam bloqueadas até a classificação segura pela administração. A classificação não pode ser feita por uma simples alteração no navegador: é necessário conferir todos os alunos do grupo. Convites antigos consultam somente o metadado de série antes do aceite; falhas de consulta mantêm o aceite bloqueado e oferecem uma nova tentativa.

O utilitário em [`scripts/school-years`](scripts/school-years/README.md) oferece simulação por padrão e aplicação explícita em transação. Ele classifica somente grupos comprovadamente homogêneos, com perfis e vínculos consistentes. Grupos mistos ou ambíguos aparecem para revisão e permanecem intactos. O utilitário não foi executado nos dados de produção nesta atualização.

`maximusInic/peopleDirectory` contém apenas a projeção de nome, série, papel, solicitação de perfil, disponibilidade e identificação do cadastro. Os perfis privados, e-mails, notas, termos e arquivos continuam nas coleções com acesso restrito. Cadastros bloqueados, contas técnicas e perfis Google ainda incompletos ficam fora da comunidade. Alterações de nome/papel, entrada/remoção e exclusão atualizam a projeção no mesmo lote.

A coordenação sincroniza automaticamente os cadastros existentes ao acessar o portal. Novos cadastros concluídos publicam sua própria projeção. A interface aguarda a sincronização da coordenação antes de mostrar a lista. A publicação desta versão exige primeiro as regras atualizadas do Firebase e depois o cliente; o service worker usa a versão `20261112-signatures-1` e remove os caches antigos da comunidade.

